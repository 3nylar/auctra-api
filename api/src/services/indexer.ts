/**
 * The indexer is what turns a blockchain into an API.
 *
 * Nothing in the HTTP layer writes authoritative auction state. It writes
 * *intents*. This process reads confirmed logs from the AuctionHouse contract
 * and reconciles them into the database, then emits the webhook events that
 * integrators actually build on.
 *
 * Three properties it has to hold:
 *
 *  1. Confirmations, not head. We index `head - CONFIRMATIONS`. A reorg that
 *     un-mines a bid after we've already told a customer they won is a far
 *     worse bug than four seconds of latency.
 *
 *  2. Idempotent writes. Every row is keyed on (txHash, logIndex). Replaying
 *     the same block range twice is a no-op, so a crash mid-batch is safe and
 *     the cursor only advances after the batch commits.
 *
 *  3. The clock is the chain's. `block.timestamp` decides whether an auction
 *     ended, not the server's wall clock. They disagree by seconds, and the
 *     seconds that matter are the last five of an auction.
 */
import { decodeEventLog, type Log } from "viem";
import { auctionHouseAbi } from "../abi/auctionHouse.js";
import { AUCTION_HOUSE, publicClient } from "../lib/chain.js";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { newBidRef, newRefundRef } from "../lib/ids.js";
import { serializeAuction } from "../lib/serialize.js";
import { drainDeliveryQueue, emitEvent } from "./webhooks.js";

const BATCH_SIZE = 2_000n;

async function loadCursor(): Promise<bigint> {
  const row = await prisma.indexerCursor.findUnique({
    where: { chainId_contract: { chainId: env.CHAIN_ID, contract: AUCTION_HOUSE.toLowerCase() } },
  });
  return row?.lastBlock ?? env.INDEXER_START_BLOCK;
}

async function saveCursor(block: bigint) {
  await prisma.indexerCursor.upsert({
    where: { chainId_contract: { chainId: env.CHAIN_ID, contract: AUCTION_HOUSE.toLowerCase() } },
    create: { chainId: env.CHAIN_ID, contract: AUCTION_HOUSE.toLowerCase(), lastBlock: block },
    update: { lastBlock: block },
  });
}

