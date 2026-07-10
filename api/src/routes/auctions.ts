import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { errors } from "../lib/errors.js";
import { newAuctionRef } from "../lib/ids.js";
import { assertWei, minimumBid } from "../lib/money.js";
import { listResponse, paginationSchema } from "../lib/pagination.js";
import { effectiveStatus, serializeAuction, serializeBid } from "../lib/serialize.js";
import { prepare, sendManaged, managedSignerEnabled } from "../lib/chain.js";
import { withIdempotency } from "../lib/idempotency.js";
import { requireScope } from "../middleware/auth.js";
import type { Address } from "viem";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a 20-byte hex address.");

const createSchema = z.object({
  mode: z.enum(["prepared", "managed"]).default("prepared"),
  seller: addressSchema,
  token_contract: addressSchema,
  token_id: z.string().regex(/^[0-9]+$/),
  reserve_price_wei: z.string(),
  duration_seconds: z.number().int().min(60).max(60 * 60 * 24 * 30),
  min_increment_bps: z.number().int().min(1).max(10_000).default(500),
  metadata: z.record(z.any()).optional(),
});

const listSchema = paginationSchema.extend({
  status: z.enum(["pending", "live", "ending", "ended", "settled", "cancelled"]).optional(),
  seller: addressSchema.optional(),
  token_contract: addressSchema.optional(),
});

