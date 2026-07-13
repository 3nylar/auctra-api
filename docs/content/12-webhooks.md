---
title: Webhooks
description: Signed, retried, replayable — and how to verify one before you trust it.
section: Build
slug: webhooks
---

Auctra pushes an event to your HTTPS endpoint whenever something happens on-chain that concerns one of your auctions.

```bash
curl -X POST "$AUCTRA_URL/v1/webhook_endpoints" \
  -H "Authorization: Bearer $AUCTRA_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/hooks/auctra",
    "enabled_events": ["auction.bid_placed", "auction.outbid", "auction.settled"]
  }'
```

```json
{
  "object": "webhook_endpoint",
  "id": "whe_6b3d0f8a2c1e",
  "url": "https://example.com/hooks/auctra",
  "secret": "whsec_9d4f2a7c1b8e0356af914d2c7b0e5836a1f4c9d2"
}
```

**`secret` appears once.** Store it before you close the terminal. Every request to your endpoint is signed with it, and you must verify that signature before you trust a byte of the body.

## Events

| Type | Fires when | Payload |
|---|---|---|
| `auction.created` | The creation log confirms. **Now** it's safe to show bidders. | `auction` |
| `auction.bid_placed` | A bid confirms on-chain | `auction` |
| `auction.outbid` | A bidder is overtaken and credited a refund | `{auction, outbid_bidder, refund_wei}` |
| `auction.extended` | A late bid pushed `end_time` back | `auction` |
| `auction.ending_soon` | Five minutes remain | `auction` |
| `auction.ended` | The clock expired | `auction` |
| `auction.settled` | Item transferred, seller credited | `auction` + `winner`, `winning_bid_wei` |
| `auction.cancelled` | Withdrawn before any bid | `auction` |
| `refund.credited` | A refund balance became withdrawable | `refund` |
| `refund.withdrawn` | A bidder swept their balance | `refund` |
| `item.claimed` | The winner took delivery | `auction` |

Every event body:

```json
{
  "id": "evt_7c2e9a1f4b6d",
  "object": "event",
  "type": "auction.outbid",
  "created_at": "2026-07-09T10:31:04.882Z",
  "data": { "object": { "auction": "auc_3f9a2c7b1d4e", "outbid_bidder": "0x9c8b…", "refund_wei": "1050000000000000000" } }
}
```

## Verify the signature

Every request carries:

```http
Auctra-Signature: t=1752076800,v1=5257a869e7d0f1c3b8a2...
Auctra-Event-Id: evt_7c2e9a1f4b6d
Auctra-Delivery-Attempt: 1
```

`v1` is `HMAC-SHA256("{timestamp}.{raw body}", secret)`.

The timestamp is inside the signed payload for a reason. A bare HMAC of the body is valid forever, so anyone who captures one request can replay it at you indefinitely. Signing `timestamp.body` and rejecting anything older than five minutes turns a captured request into a dead one.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody, header, secret, tolerance = 300) {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")));
  const t = Number(parts.t);

  if (!Number.isFinite(t)) return false;
  if (Math.abs(Date.now() / 1000 - t) > tolerance) return false;   // replay window

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, "hex");

  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

Two ways to get this wrong, both common:

**Hash the raw body, not the parsed object.** `JSON.stringify(req.body)` reorders keys and drops whitespace, and the HMAC will never match. In Express: `express.raw({ type: "application/json" })`.

**Compare in constant time.** `expected === given` leaks, one byte at a time, how much of a forged signature was right. `timingSafeEqual` doesn't.

## Retries

Return a `2xx` within **10 seconds**. Anything else — a `500`, a timeout, a connection reset — and we retry:

```
5s → 25s → 2m → 10m → 1h → 6h → 24h
```

Seven attempts over about 32 hours, then the delivery is marked `exhausted` and we stop.

Ten seconds is not enough time to settle an auction, email a winner and update a ledger. Don't try. Persist the event, return `200`, and do the work on a queue. A webhook handler that does real work is a webhook handler that times out during your busiest hour.

## Duplicates are normal

We guarantee **at least once**, not exactly once. A delivery can succeed on our side and time out on yours; you'll get it again.

Deduplicate on `Auctra-Event-Id`. It's stable across every retry of the same event.

```js
if (await seen(req.headers["auctra-event-id"])) return res.sendStatus(200);
```

Ordering is not guaranteed either. `auction.settled` can arrive before the `auction.bid_placed` for the winning bid. Each event carries the full object as of the moment it fired, so treat the payload as the truth and `created_at` as the tiebreaker.

## When your listener was down

Don't ask us to redeliver. Read the log.

```bash
curl "$AUCTRA_URL/v1/events?type=auction.settled&limit=100" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

Every webhook we've ever sent is a durable, paginated row in `GET /v1/events`. An outage becomes a reconciliation, not an incident — and unlike a redelivery queue, it works even if your endpoint was misconfigured for a week.
