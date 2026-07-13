import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./lib/env.js";
import { newRequestId } from "./lib/ids.js";
import { authenticate } from "./middleware/auth.js";
import { registerErrorHandler } from "./middleware/errorHandler.js";
import { auctionRoutes } from "./routes/auctions.js";
import { authRoutes } from "./routes/auth.js";
import { keyRoutes } from "./routes/keys.js";
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

  // Everywhere except the dashboard, this API is server-to-server: keys
  // never belong in a browser, so browser-origin requests are refused by
  // default. The one deliberate exception is the dashboard itself, which
  // needs cookies to survive a cross-site fetch (auctra-api.vercel.app
  // calling auctra-api-production.up.railway.app — two different sites as
  // far as a browser is concerned). Allowing exactly ONE named origin, not
  // a wildcard and not a reflected Origin header, is what keeps that
  // exception from becoming an exception for every site on the internet:
  // a browser will only attach the session cookie if the server's
  // Access-Control-Allow-Origin echoes back the caller's own origin
  // precisely, so no other origin can trigger a credentialed request here
  // even though credentials are enabled.
  await app.register(cors, {
    origin: [env.DASHBOARD_ORIGIN],
    credentials: true,
  });

  await app.register(cookie);

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

  // Dashboard routes: authenticated by session cookie (or, for signup/login/
  // logout, not authenticated at all yet — that's the point). Deliberately
  // its own registration block, sitting outside the Bearer-key block below,
  // so an API key can never be used to call these and a session cookie can
  // never be used to call the auction endpoints.
  await app.register(async (instance) => {
    // Brute-force protection tighter than the general API limit. Keyed by
    // IP since there's no key/session yet at the point someone's guessing
    // a password.
    await instance.register(rateLimit, {
      max: 10,
      timeWindow: "1 minute",
      keyGenerator: (req) => req.ip,
    });
    await instance.register(authRoutes);
    await instance.register(keyRoutes);
  });

  // Everything under /v1 except /v1/health and the dashboard routes above
  // requires a key.
  await app.register(async (instance) => {
    instance.addHook("preHandler", authenticate);
    await instance.register(auctionRoutes);
    await instance.register(refundRoutes);
    await instance.register(transactionRoutes);
    await instance.register(webhookRoutes);
  });

  return app;
}
