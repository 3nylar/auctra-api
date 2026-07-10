import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { errors } from "../lib/errors.js";
import { newEndpointRef } from "../lib/ids.js";
import { listResponse, paginationSchema } from "../lib/pagination.js";
import { serializeEvent } from "../lib/serialize.js";
import { requireScope } from "../middleware/auth.js";
export const EVENT_TYPES = [
    "auction.created",
    "auction.bid_placed",
    "auction.outbid",
    "auction.extended",
    "auction.ending_soon",
    "auction.ended",
    "auction.settled",
    "auction.cancelled",
    "refund.credited",
    "refund.withdrawn",
    "item.claimed",
];
export async function webhookRoutes(app) {
    app.post("/v1/webhook_endpoints", { preHandler: requireScope("webhooks:write") }, async (req, reply) => {
        const body = z
            .object({
            url: z.string().url().startsWith("https://", "Webhook URLs must be HTTPS."),
            enabled_events: z.array(z.enum(EVENT_TYPES)).min(1),
        })
            .parse(req.body);
        const secret = `whsec_${randomBytes(24).toString("hex")}`;
        const endpoint = await prisma.webhookEndpoint.create({
            data: {
                ref: newEndpointRef(),
                orgId: req.auth.orgId,
                url: body.url,
                secret,
                enabledEvents: body.enabled_events,
            },
        });
        reply.code(201);
        return {
            object: "webhook_endpoint",
            id: endpoint.ref,
            url: endpoint.url,
            enabled_events: endpoint.enabledEvents,
            // Shown exactly once. We store it, but never return it again.
            secret,
            created_at: endpoint.createdAt.toISOString(),
        };
    });
    app.get("/v1/webhook_endpoints", { preHandler: requireScope("webhooks:read") }, async (req) => {
        const rows = await prisma.webhookEndpoint.findMany({ where: { orgId: req.auth.orgId } });
        return {
            object: "list",
            data: rows.map((e) => ({
                object: "webhook_endpoint",
                id: e.ref,
                url: e.url,
                enabled_events: e.enabledEvents,
                status: e.disabledAt ? "disabled" : "enabled",
                created_at: e.createdAt.toISOString(),
            })),
            has_more: false,
            next_cursor: null,
        };
    });
    app.delete("/v1/webhook_endpoints/:id", { preHandler: requireScope("webhooks:write") }, async (req, reply) => {
        const { id } = z.object({ id: z.string() }).parse(req.params);
        const endpoint = await prisma.webhookEndpoint.findFirst({ where: { ref: id, orgId: req.auth.orgId } });
        if (!endpoint)
            throw errors.notFound("webhook endpoint", id);
        await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
        reply.code(200);
        return { object: "webhook_endpoint", id, deleted: true };
    });
    // ---- Event log ---------------------------------------------------------
    // Every webhook we send is also a durable, replayable row. If your listener
    // was down for an hour, you do not need us to redeliver: read the log.
    app.get("/v1/events", { preHandler: requireScope("auctions:read") }, async (req) => {
        const q = paginationSchema.extend({ type: z.string().optional() }).parse(req.query);
        const rows = await prisma.event.findMany({
            where: { orgId: req.auth.orgId, ...(q.type ? { type: q.type } : {}) },
            take: q.limit + 1,
            ...(q.starting_after ? { skip: 1, cursor: { ref: q.starting_after } } : {}),
            orderBy: { createdAt: "desc" },
        });
        return listResponse(rows.map(serializeEvent), q.limit, (e) => e.id);
    });
    app.get("/v1/events/:id", { preHandler: requireScope("auctions:read") }, async (req) => {
        const { id } = z.object({ id: z.string() }).parse(req.params);
        const event = await prisma.event.findFirst({ where: { ref: id, orgId: req.auth.orgId } });
        if (!event)
            throw errors.notFound("event", id);
        return serializeEvent(event);
    });
}
