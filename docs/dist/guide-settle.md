# Guide: settle and pay out

An auction that has ended is not an auction that has settled. The item and the ETH are both still sitting in the contract.

## What settlement does

`settle` moves the item to the winner and credits the proceeds to the seller. One transaction, both sides. If there were no bids, it returns the item to the seller instead.

Anyone can call it. Not the seller, not the winner — *anyone*, once `end_time` has passed. This is deliberate: if settlement were the seller's privilege, a seller with second thoughts could simply refuse, and the winner's ETH would sit in escrow forever. Making it public means the winner can always close their own auction.

For your integration, that's a floor, not a plan. **Settle your own auctions.**

## Settle on the `auction.ended` event

```js
app.post("/hooks/auctra", async (req, res) => {
  if (!verify(req.rawBody, req.headers["auctra-signature"], SECRET)) return res.sendStatus(400);
  res.sendStatus(200);

  const event = JSON.parse(req.rawBody);
  if (event.type !== "auction.ended") return;

  await queue.add("settle", { auctionId: event.data.object.id }, {
    attempts: 5,
    backoff: { type: "exponential", delay: 30_000 },
  });
});
```

On a queue, not in the handler. Settlement is a chain transaction: it can take a minute, or fail because gas spiked, and neither belongs inside a ten-second webhook timeout.

## Settling with a managed signer

This is one of the operations where the wallet is *yours*, so you can hand us the key and stop thinking about it.

```js
const settled = await post(`/v1/auctions/${auctionId}/settle`, { mode: "managed" });
// { "status": "ended", "transaction_hash": "0x4c1d…" }
```

We broadcast from your configured signer and return the hash. `status` is still `ended` — it becomes `settled` when the log confirms and `auction.settled` fires.

Keep that wallet funded. A settlement that fails on gas is a winner who can't collect.

Without a managed signer, `mode` defaults to `prepared` and you get a transaction to sign, exactly like everywhere else.

## Confirm

```js
socket.on("auction.settled", ({ data }) => {
  const { winner, winning_bid_wei, transactions } = data.object;
  // Item is with the winner. Proceeds are credited to the seller.
});
```

The seller's proceeds are **credited**, not sent — same pull-payment rule that protects outbid bidders. The seller collects with the same `POST /v1/refunds/withdraw` call a bidder uses.

## When nobody bid

Settlement of a bidless auction returns the item to the seller and credits nobody. `winner` is the zero address, `winning_bid_wei` is `"0"`.

Watch for this in your handler. `if (!winner)` is not the check you want — `"0x0000…0000"` is truthy.

```js
const ZERO = "0x0000000000000000000000000000000000000000";
if (data.object.winner === ZERO) return handleNoSale(data.object.id);
```

## The claim path

`settle` transfers the item automatically. `claimItem` exists for the edge case where that transfer failed — a winner bidding from a contract that can't receive ERC-721s, most often — and lets the winner pull the item themselves once they've fixed their end.

Most integrations never call it. Expose it anyway, on the auction detail page for a winner whose item hasn't arrived. The alternative is a support ticket you can't resolve.
