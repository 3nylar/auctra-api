import { createHash } from "node:crypto";
import { prisma } from "../lib/db.js";
import { env, KEY_PREFIX } from "../lib/env.js";
import { errors } from "../lib/errors.js";
/** Keys are stored as sha256(key + pepper). A database dump yields nothing usable. */
export function hashKey(raw) {
    return createHash("sha256").update(raw + env.API_KEY_PEPPER).digest("hex");
}
export async function authenticate(req, _reply) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
        throw errors.unauthenticated();
    const raw = header.slice(7).trim();
    // Reject a live key on a sandbox host before touching the database. Mixing
    // environments is the single most common integration bug, and the error
    // should say so rather than reading "invalid key".
    if (raw.startsWith("sk_live_") || raw.startsWith("sk_test_")) {
        if (!raw.startsWith(KEY_PREFIX))
            throw errors.wrongEnvironment(raw.slice(0, 8));
    }
    else {
        throw errors.invalidKey();
    }
    const key = await prisma.apiKey.findUnique({ where: { hash: hashKey(raw) } });
    if (!key || key.revokedAt)
        throw errors.invalidKey();
    req.auth = { orgId: key.orgId, keyId: key.id, scopes: key.scopes };
    // Fire-and-forget: last-used tracking must never add latency to the request.
    void prisma.apiKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => { });
}
export function requireScope(scope) {
    return async (req) => {
        if (!req.auth)
            throw errors.unauthenticated();
        if (!req.auth.scopes.includes(scope))
            throw errors.missingScope(scope);
    };
}
