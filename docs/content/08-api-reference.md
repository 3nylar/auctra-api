---
title: API reference
description: Every endpoint, every field, every scope it requires.
section: Reference
slug: api-reference
---


Base URL `https://auctra-api-production.up.railway.app`. Every request needs `Authorization: Bearer sk_test_…`. Amounts are decimal strings of wei.

## Auctions

Create, browse, settle and cancel auctions.

### List auctions

`GET /v1/auctions`

_Requires scope `auctions:read`._

Parameters:

- `limit` (integer, query) — Page size, 1–100.
- `starting_after` (string, query) — An object id to page after. Cursor, not offset: auctions are inserted
constantly, and `?page=2` would skip or duplicate rows whenever a new
one lands between requests.

- `status` ("pending" | "live" | "ending" | "ended" | "settled" | "cancelled", query) — Filter by lifecycle status. Note this is derived from the chain
clock at read time, so an auction whose `end_time` just passed is
reported `ended` even if the settlement transaction hasn't been
sent yet.

- `seller` (string, query)
- `token_contract` (string, query)

```bash
curl -X GET "$AUCTRA_URL/v1/auctions" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "list",
  "data": [
    {
      "object": "auction",
      "id": "auc_3f9a2c7b1d4e",
      "status": "live",
      "chain_id": 11155111,
      "contract": "0x5c9d3f1a7b2e4c6d8f0a2b4c6d8e0f2a4b6c8d0e",
      "onchain_id": 117,
      "seller": "0x7a3f1c8b9d2e4f6a0b1c2d3e4f5a6b7c8d9e0f1a",
      "item": {
        "token_contract": "0x2b1d4e6f8a0c2e4f6a8b0d2f4a6c8e0b2d4f6a8c",
        "token_id": "42"
      },
      "reserve_price_wei": "1000000000000000000",
      "reserve_price_display": "1",
      "min_increment_bps": 500,
      "minimum_bid_wei": "1102500000000000000",
      "highest_bid_wei": "1050000000000000000",
      "highest_bidder": "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
      "start_time": "2026-07-08T10:00:00.000Z",
      "end_time": "2026-07-09T10:00:00.000Z",
      "anti_snipe": {
        "extension_window_seconds": 300,
        "extensions_used": 0,
        "max_extensions": 10
      },
      "transactions": {
        "created": "0x4c1d7a90f3b2e5c8a1d4f7b0e3c6a9d2f5b8e1c4a7d0f3b6e9c2a5d8f1b4e7c0",
        "settled": null
      },
      "metadata": {
        "lot_number": "L-0117"
      },
      "created_at": "2026-07-08T09:59:41.204Z",
      "updated_at": "2026-07-08T14:22:07.881Z"
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

### Create an auction

`POST /v1/auctions`

_Requires scope `auctions:write`._

Escrows the item and opens the clock. Returns `201` with a
`transaction_request` you must sign as the seller.

The auction is `pending` until the `AuctionCreated` log confirms — a
broadcast is not a confirmation. Wait for the `auction.created` webhook
before showing it to bidders.

Creating an auction requires the AuctionHouse contract to already be
approved to transfer the token. Call `approve()` or `setApprovalForAll()`
on the token contract first, or the transaction will revert with
`NotApprovedForTransfer`.


Parameters:

- `Idempotency-Key` (string, header) — A unique string, e.g. a UUID. Replaying the same key with the same body
returns the original response verbatim; with a different body it
returns `409 idempotency_key_reused`. Keys expire after 24 hours.


```bash
curl -X POST "$AUCTRA_URL/v1/auctions" \
  -H "Authorization: Bearer $AUCTRA_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "mode": "prepared",
    "seller": "0x7a3f1c8b9d2e4f6a0b1c2d3e4f5a6b7c8d9e0f1a",
    "token_contract": "0x2b1d4e6f8a0c2e4f6a8b0d2f4a6c8e0b2d4f6a8c",
    "token_id": "42",
    "reserve_price_wei": "1000000000000000000",
    "duration_seconds": 86400,
    "min_increment_bps": 500,
    "metadata": {
      "lot_number": "L-0117",
      "catalogue": "spring-2026"
    }
  }'
