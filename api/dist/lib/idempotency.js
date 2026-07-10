import { createHash } from "node:crypto";
import { prisma } from "./db.js";
import { errors } from "./errors.js";
const TTL_HOURS = 24;
/**
 * Every POST that touches the chain is idempotent on `Idempotency-Key`.
 *
 * The failure mode this prevents is specific and expensive: a client POSTs a
 * bid, the connection drops before the response arrives, the client retries,
 * and the bidder has now committed twice the ETH. Retrying is the *correct*
 * behaviour for a client that doesn't know whether the first call landed — so
 * the server has to make retrying safe.
 *
 * Same key + same body  -> replay the stored response, verbatim.
 * Same key + diff body  -> 409. The key names a request, not a slot.
 * Same key, in flight   -> 409, retry shortly. (No second broadcast.)
 */
export async function withIdempotency(req, reply, orgId, handler) {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length === 0) {
        const result = await handler();
        reply.code(result.status);
        return result.body;
    }
    const requestHash = createHash("sha256")
        .update(JSON.stringify(req.body ?? {}))
        .digest("hex");
    const existing = await prisma.idempotencyKey.findUnique({
        where: { orgId_key: { orgId, key } },
    });
    if (existing) {
        if (existing.requestHash !== requestHash)
            throw errors.idempotencyConflict();
        if (!existing.completedAt)
            throw errors.idempotencyInFlight();
        reply.code(existing.statusCode ?? 200).header("idempotent-replay", "true");
        return existing.responseBody;
    }
    // Insert the lock first. A unique constraint on (orgId, key) means two
    // concurrent retries race here and exactly one proceeds.
    try {
        await prisma.idempotencyKey.create({
            data: {
                orgId,
                key,
                method: req.method,
                path: req.url,
                requestHash,
                expiresAt: new Date(Date.now() + TTL_HOURS * 3600 * 1000),
            },
        });
    }
    catch {
        throw errors.idempotencyInFlight();
    }
    const result = await handler();
    await prisma.idempotencyKey.update({
        where: { orgId_key: { orgId, key } },
        data: {
            statusCode: result.status,
            responseBody: result.body,
            completedAt: new Date(),
        },
    });
    reply.code(result.status);
    return result.body;
}
