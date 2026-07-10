import { decodeEventLog } from "viem";
import { auctionHouseAbi } from "../abi/auctionHouse.js";
import { AUCTION_HOUSE, publicClient } from "./chain.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { newBidRef, newRefundRef } from "./ids.js";
import { serializeAuction } from "./serialize.js";
import { drainDeliveryQueue, emitEvent } from "./webhooks.js";

const BATCH_SIZE = 2000n;

async function loadCursor() {
  const row = await prisma.indexerCursor.findUnique({
    where: { chainId_contract: { chainId: env.CHAIN_ID, contract: AUCTION_HOUSE.toLowerCase() } },
  });
  return row?.lastBlock ?? env.INDEXER_START_BLOCK;
}

async function saveCursor(block) {
  await prisma.indexerCursor.upsert({
    where: { chainId_contract: { chainId: env.CHAIN_ID, contract: AUCTION_HOUSE.toLowerCase() } },
    create: { chainId: env.CHAIN_ID, contract: AUCTION_HOUSE.toLowerCase(), lastBlock: block },
    update: { lastBlock: block },
  });
}

async function handleLog(log) {
  const decoded = decodeEventLog({ abi: auctionHouseAbi, data: log.data, topics: log.topics });
  const onchainId = "auctionId" in decoded.args ? decoded.args.auctionId : null;

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
            data: { onchainId: a.auctionId, status: "live", endTime: new Date(Number(a.endTime) * 1000) },
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
        where: { txHash_logIndex: { txHash: log.transactionHash, logIndex: log.logIndex } },
        create: {
          ref: newBidRef(),
          auctionId: auction.id,
          bidder: a.bidder.toLowerCase(),
          amountWei: a.amount.toString(),
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
            new_highest_bid_wei: a.amount.toString(),
          },
        });
      }

      const updated = await prisma.auction.update({
        where: { id: auction.id },
        data: { highestBidWei: a.amount.toString(), highestBidder: a.bidder.toLowerCase() },
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
        data: { endTime: new Date(Number(decoded.args.newEndTime) * 1000), extensionCount: { increment: 1 } },
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
          winner: decoded.args.winner.toLowerCase(),
          winning_bid_wei: decoded.args.amount.toString(),
        },
      });
      break;
    }

    case "AuctionCancelled": {
      if (!auction) break;
      const updated = await prisma.auction.update({ where: { id: auction.id }, data: { status: "cancelled" } });
      await emitEvent({
        orgId: auction.orgId,
        type: "auction.cancelled",
        objectRef: auction.ref,
        payload: serializeAuction(updated),
      });
      break;
    }

    case "RefundWithdrawn": {
      const bidder = decoded.args.bidder.toLowerCase();
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

  if (cursor >= safeHead) return { processedThrough: cursor.toString(), blocksBehind: "0" };

  while (cursor < safeHead) {
    const toBlock = cursor + BATCH_SIZE > safeHead ? safeHead : cursor + BATCH_SIZE;
    const logs = await publicClient.getLogs({ address: AUCTION_HOUSE, fromBlock: cursor + 1n, toBlock });

    logs.sort((a, b) =>
      a.blockNumber === b.blockNumber ? Number(a.logIndex - b.logIndex) : Number(a.blockNumber - b.blockNumber),
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
    await emitEvent({ orgId: a.orgId, type: "auction.ending_soon", objectRef: a.ref, payload: serializeAuction(a) });
  }
}

export async function runIndexerOnce() {
  const result = await tick();
  await emitEndingSoon();
  await drainDeliveryQueue();
  return result;
}
