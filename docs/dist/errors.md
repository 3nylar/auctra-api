# Errors

Every error, from a typo'd address to a reverted transaction, has the same shape.

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "bid_below_minimum",
    "message": "Bid does not clear the current minimum.",
    "param": "amount_wei",
    "detail": { "minimum_bid_wei": "1102500000000000000" },
    "request_id": "req_9f2ac71b3d8e4a05",
    "docs_url": "https://docs.auctra.dev/errors#bid_below_minimum"
  }
}
```

**Switch on `code`.** Messages are written for humans and will be reworded without warning. Codes are part of the contract and won't change without a version bump.

**Quote `request_id`.** It's on every response, in the body and in the `Auctra-Request-Id` header. It is the only string support needs from you.

## Types and status codes

| `type` | HTTP | Meaning | Retry? |
|---|---|---|---|
| `authentication_error` | 401 | Bad, missing, revoked or wrong-environment key | No — fix the key |
| `permission_error` | 403 | Key lacks the required scope | No |
| `invalid_request_error` | 400 / 404 | Malformed input, or an auction rule says no | No — change the request |
| `idempotency_error` | 409 | Key reused with a different body, or still in flight | Yes, for `in_flight` |
| `chain_error` | 422 | The transaction would revert, or did | Depends on the reason |
| `rate_limit_error` | 429 | Too many requests | Yes, after `Retry-After` |
| `api_error` | 500 / 503 | Our fault | Yes, with backoff |

## Codes you'll actually hit

### `bid_below_minimum`
The bid doesn't clear `highest_bid × (1 + min_increment_bps / 10000)`, or the reserve if there are no bids. `detail.minimum_bid_wei` carries the current floor. It moves; re-read the auction rather than retrying the same amount.

### `auction_not_live`
The clock ran out, or the auction was cancelled. The message names the actual status. Note this can happen to a request that was valid when your user clicked the button — five hundred milliseconds is enough.

### `auction_has_bids`
You tried to cancel an auction someone has bid on. This is not a permission problem you can escalate. Once ETH is committed, the lot is committed.

### `auction_not_ended`
Settlement before `end_time`. Check for a pending extension: a bid in the last five minutes may have moved the deadline since you last read it.

### `environment_mismatch`
An `sk_live_` key against the sandbox host, or the reverse. See [Authentication](authentication.html).

### `idempotency_key_reused`
The same `Idempotency-Key` with a different body. The key names a specific request, not a slot to reuse. Generate a fresh one.

### `transaction_reverted`
The chain rejected the transaction. AuctionHouse.sol uses custom errors, so `message` carries a decoded name — `BidTooLow`, `AuctionAlreadyEnded`, `NotApprovedForTransfer` — rather than the useless string "execution reverted".

`NotApprovedForTransfer` is the one that catches everybody: you have to `setApprovalForAll` on the token contract before Auctra can escrow the item.

### `rpc_unavailable`
We couldn't reach an Ethereum node. Ours, not yours. Retry with backoff; it usually clears within seconds.

### `internal_error`
A 500. The request was **not** processed — we don't half-commit. Safe to retry with the same `Idempotency-Key`.

## Retrying, without making it worse

The dangerous retry is a `POST` whose response you never saw. Did the bid land? Retrying blind can commit the ETH twice.

Don't guess. Send an `Idempotency-Key` on every POST, and retry with the same key: we replay the original response instead of doing the work again. [Idempotency →](idempotency.html)

For `429` and `5xx`, back off exponentially with jitter, and cap it:

```js
const delay = Math.min(2 ** attempt * 250, 30_000);
await sleep(delay + Math.random() * 250);
```

Never retry a `400`. The request is wrong and will be wrong again.
