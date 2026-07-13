# Quickstart

You'll create a sandbox key, confirm it works, list an item, and receive your first webhook. Everything runs on Sepolia testnet, where the ETH is worthless and the code paths are identical to production.

## 1. Get a sandbox key

Sign up, then go to **Developers → API keys** and create a key. It appears once.

```bash
export AUCTRA_KEY="sk_test_4f1c8b9d2e6a0b1c2d3e4f5a6b7c8d9e"
export AUCTRA_URL="https://auctra-api-production.up.railway.app"
```

Sandbox keys start with `sk_test_`, production keys with `sk_live_`. They are not interchangeable, and sending one to the wrong host returns `environment_mismatch` rather than a confusing `invalid_api_key`.

## 2. Confirm the key works

```bash
curl "$AUCTRA_URL/v1/health" \
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
  "rpc": "ok"
}
```

If `head_block` is stale by more than a minute or two, the indexer is behind and your webhooks will be late. That's on us.

## 3. Approve, then list an item

The AuctionHouse contract has to be allowed to escrow the token before it can hold it. This is a token-contract call, not an Auctra one — do it once per collection:

```solidity
IERC721(tokenContract).setApprovalForAll(AUCTION_HOUSE, true);
```

Then create the auction. Sandbox exposes a freely mintable ERC-721 so you don't have to source an NFT to try this.

```bash
curl -X POST "$AUCTRA_URL/v1/auctions" \
  -H "Authorization: Bearer $AUCTRA_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "seller": "0x7a3f1c8b9d2e4f6a0b1c2d3e4f5a6b7c8d9e0f1a",
    "token_contract": "0x2b1d4e6f8a0c2e4f6a8b0d2f4a6c8e0b2d4f6a8c",
    "token_id": "42",
    "reserve_price_wei": "1000000000000000000",
    "duration_seconds": 3600
  }'
```

```json
{
  "object": "auction",
  "id": "auc_3f9a2c7b1d4e",
  "status": "pending",
  "minimum_bid_wei": "1000000000000000000",
  "transaction_request": {
    "object": "transaction_request",
    "chain_id": 11155111,
    "to": "0x5c9d3f1a7b2e4c6d8f0a2b4c6d8e0f2a4b6c8d0e",
    "data": "0x1a2b3c4d...",
    "value": "0",
    "gas_limit": "184920"
  },
  "next_step": "Sign transaction_request with the seller's wallet, then POST the signed payload to /v1/transactions."
}
```

Note the status: **`pending`**, not `live`. Nothing has happened on-chain yet. You have a transaction, not an auction.

## 4. Sign and broadcast

Sign `transaction_request` with the seller's wallet. Any library works; here's viem:

```js
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const account = privateKeyToAccount(process.env.SELLER_KEY);
const wallet = createWalletClient({ account, chain: sepolia, transport: http() });

const { transaction_request: tx } = await createAuction();

const signed = await wallet.signTransaction({
  to: tx.to,
  data: tx.data,
  value: BigInt(tx.value),
  gas: BigInt(tx.gas_limit),
});

// Broadcast through us, or through any node you like.
const res = await fetch(`${process.env.AUCTRA_URL}/v1/transactions`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.AUCTRA_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ signed_transaction: signed }),
});

const { hash } = await res.json(); // 202 Accepted — pending, not confirmed
```

The response is `202 Accepted`, not `200 OK`. The chain hasn't decided yet. Roughly fifteen seconds later, once the log is two blocks deep, the auction flips to `live` and we send you:

```json
{
  "id": "evt_7c2e9a1f4b6d",
  "type": "auction.created",
  "created_at": "2026-07-09T10:31:04.882Z",
  "data": { "object": { "id": "auc_3f9a2c7b1d4e", "status": "live", "onchain_id": 117 } }
}
```

That's the whole loop. **Don't show the auction to bidders before this event arrives** — a broadcast transaction can still be dropped, replaced, or reverted.

## Where to go next

- **[The signing model](signing-model.html)** — why there's no `POST /bids` that just works, and what to do about it.
- **[Auction lifecycle](auction-lifecycle.html)** — the six states, and which of them the clock can change under you.
- **[Webhooks](webhooks.html)** — verify the signature before you trust the body.
- **[API reference](api-reference.html)** — every endpoint, every field.
