import { createHmac, timingSafeEqual } from "node:crypto";
/**
 * Webhook signatures, Stripe-style, and for the same reason: a bare HMAC of
 * the body can be replayed forever. Signing `timestamp.body` and rejecting
 * anything older than the tolerance turns a captured request into a dead one.
 *
 *   Auctra-Signature: t=1752076800,v1=5257a869e7...
 */
export function signPayload(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
    const signed = `${timestamp}.${payload}`;
    const v1 = createHmac("sha256", secret).update(signed).digest("hex");
    return { header: `t=${timestamp},v1=${v1}`, timestamp, v1 };
}
export function verifySignature(opts) {
    const tolerance = opts.toleranceSeconds ?? 300;
    const parts = Object.fromEntries(opts.header.split(",").map((kv) => kv.split("=").map((s) => s.trim())));
    const t = Number(parts.t);
    const v1 = parts.v1;
    if (!Number.isFinite(t) || !v1)
        return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - t) > tolerance)
        return false;
    const expected = createHmac("sha256", opts.secret).update(`${t}.${opts.payload}`).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(v1, "hex");
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
