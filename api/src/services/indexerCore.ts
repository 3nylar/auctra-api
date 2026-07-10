/**
 * The indexer's actual work, as a single pass rather than a forever-loop.
 *
 * This split exists because there are now two different places this code
 * runs: a long-lived container (Docker, Railway) that can loop forever, and
 * a serverless function (Vercel) that runs once and exits. Both want the
 * same logic — read new blocks, update the database, send webhooks — they
 * just want it packaged differently. This file is the shared middle: it
 * does one pass and returns. `indexer.ts` wraps it in a loop for the
 * long-lived case; `api/tick.ts` calls it once per HTTP request for the
 * serverless case.
 */
import { decodeEventLog, type Log } from "viem";
import { auctionHouseAbi } from "../abi/auctionHouse.js";
import { AUCTION_HOUSE, publicClient } from "../lib/chain.js";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { newBidRef, newRefundRef } from "../lib/ids.js";
import { serializeAuction } from "../lib/serialize.js";
import { drainDeliveryQueue, emitEvent } from "./webhooks.js";

const BATCH_SIZE = 2000n;

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

async function tick(): Promise<{ processedThrough: string; blocksBehind: string }> {
  const head = await publicClient.getBlockNumber();
  const safeHead = head - BigInt(env.INDEXER_CONFIRMATIONS);
  let cursor = await loadCursor();

  if (cursor >= safeHead) {
    return { processedThrough: cursor.toString(), blocksBehind: "0" };
  }

  while (cursor < safeHead) {
    const toBlock = cursor + BATCH_SIZE > safeHead ? safeHead : cursor + BATCH_SIZE;

    const logs = await publicClient.getLogs({
      address: AUCTION_HOUSE,
      fromBlock: cursor + 1n,
      toBlock,
    });

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

  return { processedThrough: cursor.toString(), blocksBehind: (head - cursor).toString() };
}

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

/** One full pass: catch up on-chain, flag auctions closing soon, flush pending webhooks. */
export async function runIndexerOnce() {
  const result = await tick();
  await emitEndingSoon();
  await drainDeliveryQueue();
  return result;
}
