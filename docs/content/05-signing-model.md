---
title: The signing model
description: Why write endpoints return a transaction instead of doing the work.
section: Core concepts
slug: signing-model
---

This is the concept that makes the rest of the API make sense. It's short.

## The problem

A bid transfers ETH out of the bidder's wallet. On Ethereum, exactly one thing authorises that transfer: a signature from the bidder's private key. There is no admin override, no `x-i-am-really-the-bidder` header, no arrangement we can make with the contract.

So an API endpoint that *just placed a bid* would have to hold that key. And a service holding the keys of everyone bidding in an auction it also runs is a custodian, an exchange, and a very attractive target — and it is exactly the arrangement the AuctionHouse contract was written to make unnecessary.

## What we do instead

Auctra returns an unsigned transaction and steps out of the way.

```
      you                    Auctra                    chain
       │                        │                        │
       │  POST /auctions/…/bids │                        │
       ├───────────────────────>│                        │
       │                        │  simulate against      │
       │                        │  the bidder's address  │
       │                        ├───────────────────────>│
       │  transaction_request   │                        │
       │<───────────────────────┤                        │
       │                        │                        │
   sign with the                │                        │
   bidder's wallet              │                        │
       │                        │                        │
       │  POST /transactions    │                        │
       ├───────────────────────>├───────────────────────>│
       │       202 pending      │                        │
       │<───────────────────────┤                        │
       │                        │      log confirmed     │
       │  auction.bid_placed    │<───────────────────────┤
       │<───────────────────────┤                        │
```

The simulation step is not decoration. We call `eth_estimateGas` against the bidder's actual address, so a bid that would revert — reserve not met, auction over, insufficient balance — fails in the HTTP response, with a decoded reason, before anyone pays gas for the privilege of finding out.

## `mode: "prepared"` vs `mode: "managed"`

Some operations act on a wallet **your organisation owns**. Listing your own inventory. Settling an auction you ran. For those, you may configure a signer and let us broadcast:

```json
{ "mode": "managed", "seller": "0x…", "token_contract": "0x…", "token_id": "42" }
```

| | `prepared` (default) | `managed` |
|---|---|---|
| Who holds the key | You | Auctra, in a KMS |
| Available for `createAuction` | Yes | Yes |
| Available for `settle` / `cancel` | Yes | Yes |
| Available for **`bid`** | Yes | **Never** |
| Response | `transaction_request` | `transaction_hash` |

Bidding has no managed mode and never will. There is no configuration under which it is appropriate for Auctra to spend a bidder's balance.

## Anatomy of a `transaction_request`

```json
{
  "object": "transaction_request",
  "chain_id": 11155111,
  "to": "0x5c9d3f1a7b2e4c6d8f0a2b4c6d8e0f2a4b6c8d0e",
  "data": "0x2ba4b0d8…",
  "value": "1050000000000000000",
  "gas_limit": "74400",
  "max_fee_per_gas": "32000000000",
  "max_priority_fee_per_gas": "1500000000",
  "nonce_hint": 17
}
```

`gas_limit` is the estimate plus 20%. `nonce_hint` is the account's transaction count at the moment we looked — if you have other transactions in flight from the same wallet, it's stale, and your wallet library should compute its own. `value` is what the bidder actually spends; for `createAuction` and `settle` it is `"0"`.

Two things you must check before signing, because we can't:

1. **`to` is the AuctionHouse address you expect.** Pin it. An API you don't control telling you where to send money is a category of trust you should never extend, to us included.
2. **`value` matches the amount you intended to bid.** Compare it to the `amount_wei` you sent.

## Where this leaves you

An Auctra API key cannot move anyone's funds. Leaked, it prepares transactions nobody signs. Subpoenaed, it produces no keys. Compromised at the database layer, it yields hashed keys and public auction data that was already on a public chain.

That property costs you one round trip through a wallet. It is worth it.
