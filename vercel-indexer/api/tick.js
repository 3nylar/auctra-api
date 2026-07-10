/**
 * One indexer pass, triggered by an HTTP request instead of a loop.
 *
 * This entire folder is deliberately free of TypeScript — no .ts files, no
 * tsconfig.json anywhere in it or above it up to the Vercel project root.
 * Vercel's Node builder does an extra, mandatory type-check step whenever it
 * finds TypeScript in a project, and that step was crashing during build for
 * reasons we couldn't fully pin down even after reading its source directly.
 * Rather than keep chasing a closed loop, this sidesteps it by construction:
 * with no TypeScript reachable from here, that code path can't run at all.
 *
 * Logic is a plain-JS port of the same indexer that runs on Railway — same
 * behaviour, same schema, same events, just without the type layer.
 */
import { runIndexerOnce } from "../lib/indexerCore.js";

export default async function handler(req) {
  // Fallback to localhost if the host header is missing, ensuring a valid full URL
  const host = req.headers.get("host") || "localhost";
  const url = new URL(req.url, `https://${host}`);
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
