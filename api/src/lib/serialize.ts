import type { Auction, Bid, Refund, Event } from "@prisma/client";
import { display, minimumBid } from "./money.js";

/**
 * Chain state changes underneath a cached row. `status` is therefore derived
 * at read time from the clock, not trusted from the column alone — a row that
 * says "live" but whose end_time passed two seconds ago is reported "ended".
 */
export function effectiveStatus(a: Auction, now = new Date()): string {
  if (a.status === "settled" || a.status === "cancelled" || a.status === "pending") return a.status;
  if (now >= a.endTime) return "ended";
  const secondsLeft = (a.endTime.getTime() - now.getTime()) / 1000;
  if (secondsLeft <= a.extensionWindow) return "ending";
  return "live";
}

export function serializeAuction(a: Auction) {
  const status = effectiveStatus(a);
  const min = minimumBid(BigInt(a.highestBidWei), BigInt(a.reservePriceWei), a.minIncrementBps);
  return {
    object: "auction",
    id: a.ref,
    status,
    chain_id: a.chainId,
    contract: a.contract,
    onchain_id: a.onchainId ? Number(a.onchainId) : null,
    seller: a.seller,
    item: {
      token_contract: a.tokenContract,
      token_id: a.tokenId.toString(),
    },
    reserve_price_wei: a.reservePriceWei,
    reserve_price_display: display(a.reservePriceWei),
    min_increment_bps: a.minIncrementBps,
    minimum_bid_wei: min.toString(),
    minimum_bid_display: display(min),
    highest_bid_wei: a.highestBidWei,
    highest_bid_display: display(a.highestBidWei),
    highest_bidder: a.highestBidder,
    start_time: a.startTime.toISOString(),
    end_time: a.endTime.toISOString(),
    anti_snipe: {
      extension_window_seconds: a.extensionWindow,
      extensions_used: a.extensionCount,
      max_extensions: a.maxExtensions,
    },
    transactions: {
      created: a.createTxHash,
      settled: a.settleTxHash,
    },
    metadata: a.metadata ?? {},
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}

export function serializeBid(b: Bid & { auction?: { ref: string } }) {
  return {
    object: "bid",
    id: b.ref,
    auction: b.auction?.ref,
    bidder: b.bidder,
    amount_wei: b.amountWei,
    amount_display: display(b.amountWei),
    status: b.status,
    transaction_hash: b.txHash,
    block_number: b.blockNumber ? Number(b.blockNumber) : null,
    placed_at: b.placedAt.toISOString(),
  };
}

export function serializeRefund(r: Refund) {
  return {
    object: "refund",
    id: r.ref,
    bidder: r.bidder,
    amount_wei: r.amountWei,
    amount_display: display(r.amountWei),
    withdrawn: r.withdrawn,
    withdrawal_transaction: r.withdrawTx,
    chain_id: r.chainId,
    created_at: r.createdAt.toISOString(),
  };
}

export function serializeEvent(e: Event) {
  return {
    object: "event",
    id: e.ref,
    type: e.type,
    created_at: e.createdAt.toISOString(),
    data: { object: e.payload },
  };
}