async function handleLog(log: Log) {
  const decoded = decodeEventLog({ abi: auctionHouseAbi, data: log.data, topics: log.topics });
  const onchainId = "auctionId" in decoded.args ? (decoded.args.auctionId as bigint) : null;

  const auction = onchainId
    ? await prisma.auction.findFirst({
        where: { chainId: env.CHAIN_ID, contract: AUCTION_HOUSE.toLowerCase(), onchainId },
      })
    : null;

  switch (decoded.eventName) {
    case "AuctionCreated": {
      const a = decoded.args;
      // The auction row already exists (created by POST /v1/auctions) but has
      // no onchain_id until now — we match it by the creating transaction.
      const pending = await prisma.auction.findFirst({
        where: { createTxHash: log.transactionHash, onchainId: null },
      });
      const updated = pending
        ? await prisma.auction.update({
            where: { id: pending.id },
            data: {
              onchainId: a.auctionId,
              status: "live",
              endTime: new Date(Number(a.endTime) * 1000),
            },
          })
        : null;
      if (updated) {
        await emitEvent({
          orgId: updated.orgId,
          type: "auction.created",
          objectRef: updated.ref,
          payload: serializeAuction(updated),
          chainBlock: log.blockNumber ?? undefined,
        });
      }
      break;
    }

    case "BidPlaced": {
      if (!auction) break;
      const a = decoded.args;
      const previousBidder = auction.highestBidder;
      const previousBid = BigInt(auction.highestBidWei);

      await prisma.bid.upsert({
        where: { txHash_logIndex: { txHash: log.transactionHash!, logIndex: log.logIndex! } },
        create: {
          ref: newBidRef(),
          auctionId: auction.id,
          bidder: (a.bidder as string).toLowerCase(),
          amountWei: (a.amount as bigint).toString(),
          status: "winning",
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
        },
        update: {},
      });

      // The previous leader is now outbid, and their ETH is credited, not sent.
      if (previousBidder && previousBid > 0n) {
        await prisma.bid.updateMany({
          where: { auctionId: auction.id, bidder: previousBidder, status: "winning" },
          data: { status: "outbid" },
        });
        await prisma.refund.create({
          data: {
            ref: newRefundRef(),
            auctionId: auction.id,
            chainId: env.CHAIN_ID,
            contract: AUCTION_HOUSE.toLowerCase(),
            bidder: previousBidder,
            amountWei: previousBid.toString(),
          },
        });
        await emitEvent({
          orgId: auction.orgId,
          type: "auction.outbid",
          objectRef: auction.ref,
          payload: {
            auction: auction.ref,
            outbid_bidder: previousBidder,
            refund_wei: previousBid.toString(),
            new_highest_bid_wei: (a.amount as bigint).toString(),
          },
        });
      }

      const updated = await prisma.auction.update({
        where: { id: auction.id },
        data: {
          highestBidWei: (a.amount as bigint).toString(),
          highestBidder: (a.bidder as string).toLowerCase(),
        },
      });

      await emitEvent({
        orgId: auction.orgId,
        type: "auction.bid_placed",
        objectRef: auction.ref,
        payload: serializeAuction(updated),
        chainBlock: log.blockNumber ?? undefined,
      });
      break;
    }

    case "AuctionExtended": {
      if (!auction) break;
      const updated = await prisma.auction.update({
        where: { id: auction.id },
        data: {
          endTime: new Date(Number(decoded.args.newEndTime) * 1000),
          extensionCount: { increment: 1 },
        },
      });
      await emitEvent({
        orgId: auction.orgId,
        type: "auction.extended",
        objectRef: auction.ref,
        payload: serializeAuction(updated),
      });
      break;
    }

    case "AuctionEnded": {
      if (!auction) break;
      const updated = await prisma.auction.update({
        where: { id: auction.id },
        data: { status: "settled", settleTxHash: log.transactionHash },
      });
      await prisma.bid.updateMany({
        where: { auctionId: auction.id, status: "winning" },
        data: { status: "won" },
      });
      await emitEvent({
        orgId: auction.orgId,
        type: "auction.settled",
        objectRef: auction.ref,
        payload: {
          ...serializeAuction(updated),
          winner: (decoded.args.winner as string).toLowerCase(),
          winning_bid_wei: (decoded.args.amount as bigint).toString(),
        },
      });
      break;
    }

    case "AuctionCancelled": {
      if (!auction) break;
      const updated = await prisma.auction.update({
        where: { id: auction.id },
        data: { status: "cancelled" },
      });
      await emitEvent({
        orgId: auction.orgId,
        type: "auction.cancelled",
        objectRef: auction.ref,
        payload: serializeAuction(updated),
      });
      break;
    }

    case "RefundWithdrawn": {
      const bidder = (decoded.args.bidder as string).toLowerCase();
      await prisma.refund.updateMany({
        where: { bidder, withdrawn: false },
        data: { withdrawn: true, withdrawTx: log.transactionHash },
      });
      break;
    }
  }
}

async function tick() {
  const head = await publicClient.getBlockNumber();
  const safeHead = head - BigInt(env.INDEXER_CONFIRMATIONS);
  let cursor = await loadCursor();
  if (cursor >= safeHead) return;

  while (cursor < safeHead) {
    const toBlock = cursor + BATCH_SIZE > safeHead ? safeHead : cursor + BATCH_SIZE;

    const logs = await publicClient.getLogs({
      address: AUCTION_HOUSE,
      fromBlock: cursor + 1n,
      toBlock,
    });

    // Ordering matters: a BidPlaced and the AuctionExtended it triggered can
    // land in the same block, and applying them out of order loses the new
    // end time.
    logs.sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? Number(a.logIndex! - b.logIndex!)
        : Number(a.blockNumber! - b.blockNumber!),
    );

    for (const log of logs) {
      try {
        await handleLog(log);
      } catch (err) {
        console.error({ err, tx: log.transactionHash }, "failed to index log");
      }
    }

    await saveCursor(toBlock);
    cursor = toBlock;
  }
}

/** Auctions closing soon are a scheduled fact, not an on-chain event. */
async function emitEndingSoon() {
  const window = 300;
  const soon = new Date(Date.now() + window * 1000);
  const auctions = await prisma.auction.findMany({
    where: { status: "live", endTime: { lte: soon, gt: new Date() } },
  });
  for (const a of auctions) {
    await prisma.auction.update({ where: { id: a.id }, data: { status: "ending" } });
    await emitEvent({
      orgId: a.orgId,
      type: "auction.ending_soon",
      objectRef: a.ref,
      payload: serializeAuction(a),
    });
  }
}

async function main() {
  console.log(`indexer: watching ${AUCTION_HOUSE} on chain ${env.CHAIN_ID}`);
  for (;;) {
    try {
      await tick();
      await emitEndingSoon();
      await drainDeliveryQueue();
    } catch (err) {
      console.error({ err }, "indexer tick failed; retrying");
    }
    await new Promise((r) => setTimeout(r, env.INDEXER_POLL_INTERVAL_MS));
  }
}

void main();