export async function auctionRoutes(app: FastifyInstance) {
  // ---- List -------------------------------------------------------------
  app.get("/v1/auctions", { preHandler: requireScope("auctions:read") }, async (req) => {
    const q = listSchema.parse(req.query);

    const rows = await prisma.auction.findMany({
      where: {
        orgId: req.auth!.orgId,
        ...(q.seller ? { seller: q.seller.toLowerCase() } : {}),
        ...(q.token_contract ? { tokenContract: q.token_contract.toLowerCase() } : {}),
      },
      take: q.limit + 1, // one extra row is how we know `has_more` without COUNT(*)
      ...(q.starting_after ? { skip: 1, cursor: { ref: q.starting_after } } : {}),
      orderBy: { createdAt: "desc" },
    });

    // `status` is time-derived, so it is filtered after hydration rather than
    // in SQL — a row stored as "live" may already be "ended" by the clock.
    const filtered = q.status ? rows.filter((r) => effectiveStatus(r) === q.status) : rows;

    return listResponse(filtered.map(serializeAuction), q.limit, (a) => a.id);
  });

  // ---- Retrieve ---------------------------------------------------------
  app.get("/v1/auctions/:id", { preHandler: requireScope("auctions:read") }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const auction = await prisma.auction.findFirst({
      where: { ref: id, orgId: req.auth!.orgId },
    });
    if (!auction) throw errors.notFound("auction", id);
    return serializeAuction(auction);
  });

  // ---- Create -----------------------------------------------------------
  app.post("/v1/auctions", { preHandler: requireScope("auctions:write") }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const reserve = assertWei(body.reserve_price_wei, "reserve_price_wei");

    if (body.mode === "managed" && !managedSignerEnabled) throw errors.managedSignerDisabled();

    return withIdempotency(req, reply, req.auth!.orgId, async () => {
      const tx = await prepare({
        functionName: "createAuction",
        args: [body.token_contract as Address, BigInt(body.token_id), reserve, BigInt(body.duration_seconds)],
        from: body.seller as Address,
      });

      const now = new Date();
      const auction = await prisma.auction.create({
        data: {
          ref: newAuctionRef(),
          orgId: req.auth!.orgId,
          chainId: tx.chain_id,
          contract: tx.to.toLowerCase(),
          seller: body.seller.toLowerCase(),
          tokenContract: body.token_contract.toLowerCase(),
          tokenId: BigInt(body.token_id),
          reservePriceWei: reserve.toString(),
          minIncrementBps: body.min_increment_bps,
          startTime: now,
          endTime: new Date(now.getTime() + body.duration_seconds * 1000),
          metadata: body.metadata ?? {},
          status: "pending",
        },
      });

      if (body.mode === "managed") {
        const hash = await sendManaged(tx);
        const updated = await prisma.auction.update({
          where: { id: auction.id },
          data: { createTxHash: hash },
        });
        // Still `pending`. It becomes `live` when the indexer sees
        // AuctionCreated confirmed — a broadcast is not a confirmation.
        return { status: 201, body: { ...serializeAuction(updated), transaction_hash: hash } };
      }

      return {
        status: 201,
        body: {
          ...serializeAuction(auction),
          transaction_request: tx,
          next_step:
            "Sign transaction_request with the seller's wallet, then POST the signed payload to /v1/transactions.",
        },
      };
    });
  });

  // ---- Bids on an auction ----------------------------------------------
  app.get("/v1/auctions/:id/bids", { preHandler: requireScope("auctions:read") }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const q = paginationSchema.parse(req.query);

    const auction = await prisma.auction.findFirst({ where: { ref: id, orgId: req.auth!.orgId } });
    if (!auction) throw errors.notFound("auction", id);

    const bids = await prisma.bid.findMany({
      where: { auctionId: auction.id },
      take: q.limit + 1,
      ...(q.starting_after ? { skip: 1, cursor: { ref: q.starting_after } } : {}),
      orderBy: { placedAt: "desc" },
      include: { auction: { select: { ref: true } } },
    });

    return listResponse(bids.map(serializeBid), q.limit, (b) => b.id);
  });

  // ---- Place a bid ------------------------------------------------------
  app.post("/v1/auctions/:id/bids", { preHandler: requireScope("auctions:write") }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ bidder: addressSchema, amount_wei: z.string() })
      .parse(req.body);

    const auction = await prisma.auction.findFirst({ where: { ref: id, orgId: req.auth!.orgId } });
    if (!auction) throw errors.notFound("auction", id);

    const status = effectiveStatus(auction);
    if (status !== "live" && status !== "ending") throw errors.auctionNotLive(status);

    const amount = assertWei(body.amount_wei, "amount_wei");
    const min = minimumBid(BigInt(auction.highestBidWei), BigInt(auction.reservePriceWei), auction.minIncrementBps);
    if (amount < min) throw errors.bidBelowMinimum(min.toString());

    return withIdempotency(req, reply, req.auth!.orgId, async () => {
      // There is no `managed` mode here, by design. Bidding spends the
      // bidder's ETH; only the bidder's key may authorise it.
      const tx = await prepare({
        functionName: "bid",
        args: [auction.onchainId ?? 0n],
        value: amount,
        from: body.bidder as Address,
      });

      return {
        status: 200,
        body: {
          object: "bid_intent",
          auction: auction.ref,
          bidder: body.bidder.toLowerCase(),
          amount_wei: amount.toString(),
          minimum_bid_wei: min.toString(),
          transaction_request: tx,
          expires_at: auction.endTime.toISOString(),
          next_step:
            "Sign transaction_request with the bidder's wallet. A bid.placed webhook fires once it confirms.",
        },
      };
    });
  });

  // ---- Settle -----------------------------------------------------------
  app.post("/v1/auctions/:id/settle", { preHandler: requireScope("auctions:write") }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ mode: z.enum(["prepared", "managed"]).default("prepared") }).parse(req.body ?? {});

    const auction = await prisma.auction.findFirst({ where: { ref: id, orgId: req.auth!.orgId } });
    if (!auction) throw errors.notFound("auction", id);
    if (new Date() < auction.endTime) throw errors.auctionNotEnded(auction.endTime.toISOString());

    return withIdempotency(req, reply, req.auth!.orgId, async () => {
      const tx = await prepare({ functionName: "endAuction", args: [auction.onchainId ?? 0n] });

      if (body.mode === "managed") {
        const hash = await sendManaged(tx);
        const updated = await prisma.auction.update({
          where: { id: auction.id },
          data: { settleTxHash: hash },
        });
        return { status: 200, body: { ...serializeAuction(updated), transaction_hash: hash } };
      }
      return { status: 200, body: { ...serializeAuction(auction), transaction_request: tx } };
    });
  });

  // ---- Cancel -----------------------------------------------------------
  app.post("/v1/auctions/:id/cancel", { preHandler: requireScope("auctions:write") }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const auction = await prisma.auction.findFirst({ where: { ref: id, orgId: req.auth!.orgId } });
    if (!auction) throw errors.notFound("auction", id);
    if (BigInt(auction.highestBidWei) > 0n) throw errors.auctionHasBids();

    return withIdempotency(req, reply, req.auth!.orgId, async () => {
      const tx = await prepare({ functionName: "cancelAuction", args: [auction.onchainId ?? 0n] });
      return { status: 200, body: { ...serializeAuction(auction), transaction_request: tx } };
    });
  });

  // ---- Claim the item ---------------------------------------------------
  app.post("/v1/auctions/:id/claim", { preHandler: requireScope("auctions:write") }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const auction = await prisma.auction.findFirst({ where: { ref: id, orgId: req.auth!.orgId } });
    if (!auction) throw errors.notFound("auction", id);

    return withIdempotency(req, reply, req.auth!.orgId, async () => {
      const tx = await prepare({ functionName: "claimItem", args: [auction.onchainId ?? 0n] });
      return { status: 200, body: { object: "claim_intent", auction: auction.ref, transaction_request: tx } };
    });
  });
}
