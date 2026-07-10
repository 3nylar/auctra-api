---
title: Auction lifecycle
description: Six states, one clock, and the two transitions nobody controls.
section: Core concepts
slug: auction-lifecycle
---

```
  created            first bid          clock expires        settle()
     │                   │                    │                  │
     ▼                   ▼                    ▼                  ▼
 ┌─────────┐  confirm ┌──────┐  ≤5m left ┌────────┐        ┌────────┐   ┌─────────┐
 │ pending ├─────────>│ live ├──────────>│ ending ├───────>│ ended  ├──>│ settled │
 └─────────┘          └──┬───┘<──────────└────┬───┘        └────────┘   └─────────┘
                         │   late bid extends │
                         │                    │
                    no bids yet          a late bid here
                         │              pushes the clock back
                         ▼
                   ┌───────────┐
                   │ cancelled │
                   └───────────┘
```

## The states

**`pending`** — the creation transaction is broadcast but not confirmed. It may still be dropped or replaced. Do not show this auction to bidders. It becomes `live` when the `AuctionCreated` log is two blocks deep, and we send `auction.created`.

**`live`** — accepting bids. `minimum_bid_wei` is the reserve until the first bid lands, then the current high plus `min_increment_bps`.

**`ending`** — inside the anti-snipe window (300 seconds by default). Functionally identical to `live`; it exists so your UI can say so.

**`ended`** — the clock has run out. No more bids. The item and the money are still in the contract, waiting for someone to call `settle`.

**`settled`** — the item is with the winner, the proceeds are credited to the seller. Terminal.

**`cancelled`** — withdrawn before any bid landed. Terminal.

## Two transitions nobody controls

**`live → ended` happens without a transaction.** No one mines "the auction is over." The clock simply passes `end_time`, and every read after that point reports `ended`. Which means: a row in our database that says `live` may already be `ended`, and we derive `status` from the timestamp on every read rather than trusting the column. **You should do the same.** If you cache an auction object for thirty seconds, cache the fields — not the status.

**`ending → live` happens by a stranger's bid.** A bid inside the final five minutes moves `end_time` forward, up to `max_extensions` times. The auction goes back to accepting bids. This is the anti-snipe rule, and it is the reason a countdown in your UI must be driven by `auction.extended` webhooks rather than a timer started at page load.

```json
{
  "type": "auction.extended",
  "data": { "object": {
    "id": "auc_3f9a2c7b1d4e",
    "end_time": "2026-07-09T10:35:00.000Z",
    "anti_snipe": { "extensions_used": 3, "max_extensions": 10 }
  }}
}
```

The extension cap is not optional. Without it, two determined bidders could keep an auction open indefinitely, and the seller's item would be escrowed forever.

## Whose clock?

The chain's. `block.timestamp`, not your server's wall clock, decides whether a bid arrived in time. Miners have modest latitude over that value, and it can drift from real time by seconds.

In the last five seconds of an auction, seconds are the only thing that matters. Never render a countdown that reaches zero before the chain agrees. Take `end_time` from us, subtract a two-second grace, and show "closing" rather than "closed" until `auction.ended` arrives.

## Settlement is a public good

`settle` can be called by anyone once the clock has expired — the winner, the seller, a bot, a stranger. The contract doesn't care who pays the gas; it moves the item to the winner and credits the seller either way.

This is a deliberate liveness property. If settlement were the seller's privilege, a seller with a losing case of buyer's remorse could simply never call it, and the winner's ETH would sit in escrow indefinitely. Instead, the winner can settle their own auction, and if they don't, anyone can.

For your integration: if you're running the auction, settle it yourself on a schedule. Waiting for a stranger to do it works, but it isn't a plan.
