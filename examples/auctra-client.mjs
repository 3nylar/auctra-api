/**
 * A minimal Auctra client, in about a hundred lines.
 *
 * Covers the three things every integration needs and most get wrong:
 * idempotent POSTs, exponential backoff with jitter, and never treating a
 * broadcast transaction as a confirmed one.
 *
 *   node auctra-client.mjs
 */
import { randomUUID } from "node:crypto";

const AUCTRA_URL =
  process.env.AUCTRA_URL ?? "https://auctra-api-production.up.railway.app";
const AUCTRA_KEY = process.env.AUCTRA_KEY;

export class AuctraError extends Error {
  constructor(error, status) {
    super(error.message);
    this.name = "AuctraError";
    this.code = error.code; // switch on this
    this.type = error.type;
    this.param = error.param;
    this.detail = error.detail;
    this.requestId = error.request_id; // quote this to support
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(method, path, { body, idempotencyKey } = {}) {
  // The same key on every retry is the entire point. Generating a fresh one
  // inside the loop would defeat it.
  const key = idempotencyKey ?? (method === "POST" ? randomUUID() : undefined);

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${AUCTRA_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${AUCTRA_KEY}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.ok) return res.json();

    const { error } = await res.json();

    const retryable =
      res.status >= 500 ||
      res.status === 429 ||
      error.code === "idempotency_request_in_flight";

    if (!retryable) throw new AuctraError(error, res.status);

    const after = Number(res.headers.get("retry-after") ?? 0) * 1000;
    // Jitter, or ten workers wake up in the same millisecond and collide again.
    await sleep(Math.max(after, 2 ** attempt * 250) + Math.random() * 250);
  }
  throw new Error("exhausted retries");
}

export const auctra = {
  health: () => request("GET", "/v1/health"),

  listAuctions: (params = {}) =>
    request("GET", `/v1/auctions?${new URLSearchParams(params)}`),

  getAuction: (id) => request("GET", `/v1/auctions/${id}`),

  createAuction: (body, key) =>
    request("POST", "/v1/auctions", { body, idempotencyKey: key }),

  prepareBid: (id, body, key) =>
    request("POST", `/v1/auctions/${id}/bids`, { body, idempotencyKey: key }),

  broadcast: (signed, key) =>
    request("POST", "/v1/transactions", {
      body: { signed_transaction: signed },
      idempotencyKey: key,
    }),

  getTransaction: (hash) => request("GET", `/v1/transactions/${hash}`),

  refundBalance: (bidder) =>
    request("GET", `/v1/refunds/balance?bidder=${bidder}`),

  /** Every auction, one page at a time. Cursors, so nothing is skipped or seen twice. */
  async *auctions(params = {}) {
    let cursor = null;
    do {
      const page = await auctra.listAuctions({
        ...params,
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      });
      yield* page.data;
      cursor = page.next_cursor;
    } while (cursor);
  },

  /** Poll a hash until the chain decides. Never assume a broadcast is a win. */
  async waitForConfirmation(
    hash,
    { confirmations = 2, timeoutMs = 180_000 } = {},
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tx = await auctra.getTransaction(hash);
      if (tx.status === "reverted")
        throw new Error(`transaction reverted: ${hash}`);
      if (tx.status === "confirmed" && tx.confirmations >= confirmations)
        return tx;
      await sleep(3000);
    }
    throw new Error(`timed out waiting for ${hash}`);
  },
};

// --- demo -------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const health = await auctra.health();
  console.log(
    `${health.environment} · chain ${health.chain_id} · block ${health.head_block}`,
  );

  let live = 0;
  for await (const a of auctra.auctions({ status: "live" })) {
    console.log(
      `${a.id}  ${a.minimum_bid_display.padStart(10)} ETH  closes ${a.end_time}`,
    );
    live++;
  }
  console.log(`\n${live} live auctions`);
}
