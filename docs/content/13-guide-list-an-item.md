---
title: 'Guide: list an item'
description: Approve, create, confirm — the full seller flow, end to end.
section: Build
slug: guide-list-an-item
---

Four steps: approve the contract to escrow the token, create the auction, sign and broadcast the transaction, and wait for the confirmation event. The middle two steps are the only ones that touch Auctra.

## 1. Approve, once per collection

The AuctionHouse can't take custody of a token it isn't approved for. This is a call to *your token contract*, not to us.

```js
import { createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";

const AUCTION_HOUSE = "0x5c9d3f1a7b2e4c6d8f0a2b4c6d8e0f2a4b6c8d0e";

await wallet.writeContract({
  address: TOKEN_CONTRACT,
  abi: erc721Abi,
  functionName: "setApprovalForAll",
  args: [AUCTION_HOUSE, true],
});
```

Skip this and `POST /v1/auctions` returns `422` with `transaction_reverted: NotApprovedForTransfer`. It is the single most common first-integration failure.

`setApprovalForAll` covers every token in the collection, forever. If that's more trust than you want to extend, `approve(AUCTION_HOUSE, tokenId)` grants it for one token and is consumed by the transfer.

## 2. Create the auction

```js
const res = await fetch(`${AUCTRA_URL}/v1/auctions`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${AUCTRA_KEY}`,
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
  },
  body: JSON.stringify({
    seller: sellerAddress,
    token_contract: TOKEN_CONTRACT,
    token_id: "42",
    reserve_price_wei: "1000000000000000000",  // 1 ETH — a string, always
    duration_seconds: 86_400,
    min_increment_bps: 500,                     // each bid must clear the last by 5%
    metadata: { lot_number: "L-0117", catalogue: "spring-2026" },
  }),
});

const auction = await res.json();   // 201, status: "pending"
```

`metadata` is up to 8KB of your own keys. We store it, return it, and never read it. Put your internal lot id there so a webhook can be matched to a row in your database without a lookup table.

## 3. Sign and broadcast

```js
const tx = auction.transaction_request;

// Check what you're signing. `to` should be the AuctionHouse you pinned.
if (tx.to.toLowerCase() !== AUCTION_HOUSE.toLowerCase()) throw new Error("unexpected contract");
if (tx.value !== "0") throw new Error("createAuction should never send value");

const signed = await wallet.signTransaction({
  to: tx.to,
  data: tx.data,
  value: 0n,
  gas: BigInt(tx.gas_limit),
});

await fetch(`${AUCTRA_URL}/v1/transactions`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${AUCTRA_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ signed_transaction: signed }),
});   // 202 Accepted
```

## 4. Wait for `auction.created`

The auction is `pending` until the log confirms. **Do not show it to bidders yet.** A broadcast transaction can be dropped from the mempool, replaced by one with a higher fee, or reverted.

```js
app.post("/hooks/auctra", async (req, res) => {
  if (!verify(req.rawBody, req.headers["auctra-signature"], SECRET)) return res.sendStatus(400);
  res.sendStatus(200);                       // acknowledge first, work later

  const event = JSON.parse(req.rawBody);
  if (event.type !== "auction.created") return;

  const { id, onchain_id, metadata } = event.data.object;
  await db.lots.update(metadata.lot_number, { auctionId: id, onchainId: onchain_id, live: true });
});
```

Now it's live.

## Choosing a duration and an increment

**Duration.** Under an hour and bidders in the wrong timezone never see the lot. Over a week and the anti-snipe extension is doing all the work anyway. Most auction houses land between 24 and 72 hours.

**Increment.** `min_increment_bps` is basis points: 500 = 5%. Too low, and two bots grind the price up one wei at a time, burning gas on every step. Too high, and a bidder who wants to add 3% simply doesn't. 250–500 is a reasonable band.

Neither can be changed once the auction is created. That's what makes them credible.