```

```json
{
  "object": "auction",
  "id": "auc_3f9a2c7b1d4e",
  "status": "live",
  "chain_id": 11155111,
  "contract": "0x5c9d3f1a7b2e4c6d8f0a2b4c6d8e0f2a4b6c8d0e",
  "onchain_id": 117,
  "seller": "0x7a3f1c8b9d2e4f6a0b1c2d3e4f5a6b7c8d9e0f1a",
  "item": {
    "token_contract": "0x2b1d4e6f8a0c2e4f6a8b0d2f4a6c8e0b2d4f6a8c",
    "token_id": "42"
  },
  "reserve_price_wei": "1000000000000000000",
  "reserve_price_display": "1",
  "min_increment_bps": 500,
  "minimum_bid_wei": "1102500000000000000",
  "highest_bid_wei": "1050000000000000000",
  "highest_bidder": "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
  "start_time": "2026-07-08T10:00:00.000Z",
  "end_time": "2026-07-09T10:00:00.000Z",
  "anti_snipe": {
    "extension_window_seconds": 300,
    "extensions_used": 0,
    "max_extensions": 10
  },
  "transactions": {
    "created": "0x4c1d7a90f3b2e5c8a1d4f7b0e3c6a9d2f5b8e1c4a7d0f3b6e9c2a5d8f1b4e7c0",
    "settled": null
  },
  "metadata": {
    "lot_number": "L-0117"
  },
  "created_at": "2026-07-08T09:59:41.204Z",
  "updated_at": "2026-07-08T14:22:07.881Z"
}
```

### Retrieve an auction

`GET /v1/auctions/{id}`

_Requires scope `auctions:read`._

Parameters:

- `id` (string, path, required) — An auction id, e.g. `auc_3f9a2c7b1d4e`.

```bash
curl -X GET "$AUCTRA_URL/v1/auctions/{id}" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "auction",
  "id": "auc_3f9a2c7b1d4e",
  "status": "live",
  "chain_id": 11155111,
  "contract": "0x5c9d3f1a7b2e4c6d8f0a2b4c6d8e0f2a4b6c8d0e",
  "onchain_id": 117,
  "seller": "0x7a3f1c8b9d2e4f6a0b1c2d3e4f5a6b7c8d9e0f1a",
  "item": {
    "token_contract": "0x2b1d4e6f8a0c2e4f6a8b0d2f4a6c8e0b2d4f6a8c",
    "token_id": "42"
  },
  "reserve_price_wei": "1000000000000000000",
  "reserve_price_display": "1",
  "min_increment_bps": 500,
  "minimum_bid_wei": "1102500000000000000",
  "highest_bid_wei": "1050000000000000000",
  "highest_bidder": "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
  "start_time": "2026-07-08T10:00:00.000Z",
  "end_time": "2026-07-09T10:00:00.000Z",
  "anti_snipe": {
    "extension_window_seconds": 300,
    "extensions_used": 0,
    "max_extensions": 10
  },
  "transactions": {
    "created": "0x4c1d7a90f3b2e5c8a1d4f7b0e3c6a9d2f5b8e1c4a7d0f3b6e9c2a5d8f1b4e7c0",
    "settled": null
  },
  "metadata": {
    "lot_number": "L-0117"
  },
  "created_at": "2026-07-08T09:59:41.204Z",
  "updated_at": "2026-07-08T14:22:07.881Z"
}
```

### Settle an ended auction

`POST /v1/auctions/{id}/settle`

_Requires scope `auctions:write`._

Transfers the item to the winner and credits the proceeds to the seller.
Callable by anyone once `end_time` has passed — settlement is a public
good, not a privilege. Set `mode: "managed"` to have Auctra broadcast
it from your configured signer.


Parameters:

- `id` (string, path, required) — An auction id, e.g. `auc_3f9a2c7b1d4e`.
- `Idempotency-Key` (string, header) — A unique string, e.g. a UUID. Replaying the same key with the same body
returns the original response verbatim; with a different body it
returns `409 idempotency_key_reused`. Keys expire after 24 hours.


```bash
curl -X POST "$AUCTRA_URL/v1/auctions/{id}/settle" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "auction",
  "id": "auc_3f9a2c7b1d4e",
  "status": "live",
  "chain_id": 11155111,
  "contract": "0x5c9d3f1a7b2e4c6d8f0a2b4c6d8e0f2a4b6c8d0e",
  "onchain_id": 117,
  "seller": "0x7a3f1c8b9d2e4f6a0b1c2d3e4f5a6b7c8d9e0f1a",
  "item": {
    "token_contract": "0x2b1d4e6f8a0c2e4f6a8b0d2f4a6c8e0b2d4f6a8c",
    "token_id": "42"
  },
  "reserve_price_wei": "1000000000000000000",
  "reserve_price_display": "1",
  "min_increment_bps": 500,
  "minimum_bid_wei": "1102500000000000000",
  "highest_bid_wei": "1050000000000000000",
  "highest_bidder": "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
  "start_time": "2026-07-08T10:00:00.000Z",
  "end_time": "2026-07-09T10:00:00.000Z",
  "anti_snipe": {
    "extension_window_seconds": 300,
    "extensions_used": 0,
    "max_extensions": 10
  },
  "transactions": {
    "created": "0x4c1d7a90f3b2e5c8a1d4f7b0e3c6a9d2f5b8e1c4a7d0f3b6e9c2a5d8f1b4e7c0",
    "settled": null
  },
  "metadata": {
    "lot_number": "L-0117"
  },
  "created_at": "2026-07-08T09:59:41.204Z",
  "updated_at": "2026-07-08T14:22:07.881Z"
}
```

### Cancel an auction

`POST /v1/auctions/{id}/cancel`

_Requires scope `auctions:write`._

Only possible while the auction has zero bids. Once someone has
committed ETH, no one — not the seller, not the contract deployer, not
Auctra — can pull the lot.


Parameters:

- `id` (string, path, required) — An auction id, e.g. `auc_3f9a2c7b1d4e`.
- `Idempotency-Key` (string, header) — A unique string, e.g. a UUID. Replaying the same key with the same body
returns the original response verbatim; with a different body it
returns `409 idempotency_key_reused`. Keys expire after 24 hours.


```bash
curl -X POST "$AUCTRA_URL/v1/auctions/{id}/cancel" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "auction",
  "id": "auc_3f9a2c7b1d4e",
  "status": "live",
  "chain_id": 11155111,
  "contract": "0x5c9d3f1a7b2e4c6d8f0a2b4c6d8e0f2a4b6c8d0e",
  "onchain_id": 117,
  "seller": "0x7a3f1c8b9d2e4f6a0b1c2d3e4f5a6b7c8d9e0f1a",
  "item": {
    "token_contract": "0x2b1d4e6f8a0c2e4f6a8b0d2f4a6c8e0b2d4f6a8c",
    "token_id": "42"
  },
  "reserve_price_wei": "1000000000000000000",
  "reserve_price_display": "1",
  "min_increment_bps": 500,
  "minimum_bid_wei": "1102500000000000000",
  "highest_bid_wei": "1050000000000000000",
  "highest_bidder": "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
  "start_time": "2026-07-08T10:00:00.000Z",
  "end_time": "2026-07-09T10:00:00.000Z",
  "anti_snipe": {
    "extension_window_seconds": 300,
    "extensions_used": 0,
    "max_extensions": 10
  },
  "transactions": {
    "created": "0x4c1d7a90f3b2e5c8a1d4f7b0e3c6a9d2f5b8e1c4a7d0f3b6e9c2a5d8f1b4e7c0",
    "settled": null
  },
  "metadata": {
    "lot_number": "L-0117"
  },
  "created_at": "2026-07-08T09:59:41.204Z",
  "updated_at": "2026-07-08T14:22:07.881Z"
}
```

### Claim a won item

`POST /v1/auctions/{id}/claim`

_Requires scope `auctions:write`._

Prepares `claimItem()` for the winning bidder.

Parameters:

- `id` (string, path, required) — An auction id, e.g. `auc_3f9a2c7b1d4e`.
- `Idempotency-Key` (string, header) — A unique string, e.g. a UUID. Replaying the same key with the same body
returns the original response verbatim; with a different body it
returns `409 idempotency_key_reused`. Keys expire after 24 hours.


```bash
curl -X POST "$AUCTRA_URL/v1/auctions/{id}/claim" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

