import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Address } from "viem";
import { prisma } from "../lib/db.js";
import { pendingReturns, prepare } from "../lib/chain.js";
import { display } from "../lib/money.js";
import { listResponse, paginationSchema } from "../lib/pagination.js";
import { serializeRefund } from "../lib/serialize.js";
import { requireScope } from "../middleware/auth.js";
import { withIdempotency } from "../lib/idempotency.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

/**
 * Outbid bidders are not paid out; they are *credited*. The contract cannot
 * push ETH to an arbitrary address without letting a malicious contract revert
 * on receive and freeze the auction for everybody else. So refunds are pulled.
 * These endpoints exist to make "you have money waiting" a first-class,
 * queryable fact rather than something a user has to know to go look for.
 */
export async function refundRoutes(app: FastifyInstance) {
  app.get("/v1/refunds", { preHandler: requireScope("auctions:read") }, async (req) => {
    const q = paginationSchema.extend({ bidder: addressSchema.optional(), withdrawn: z.coerce.boolean().optional() }).parse(req.query);

    const rows = await prisma.refund.findMany({
      where: {
        ...(q.bidder ? { bidder: q.bidder.toLowerCase() } : {}),
        ...(q.withdrawn !== undefined ? { withdrawn: q.withdrawn } : {}),
      },
      take: q.limit + 1,
      ...(q.starting_after ? { skip: 1, cursor: { ref: q.starting_after } } : {}),
      orderBy: { createdAt: "desc" },
    });

    return listResponse(rows.map(serializeRefund), q.limit, (r) => r.id);
  });

  /** Live on-chain balance, not the cached sum. Use this before withdrawing. */
  app.get("/v1/refunds/balance", { preHandler: requireScope("auctions:read") }, async (req) => {
    const { bidder } = z.object({ bidder: addressSchema }).parse(req.query);
    const balance = await pendingReturns(bidder as Address);
    return {
      object: "refund_balance",
      bidder: bidder.toLowerCase(),
      withdrawable_wei: balance.toString(),
      withdrawable_display: display(balance),
      source: "chain",
    };
  });

  app.post("/v1/refunds/withdraw", { preHandler: requireScope("auctions:write") }, async (req, reply) => {
    const { bidder } = z.object({ bidder: addressSchema }).parse(req.body);
    return withIdempotency(req, reply, req.auth!.orgId, async () => {
      const tx = await prepare({ functionName: "withdraw", args: [], from: bidder as Address });
      return {
        status: 200,
        body: {
          object: "withdrawal_intent",
          bidder: bidder.toLowerCase(),
          transaction_request: tx,
          next_step: "Sign with the bidder's wallet. withdraw() sweeps the full credited balance.",
        },
      };
    });
  });
}
