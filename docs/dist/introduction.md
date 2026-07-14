# Introduction

Auctra runs English auctions — open bidding, ascending price, a clock — and settles them on Ethereum. This API gives you the auction house without the blockchain plumbing: list an item, watch bids arrive over webhooks, settle, pay out. In JSON.

Everything that a bidder trusts is enforced by a contract, not by us. Outbid bidders are refunded without anyone pressing a button. A bid in the final five minutes pushes the clock back, so a sniper cannot win by being fast. Once a single bid lands, nobody can pull the lot — not the seller, not the contract's deployer, not Auctra.

## The one rule that shapes this API

A bid moves the bidder's own ETH. Only the bidder's private key can authorise that.

We could have hidden this. An API that accepted `POST /bids` and moved someone's money would need to hold their key, which would make Auctra a custodian — the precise thing the contract was written to avoid. So instead of pretending the key doesn't exist, we hand it back to you:

**Write endpoints return an unsigned transaction.** You sign it with the user's wallet and broadcast it, either yourself or through `POST /v1/transactions`. Auctra never sees a private key, and there is nothing we could be compelled to hand over.

```json
{
  "object": "bid_intent",
  "auction": "auc_3f9a2c7b1d4e",
  "amount_wei": "1050000000000000000",
  "transaction_request": {
    "to": "0x5c9d3f1a7b2e4c6d8f0a2b4c6d8e0f2a4b6c8d0e",
    "data": "0x2ba4b0d80000000000000000000000000000000000000000000000000000000000000075",
    "value": "1050000000000000000",
    "chain_id": 11155111
  }
}
```

For operations on a wallet **your organisation owns** — listing your own inventory, settling your own auctions — you can configure a signer and pass `mode: "managed"`, and we'll broadcast for you. That option is never available for bidding.

## What you get

- **Auctions** you create, browse, settle and cancel.
- **Bids**, validated against the live minimum and simulated before they cost anyone gas.
- **Refunds** for outbid bidders, tracked as a queryable balance rather than something a user has to know to go find.
- **Webhooks** signed with HMAC and retried with backoff for about 32 hours, backed by an event log you can replay yourself.
- **A sandbox** on Sepolia that exercises every code path in production, with worthless ETH.

## Two conventions worth reading before you write code

**Amounts are strings.** `"1050000000000000000"`, not `1.05e18`. One ETH is 10<sup>18</sup> wei, and JSON numbers are doubles, which lose integer precision above 2<sup>53</sup>. A naive `JSON.parse` silently turns `"1000000000000000001"` into `1000000000000000000` — one wei gone, and a bid that was supposed to be the highest quietly isn't. Every response also carries a lossy `*_display` field in ETH. It's for showing to humans. Never do arithmetic on it.

**`end_time` moves.** A bid inside the anti-snipe window extends the auction. Read the new end time from the `auction.extended` webhook; a countdown that caches `end_time` at page load will tell your users the auction is over while it is still taking bids.

## Start here

Get a key, make a call, and see an auction confirm on-chain in about four minutes: **[Quickstart →](quickstart.html)**