## Bids

Place bids and read the bid history of an auction.

### List bids on an auction

`GET /v1/auctions/{id}/bids`

_Requires scope `auctions:read`._

Parameters:

- `id` (string, path, required) — An auction id, e.g. `auc_3f9a2c7b1d4e`.
- `limit` (integer, query) — Page size, 1–100.
- `starting_after` (string, query) — An object id to page after. Cursor, not offset: auctions are inserted
constantly, and `?page=2` would skip or duplicate rows whenever a new
one lands between requests.


```bash
curl -X GET "$AUCTRA_URL/v1/auctions/{id}/bids" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "list",
  "data": [
    {
      "object": "bid",
      "id": "bid_8d2f4a6c1e3b",
      "auction": "auc_3f9a2c7b1d4e",
      "bidder": "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
      "amount_wei": "1050000000000000000",
      "amount_display": "1.05",
      "status": "winning",
      "transaction_hash": "0x8e1c4a7d0f3b6e9c2a5d8f1b4e7c04c1d7a90f3b2e5c8a1d4f7b0e3c6a9d2f5b",
      "block_number": 6142301,
      "placed_at": "2026-07-08T14:22:07.881Z"
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

### Place a bid

`POST /v1/auctions/{id}/bids`

_Requires scope `auctions:write`._

Validates the bid against the live minimum, simulates it against the
bidder's address, and returns an unsigned transaction. Nothing is
committed until the bidder signs and the transaction confirms.

There is no `managed` mode here. Bidding spends the bidder's balance;
no configuration makes it appropriate for Auctra to do that on their
behalf.

A bid landing inside the final `extension_window_seconds` pushes the
end time back, up to `max_extensions` times. Your countdown must read
`end_time` from the `auction.extended` webhook, not cache it.


Parameters:

- `id` (string, path, required) — An auction id, e.g. `auc_3f9a2c7b1d4e`.
- `Idempotency-Key` (string, header) — A unique string, e.g. a UUID. Replaying the same key with the same body
returns the original response verbatim; with a different body it
returns `409 idempotency_key_reused`. Keys expire after 24 hours.


```bash
curl -X POST "$AUCTRA_URL/v1/auctions/{id}/bids" \
  -H "Authorization: Bearer $AUCTRA_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "bidder": "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
    "amount_wei": "1050000000000000000"
  }'
