import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { KEY_PREFIX } from "../lib/env.js";
import { errors } from "../lib/errors.js";
import { hashKey } from "../middleware/auth.js";
import { requireSession } from "../middleware/sessionAuth.js";

const ALL_SCOPES = ["auctions:read", "auctions:write", "webhooks:read", "webhooks:write"] as const;

function serializeKey(k: { id: string; prefix: string; label: string; scopes: string[]; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }) {
  return {
    object: "api_key",
    id: k.id,
    prefix: k.prefix,
    label: k.label,
    scopes: k.scopes,
    status: k.revokedAt ? "revoked" : "active",
    last_used_at: k.lastUsedAt?.toISOString() ?? null,
    created_at: k.createdAt.toISOString(),
  };
}

/**
 * These endpoints authenticate the caller with the dashboard's session
 * cookie (`requireSession`), never with a Bearer API key. That's not a
 * style choice: an API key that could mint or revoke other API keys would
 * turn any leaked key into a way to leak every future key too. Creating a
 * key is something only a logged-in human does.
 */
export async function keyRoutes(app: FastifyInstance) {
  app.get("/v1/keys", { preHandler: requireSession }, async (req) => {
    const keys = await prisma.apiKey.findMany({
      where: { orgId: req.session!.orgId },
      orderBy: { createdAt: "desc" },
    });
    return { object: "list", data: keys.map(serializeKey) };
  });

  app.post("/v1/keys", { preHandler: requireSession }, async (req, reply) => {
    const body = z
      .object({
        label: z.string().min(1).max(100),
        scopes: z.array(z.enum(ALL_SCOPES)).min(1).default([...ALL_SCOPES]),
      })
      .parse(req.body);

    const raw = `${KEY_PREFIX}${randomBytes(24).toString("hex")}`;
    const key = await prisma.apiKey.create({
      data: {
        orgId: req.session!.orgId,
        hash: hashKey(raw),
        prefix: raw.slice(0, 12),
        label: body.label,
        scopes: body.scopes,
      },
    });

    reply.code(201);
    // The only response, ever, that includes the raw key. Not stored
    // anywhere after this — see hashKey in middleware/auth.ts.
    return { ...serializeKey(key), secret: raw };
  });

  app.delete("/v1/keys/:id", { preHandler: requireSession }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const key = await prisma.apiKey.findFirst({ where: { id, orgId: req.session!.orgId } });
    if (!key) throw errors.notFound("API key", id);

    await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    reply.code(200);
    return serializeKey({ ...key, revokedAt: new Date() });
  });
}
