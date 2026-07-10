/**
 * A webhook receiver that does the three things that matter:
 * verifies the signature over the RAW body, deduplicates on the event id,
 * and answers in milliseconds while the real work happens elsewhere.
 *
 *   npm i express && node webhook-receiver.mjs
 */
import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.AUCTRA_WEBHOOK_SECRET;
const TOLERANCE = 300; // seconds

function verify(rawBody, header) {
  if (!header) return false;

  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;

  // Without the timestamp check a captured request replays forever.
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE) return false;

  const expected = createHmac("sha256", SECRET).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, "hex");

  // Constant time: `===` leaks how much of a forged signature was correct.
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const app = express();
const seen = new Set(); // use Redis in production; a Set dies with the process

app.post(
  "/hooks/auctra",
  // The RAW body. JSON.stringify(req.body) reorders keys and the HMAC never matches.
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const raw = req.body.toString("utf8");

    if (!verify(raw, req.headers["auctra-signature"])) {
      return res.status(400).send("bad signature");
    }

    const eventId = req.headers["auctra-event-id"];
    if (seen.has(eventId)) return res.sendStatus(200); // at-least-once: duplicates are normal
    seen.add(eventId);

    // Acknowledge first. You have ten seconds, and settling an auction takes longer.
    res.sendStatus(200);

    const event = JSON.parse(raw);
    await enqueue(event);
  },
);

async function enqueue(event) {
  const auction = event.data.object;
  switch (event.type) {
    case "auction.created":
      console.log(`${auction.id} is live on-chain as #${auction.onchain_id}`);
      break;
    case "auction.extended":
      // Reset the countdown. Do not decrement a cached one.
      console.log(`${auction.id} extended → ${auction.end_time}`);
      break;
    case "auction.outbid":
      console.log(`${auction.outbid_bidder} can withdraw ${auction.refund_wei} wei`);
      break;
    case "auction.ended":
      // Settle on a queue, not here.
      console.log(`${auction.id} ended; queueing settlement`);
      break;
    case "auction.settled": {
      const ZERO = "0x0000000000000000000000000000000000000000";
      if (auction.winner === ZERO) console.log(`${auction.id} closed with no sale`);
      else console.log(`${auction.id} won by ${auction.winner}`);
      break;
    }
  }
}

app.listen(3000, () => console.log("listening on :3000/hooks/auctra"));
