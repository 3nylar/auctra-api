/**
 * The self-hosted indexer: runs `runIndexerOnce` forever, on an interval.
 *
 * This is for Docker / Railway / any host that keeps a process running
 * continuously. If you're running on Vercel instead, you don't need this
 * file — use `api/tick.ts`, called on a schedule, which does the same work
 * one pass at a time.
 */
import { AUCTION_HOUSE } from "../lib/chain.js";
import { env } from "../lib/env.js";
import { runIndexerOnce } from "./indexerCore.js";
async function main() {
    console.log(`indexer: watching ${AUCTION_HOUSE} on chain ${env.CHAIN_ID}`);
    for (;;) {
        try {
            await runIndexerOnce();
        }
        catch (err) {
            console.error({ err }, "indexer tick failed; retrying");
        }
        await new Promise((r) => setTimeout(r, env.INDEXER_POLL_INTERVAL_MS));
    }
}
void main();
