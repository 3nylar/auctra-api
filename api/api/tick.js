/**
 * One indexer pass, triggered by an HTTP request instead of a loop.
 *
 * Plain JavaScript, deliberately. Vercel's build does an extra, mandatory
 * TypeScript type-check on every .ts file with no way to opt out of it, and
 * that step is what was crashing (see the failed builds this replaces).
 * Sidestepping it entirely was more reliable than chasing the cause inside a
 * closed-source compiler pass we can't fully inspect.
 *
 * This imports the SAME compiled output Railway runs — not a duplicate
 * copy — so there's exactly one implementation of the indexer logic, built
 * once, used by both hosts.
 */
import { runIndexerOnce } from "../dist/services/indexerCore.js";

export default async function handler(req) {
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("secret") ?? req.headers.get("x-cron-secret");

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