```

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "bid_below_minimum",
    "message": "Bid does not clear the current minimum.",
    "param": "amount_wei",
    "detail": {
      "minimum_bid_wei": "1102500000000000000"
    },
    "request_id": "req_9f2ac71b3d8e4a05",
    "docs_url": "https://docs.auctra.dev/errors#bid_below_minimum"
  }
}
```

## Refunds

Credited balances for outbid bidders, and how to withdraw them.

### List refund credits

`GET /v1/refunds`

_Requires scope `auctions:read`._

When a bidder is outbid, the contract credits them rather than sending
ETH back. Pushing a refund would let a malicious contract revert on
receive and freeze the auction for everyone. Refunds are pulled.


Parameters:

- `limit` (integer, query) — Page size, 1–100.
- `starting_after` (string, query) — An object id to page after. Cursor, not offset: auctions are inserted
constantly, and `?page=2` would skip or duplicate rows whenever a new
one lands between requests.

- `bidder` (string, query)
- `withdrawn` (boolean, query)

```bash
curl -X GET "$AUCTRA_URL/v1/refunds" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "list",
  "data": [
    {
      "object": "refund",
      "id": "ref_1e5a8c3f7b2d",
      "bidder": "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
      "amount_wei": "1050000000000000000",
      "amount_display": "1.05",
      "withdrawn": false,
      "withdrawal_transaction": null,
      "chain_id": 11155111,
      "created_at": "2026-07-08T14:31:52.006Z"
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

### Read a withdrawable balance

`GET /v1/refunds/balance`

_Requires scope `auctions:read`._

Reads `pendingReturns()` straight from the chain, not the cache.

Parameters:

- `bidder` (string, query, required)

```bash
curl -X GET "$AUCTRA_URL/v1/refunds/balance" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "refund_balance",
  "bidder": "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
  "withdrawable_wei": "1050000000000000000",
  "withdrawable_display": "1.05",
  "source": "chain"
}
```

### Withdraw a refund balance

`POST /v1/refunds/withdraw`

_Requires scope `auctions:write`._

Prepares `withdraw()`, which sweeps the bidder's entire credited
balance across all auctions in a single transaction.


Parameters:

- `Idempotency-Key` (string, header) — A unique string, e.g. a UUID. Replaying the same key with the same body
returns the original response verbatim; with a different body it
returns `409 idempotency_key_reused`. Keys expire after 24 hours.


```bash
curl -X POST "$AUCTRA_URL/v1/refunds/withdraw" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

## Transactions

Broadcast signed transactions and poll for confirmation.

### Broadcast a signed transaction

`POST /v1/transactions`

_Requires scope `auctions:write`._

Optional. You can send a signed transaction to any node; this endpoint
exists so an integration needs one network dependency instead of two.

Returns `202 Accepted`, not `200`. The chain decides whether a
transaction succeeds, and it has not decided yet.


Parameters:

- `Idempotency-Key` (string, header) — A unique string, e.g. a UUID. Replaying the same key with the same body
returns the original response verbatim; with a different body it
returns `409 idempotency_key_reused`. Keys expire after 24 hours.


