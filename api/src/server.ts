import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./lib/env.js";
import { newRequestId } from "./lib/ids.js";
import { authenticate } from "./middleware/auth.js";
import { registerErrorHandler } from "./middleware/errorHandler.js";
import { auctionRoutes } from "./routes/auctions.js";
import { refundRoutes } from "./routes/refunds.js";
import { transactionRoutes } from "./routes/transactions.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { healthRoutes } from "./routes/health.js";

export async function buildServer() {
  const app = Fastify({
    logger: { level: env.NODE_ENV === "development" ? "debug" : "info" },
    // Echoed back on every response and every error. When someone opens a
    // support ticket, this is the only string we need from them.
    genReqId: () => newRequestId(),
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: false }); // server-to-server only; keys never belong in a browser

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    // Limit by API key, not IP. Two customers behind one NAT should not
    // exhaust each other's budget.
    keyGenerator: (req) => req.auth?.keyId ?? req.ip,
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
  });

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("auctra-request-id", req.id);
    reply.header("auctra-version", "2026-07-01");
    return payload;
  });

  registerErrorHandler(app);

  await app.register(healthRoutes);

  // Everything under /v1 except /v1/health requires a key.
  await app.register(async (instance) => {
    instance.addHook("preHandler", authenticate);
    await instance.register(auctionRoutes);
    await instance.register(refundRoutes);
    await instance.register(transactionRoutes);
    await instance.register(webhookRoutes);
  });

  return app;
}
