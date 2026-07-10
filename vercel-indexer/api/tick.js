import { runIndexerOnce } from "../lib/indexerCore.js";

export default async function handler(req, res) {
  // 1. Safe URL parsing using old-school Node headers
  const host = req.headers['host'] || 'localhost';
  const url = new URL(req.url, `https://${host}`);
  
  const provided = url.searchParams.get("secret") ?? req.headers['x-cron-secret'];

  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const result = await runIndexerOnce();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

// Keep it on the standard Node.js runtime so Prisma and Crypto work!
export const config = { runtime: "nodejs" };