```bash
curl -X POST "$AUCTRA_URL/v1/transactions" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "transaction",
  "hash": "0x4c1d7a90f3b2e5c8a1d4f7b0e3c6a9d2f5b8e1c4a7d0f3b6e9c2a5d8f1b4e7c0",
  "status": "pending",
  "confirmations": 0,
  "poll": "/v1/transactions/0x4c1d..."
}
```

### Retrieve a transaction

`GET /v1/transactions/{hash}`

_Requires scope `auctions:read`._

Parameters:

- `hash` (string, path, required)

```bash
curl -X GET "$AUCTRA_URL/v1/transactions/{hash}" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

## Webhooks

Subscribe to auction events and replay the event log.

### List webhook endpoints

`GET /v1/webhook_endpoints`

_Requires scope `webhooks:read`._

```bash
curl -X GET "$AUCTRA_URL/v1/webhook_endpoints" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "list",
  "data": [
    {
      "object": "webhook_endpoint",
      "id": "whe_6b3d0f8a2c1e",
      "url": "https://example.com/hooks/auctra",
      "enabled_events": [
        "auction.bid_placed",
        "auction.outbid",
        "auction.settled"
      ],
      "status": "enabled",
      "created_at": "2026-07-01T08:14:22.417Z"
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

### Create a webhook endpoint

`POST /v1/webhook_endpoints`

_Requires scope `webhooks:write`._

The response contains `secret` exactly once. Store it; every subsequent
request is signed with it, and you must verify that signature before
trusting the body.


```bash
curl -X POST "$AUCTRA_URL/v1/webhook_endpoints" \
  -H "Authorization: Bearer $AUCTRA_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "url": "https://example.com/hooks/auctra",
    "enabled_events": [
      "auction.bid_placed",
      "auction.outbid",
      "auction.settled"
    ]
  }'
```

```json
{
  "object": "webhook_endpoint",
  "id": "whe_6b3d0f8a2c1e",
  "url": "https://example.com/hooks/auctra",
  "enabled_events": [
    "auction.bid_placed",
    "auction.outbid",
    "auction.settled"
  ],
  "secret": "whsec_9d4f2a7c1b8e0356af914d2c7b0e5836a1f4c9d2",
  "created_at": "2026-07-01T08:14:22.417Z"
}
```

### Delete a webhook endpoint

`DELETE /v1/webhook_endpoints/{id}`

_Requires scope `webhooks:write`._

Parameters:

- `id` (string, path, required)

```bash
curl -X DELETE "$AUCTRA_URL/v1/webhook_endpoints/{id}" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

### List events

`GET /v1/events`

_Requires scope `auctions:read`._

Every webhook we send is also a durable row here. If your listener was
down, don't ask us to redeliver — read the log and reconcile.


Parameters:

- `limit` (integer, query) — Page size, 1–100.
- `starting_after` (string, query) — An object id to page after. Cursor, not offset: auctions are inserted
constantly, and `?page=2` would skip or duplicate rows whenever a new
one lands between requests.

- `type` ("auction.created" | "auction.bid_placed" | "auction.outbid" | "auction.extended" | "auction.ending_soon" | "auction.ended" | "auction.settled" | "auction.cancelled" | "refund.credited" | "refund.withdrawn" | "item.claimed", query)

```bash
curl -X GET "$AUCTRA_URL/v1/events" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "list",
  "data": [
    {
      "object": "event",
      "id": "evt_7c2e9a1f4b6d",
      "type": "auction.outbid",
      "created_at": "2026-07-09T10:31:04.882Z",
      "data": {
        "object": {
          "auction": "auc_3f9a2c7b1d4e",
          "outbid_bidder": "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
          "refund_wei": "1050000000000000000"
        }
      }
    }
  ],
  "has_more": true,
  "next_cursor": "evt_7c2e9a1f4b6d"
}
```

### Retrieve an event

`GET /v1/events/{id}`

_Requires scope `auctions:read`._

Parameters:

- `id` (string, path, required)

```bash
curl -X GET "$AUCTRA_URL/v1/events/{id}" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

## Health

Liveness and dependency status. No authentication required.

### Check API health

`GET /v1/health`

_No authentication required._

Reports the two dependencies that can take the API down: the database
and the RPC node. Use `head_block` to tell whether the indexer is
keeping up with the chain.


```bash
curl -X GET "$AUCTRA_URL/v1/health" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{
  "object": "health",
  "status": "ok",
  "environment": "sandbox",
  "chain_id": 11155111,
  "head_block": 6142398,
  "database": "ok",
  "rpc": "ok",
  "managed_signer": "disabled"
}
```
