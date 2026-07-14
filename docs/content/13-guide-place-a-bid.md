---
title: 'Guide: place a bid'
description: Read the minimum, prepare, sign, and handle being outbid.
section: Guides
slug: guide-place-a-bid
---

## 1. Read the current minimum

Never compute it yourself. `min_increment_bps` compounds, and the floor moves every time someone bids.

```js
const auction = await get(`/v1/auctions/${id}`);

auction.minimum_bid_wei;      // "1102500000000000000"
auction.minimum_bid_display;  // "1.1025"  ← show this; don't calculate with it
auction.status;               // "live" | "ending"
```

If `status` is anything but `live` or `ending`, stop. The clock has run out, and a bid transaction will revert after burning the bidder's gas.

## 2. Prepare the bid

```js
const intent = await post(`/v1/auctions/${id}/bids`, {
  bidder: bidderAddress,
  amount_wei: "1150000000000000000",
});
```

We simulate the transaction against the bidder's real address before returning it. A bid that would revert — under the minimum, auction closed, wallet short of funds — fails here, as a `400` or `422`, before anyone pays gas to discover it.

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "bid_below_minimum",
    "message": "Bid does not clear the current minimum.",
    "param": "amount_wei",
    "detail": { "minimum_bid_wei": "1102500000000000000" }
  }
}
```

Re-read the auction and offer the new floor. Don't retry the same amount — someone got there first.

## 3. Check, then sign

```js
const tx = intent.transaction_request;

// You are about to spend a user's money. Verify what you're spending it on.
if (tx.to.toLowerCase() !== AUCTION_HOUSE.toLowerCase()) throw new Error("unexpected contract");
if (tx.value !== intent.amount_wei) throw new Error("value mismatch");

const hash = await wallet.sendTransaction({
  to: tx.to,
  data: tx.data,
  value: BigInt(tx.value),
  gas: BigInt(tx.gas_limit),
});
```

These two checks take a microsecond and cost nothing. An API telling a wallet where to send ETH is a trust boundary; Auctra is on the wrong side of it, and so is every other API.

There is no `mode: "managed"` for bidding. There never will be.

## 4. Handle the extension

If the bid lands within the final five minutes, the clock moves and the auction keeps taking bids.

```js
socket.on("auction.extended", ({ data }) => {
  countdown.setDeadline(data.object.end_time);      // reset, don't decrement
  toast(`Bid in the final minutes — ${data.object.anti_snipe.extensions_used}× extended`);
});
```

A countdown started at page load and never corrected will tell your users the auction closed while it is still taking bids. Drive it from the event.

## 5. Handle being outbid

Being outbid is not a failure. The bidder's ETH is credited back to them inside the contract, and it is theirs to withdraw whenever they like.

```js
socket.on("auction.outbid", ({ data }) => {
  if (data.object.outbid_bidder !== me) return;
  notify(`You've been outbid. ${formatEther(data.object.refund_wei)} ETH is ready to withdraw.`);
});
```

Note what didn't happen: nobody sent them any ETH. The contract **credits**, it does not push. If it pushed, a bidder could bid from a contract that reverts on `receive()` — and then nobody could ever outbid them, because the refund would fail and take the whole transaction down with it. The auction would be frozen at their price. Crediting instead of sending is what makes that attack pointless.

The consequence for your product: a user can be owed money and not know it. Surface the balance.

```bash
curl "$AUCTRA_URL/v1/refunds/balance?bidder=0x9c8b…" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

```json
{ "object": "refund_balance", "withdrawable_wei": "1050000000000000000", "source": "chain" }
```

That reads `pendingReturns()` directly from the chain, not our cache. Trust it over anything else.

## 6. Withdraw

```js
const intent = await post("/v1/refunds/withdraw", { bidder: bidderAddress });
await wallet.sendTransaction(intent.transaction_request);
```

`withdraw()` sweeps the bidder's entire credited balance across every auction, in one transaction. There's no partial withdrawal, and no reason to want one.
