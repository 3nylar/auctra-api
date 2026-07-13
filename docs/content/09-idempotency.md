---
title: Idempotency
description: Retry a POST safely, even when you never saw the response.
section: Build
slug: idempotency
---

Send an `Idempotency-Key` header on every `POST`.

```bash
curl -X POST "$AUCTRA_URL/v1/auctions/auc_3f9a2c7b1d4e/bids" \
  -H "Authorization: Bearer $AUCTRA_KEY" \
  -H "Idempotency-Key: 8f14e45f-ea69-4b9f-a5d2-c1f0c9a70b3e" \
  -H "Content-Type: application/json" \
  -d '{"bidder":"0x9c8b…","amount_wei":"1050000000000000000"}'
```

## The failure this prevents

Your client POSTs a bid. The connection drops before the response arrives. The client has no way to know whether the request landed — and retrying is the *correct* behaviour for a client in that position. So the server has to make retrying safe.

Without a key: two requests, two prepared transactions, and a user who may commit 2.1 ETH to a 1.05 ETH bid.

With a key: the second request returns the first response, byte for byte, with `Idempotent-Replay: true`.

## The rules

| Situation | Result |
|---|---|
| Same key, same body | The stored response, replayed with its original status code |
| Same key, **different** body | `409 idempotency_key_reused` |
| Same key, first request still in flight | `409 idempotency_request_in_flight` — retry shortly |
| No key | The request runs. Every time. |

The key names a *request*, not a slot. Reusing one for a different bid is a bug we'd rather surface than paper over.

Keys live for **24 hours**, then expire. Use a UUID v4, or anything unique with enough entropy that two of your servers won't collide.

## What is and isn't covered

Idempotency protects the API call. It does not protect the chain.

If you sign the returned `transaction_request` twice and broadcast both, you have made two transactions with two nonces, and the second one is a real second bid. The idempotency key was never involved. Sign once, broadcast once, and let `POST /v1/transactions` be the only place a signed blob enters the network.

## In flight, not failed

`idempotency_request_in_flight` means your first request is still executing — probably waiting on an `eth_estimateGas` call to an RPC node having a slow morning. It is not an error to fix. Wait, retry with the same key, and you'll get the original response.

Behind that: the lock row is inserted before we do any work, under a unique constraint on `(organization, key)`. Two concurrent retries race for that insert; exactly one wins and proceeds. The loser gets a 409 rather than a second transaction.

```js
async function post(path, body, key = crypto.randomUUID()) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${AUCTRA_URL}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AUCTRA_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,       // same key on every retry — this is the point
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return res.json();

    const { error } = await res.json();
    if (error.code === "idempotency_request_in_flight" || res.status >= 500) {
      await sleep(2 ** attempt * 250 + Math.random() * 250);
      continue;
    }
    throw new AuctraError(error);   // 400s won't get better
  }
}
```
