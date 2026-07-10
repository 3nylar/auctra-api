# Auctra API

On-chain English auctions, exposed as HTTP infrastructure. This repository is the API service, the OpenAPI specification, and the developer documentation site.

```
api/           Fastify + Prisma + viem. The HTTP service and the chain indexer.
spec/          OpenAPI 3.1 (openapi.yaml is the source; openapi.json is generated).
docs/          The documentation site. Static HTML, generated from spec/ + content/.
examples/      A client, a webhook receiver, a Python signature verifier.
```

---

## The design in one paragraph

Auctra's settlement layer is a public blockchain, and that imposes a rule no API design can wish away: **a bid transfers the bidder's own ETH, and only the bidder's private key can authorise it.** An endpoint that "just placed a bid" would have to hold that key — turning a trust-minimised auction house into a custodian, which is the precise thing the AuctionHouse contract was written to avoid. So write endpoints return an unsigned `transaction_request`; the caller signs it with the user's wallet and broadcasts it, optionally through `POST /v1/transactions`. Auctra never sees a private key. For operations on a wallet the *organisation itself* owns — listing its own inventory, settling its own auctions — a `mode: "managed"` signer is available. It is rejected on `bid`, permanently.

The consequence: a leaked Auctra API key cannot move anyone's money. It prepares transactions that nobody signs.

---

## What's implemented

**HTTP service** (`api/src`)

- 19 endpoints across auctions, bids, refunds, transactions, webhooks and events.
- Bearer-token auth with per-key scopes. Keys stored as `sha256(key + pepper)`; the raw key is shown once.
- `sk_test_` / `sk_live_` prefixes checked against the host before a database lookup, so an environment mix-up returns `environment_mismatch` rather than `invalid_api_key`.
- Idempotency on every `POST`, backed by a unique `(org, key)` lock inserted before any work happens. Concurrent retries race for the insert; exactly one proceeds.
- Cursor pagination — never offset, because rows are inserted while you page.
- Rate limiting keyed to the API key rather than the IP.
- One error shape everywhere, with a stable `code`, a `request_id`, and a decoded revert reason instead of "execution reverted".

**Indexer** (`api/src/services/indexer.ts`)

- Reads confirmed logs at `head - 2`, so a reorg doesn't un-mine a bid we've already told a customer they won.
- Writes keyed on `(txHash, logIndex)`; replaying a block range is a no-op, so a crash mid-batch is safe.
- Emits eleven event types, dispatches signed webhooks with a 5s→24h backoff over seven attempts, and persists every event to a replayable log.

**Docs** (`docs/`)

- Sixteen pages: four getting-started, seven core concepts, three guides, a changelog, and an API reference generated directly from `spec/openapi.yaml` — so the reference cannot drift from the contract.
- No framework and no runtime data fetching. Every page is a complete HTML document.

---

## Run it locally

```bash
cp api/.env.example api/.env      # fill in RPC_URL and AUCTION_HOUSE_ADDRESS
docker compose up
```

Or without Docker:

```bash
cd api
npm install
npx prisma migrate dev
npm run seed:key -- "Acme Marketplace"   # prints an sk_test_ key, once
npm run dev                              # :8080
npm run indexer                          # in a second terminal
```

```bash
curl localhost:8080/v1/health
```

**Postgres is required, not preferred.** The idempotency table relies on transactional upserts under concurrent writers, and the webhook queue on `SELECT … FOR UPDATE SKIP LOCKED`. SQLite has neither, and fails silently rather than loudly.

The indexer must be a **singleton**. Two of them race for the same cursor row and double-emit events.

---

## Build and host the docs

```bash
cd docs
npm install
npm run build      # → docs/dist, a static site
npm run serve      # → http://localhost:4000
```

`docs/dist` is plain HTML, CSS and two JSON/YAML files. Host it anywhere:

| Host | How |
|---|---|
| **Vercel** | Point at `docs/`. `vercel.json` is committed. |
| **Netlify** | Point at `docs/`. `netlify.toml` is committed. |
| **GitHub Pages** | `npm run build`, publish `docs/dist`. |
| **S3 / Cloudflare / nginx** | `aws s3 sync docs/dist s3://…` |

The API reference is generated from `spec/openapi.json` at build time. Change the spec, rebuild, and the reference follows. There is no second copy of the endpoint list to forget to update.

Fonts come from Google Fonts and the syntax highlighter from cdnjs; both degrade to system fonts and unstyled `<pre>` if you're serving into an air-gapped network. To vendor them, drop the files into `docs/theme/` and swap the two `<link>` tags in `scripts/build.mjs`.

---

## The spec is the contract

`spec/openapi.yaml` drives the reference documentation, and can drive your client:

```bash
npx @hey-api/openapi-ts -i spec/openapi.yaml -o ./generated   # TypeScript
openapi-generator-cli generate -i spec/openapi.yaml -g python  # Python
```

Regenerate `openapi.json` after editing the YAML:

```bash
python3 -c "import yaml,json;json.dump(yaml.safe_load(open('spec/openapi.yaml')),open('spec/openapi.json','w'),indent=2)"
```

---

## Deploying

The service is stateless; scale it horizontally behind any load balancer. The indexer is not; run exactly one.

Environment variables are documented in `api/.env.example`. Three of them decide everything:

- `AUCTRA_ENV` — `sandbox` or `production`. Controls which key prefix is accepted. **Never run one process against both.**
- `CHAIN_ID` + `RPC_URL` — Sepolia (`11155111`) or mainnet (`1`).
- `MANAGED_SIGNER_PRIVATE_KEY` — optional, and only for organisation-owned operations. Leave it empty to run prepare-only, which is the safer default and the one to start with.

`API_KEY_PEPPER` must be at least 32 bytes and must never change: rotating it invalidates every issued key at once.

---

## Endpoints

| | |
|---|---|
| `GET /v1/health` | Unauthenticated. Database, RPC and indexer lag. |
| `GET /v1/auctions` · `POST /v1/auctions` | List and create |
| `GET /v1/auctions/{id}` | Retrieve |
| `POST /v1/auctions/{id}/bids` | Prepare a bid. Never custodial. |
| `GET /v1/auctions/{id}/bids` | Bid history |
| `POST /v1/auctions/{id}/settle` · `/cancel` · `/claim` | Close it out |
| `GET /v1/refunds` · `/balance` · `POST /v1/refunds/withdraw` | Pull-payment credits |
| `POST /v1/transactions` · `GET /v1/transactions/{hash}` | Broadcast and poll |
| `POST /v1/webhook_endpoints` · `GET` · `DELETE` | Subscribe |
| `GET /v1/events` · `/{id}` | The replayable log |

Full reference: `docs/dist/api-reference.html`, or `spec/openapi.yaml`.

---

## License

MIT.
