/**
 * One indexer pass, triggered by an HTTP request instead of a loop.
 *
 * Vercel doesn't run long-lived processes — a function runs, responds, and
 * is torn down. So instead of watching the chain continuously, this does
 * one catch-up pass per call and exits. Call it every minute (a free
 * external scheduler like cron-job.org works well) and the net effect is
 * the same as the long-running indexer, just assembled from many short
 * runs instead of one endless one.
 *
 * Protected by a shared secret in the URL, so it isn't a public button
 * anyone on the internet can mash to spam your database and RPC provider.
 * Sandbox stakes are low, but there's no reason to leave it open.
 */
import { runIndexerOnce } from "../src/services/indexerCore.js";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-cron-secret");

  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const result = await runIndexerOnce();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export const config = { runtime: "nodejs" };
