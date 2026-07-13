# Environments

|                | Sandbox                                        | Production                      |
| -------------- | ---------------------------------------------- | ------------------------------- |
| Base URL       | `https://auctra-api-production.up.railway.app` | `https://auctra-api.vercel.app` |
| Key prefix     | `sk_test_`                                     | `sk_live_`                      |
| Chain          | Sepolia (`11155111`)                           | Ethereum mainnet (`1`)          |
| ETH            | Worthless. [Faucet](https://sepoliafaucet.com) | Real                            |
| Block time     | ~12s                                           | ~12s                            |
| Data retention | Reset periodically                             | Permanent                       |

The only differences are the chain and the key prefix. Sandbox is not a mock: transactions are really signed, really broadcast, really mined, and really reverted when they're wrong. Reorgs happen. Gas estimation fails. RPC nodes go down. This is on purpose — a sandbox that always succeeds teaches you nothing about the failure paths you'll meet on a Tuesday afternoon in production.

## Going live

```diff
- export AUCTRA_URL="https://auctra-api-production.up.railway.app"
- export AUCTRA_KEY="sk_test_..."
+ export AUCTRA_URL="https://auctra-api.vercel.app"
+ export AUCTRA_KEY="sk_live_..."
```

That's the whole migration. Same paths, same payloads, same webhook shapes.

Before you flip it, three things that only bite on mainnet:

**Gas is a real cost, and someone pays it.** `createAuction` runs roughly 185,000 gas; `bid` around 62,000. At 30 gwei that's about $0.02 and $0.007 per call respectively, but mainnet has spent whole afternoons above 200 gwei. If your product absorbs seller gas, put a ceiling on it. The `gas_limit` we return already carries 20% headroom over the estimate.

**Confirmations are a product decision.** We index at two confirmations, which is fine for a $50 lot and thin for a $500,000 one. Nothing stops you from waiting for twelve before you tell the winner they've won.

**Test ETH habits don't transfer.** In sandbox you'll happily let a bidder's wallet sit at zero and top it up. In production, a bid that reverts for insufficient funds has still burned the bidder's gas, and they will email you about it. Check the balance before you prepare the transaction.

## Sandbox helpers

Sandbox exposes a freely mintable ERC-721 at the `COLLECTIBLE_ADDRESS` returned by `GET /v1/health`, so you never have to source a real NFT to test a listing flow.

Sepolia data resets when the network does. Don't build a fixture suite that assumes an auction created in March is still there in July.
