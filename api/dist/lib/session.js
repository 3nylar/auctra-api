import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
/**
 * Deliberately not a database-backed session table. A signed, self-contained
 * token — payload plus an HMAC over it — is enough for a dashboard this
 * size, and it's one less table to migrate and one less query on every
 * request. The trade-off, stated plainly: there is no way to revoke a single
 * session early short of rotating SESSION_SECRET, which revokes all of them
 * at once. For "log out of the Auctra dashboard," that trade-off is fine.
 */
export function createSession(payload) {
    const body = { ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
    const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
    const sig = createHmac("sha256", env.SESSION_SECRET).update(encoded).digest("base64url");
    return `${encoded}.${sig}`;
}
export function verifySession(token) {
    if (!token)
        return null;
    const [encoded, sig] = token.split(".");
    if (!encoded || !sig)
        return null;
    const expected = createHmac("sha256", env.SESSION_SECRET).update(encoded).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
        return null;
    try {
        const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        if (payload.exp < Math.floor(Date.now() / 1000))
            return null;
        return payload;
    }
    catch {
        return null;
    }
}
export const SESSION_COOKIE = "auctra_session";
