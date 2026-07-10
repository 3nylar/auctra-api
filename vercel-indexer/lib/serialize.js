import { display, minimumBid } from "./money.js";

export function effectiveStatus(a, now = new Date()) {
  if (a.status === "settled" || a.status === "cancelled" || a.status === "pending") return a.status;
  if (now >= a.endTime) return "ended";
  const secondsLeft = (a.endTime.getTime() - now.getTime()) / 1000;
  if (secondsLeft <= a.extensionWindow) return "ending";
  return "live";
}

export function serializeAuction(a) {
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
    item: { token_contract: a.tokenContract, token_id: a.tokenId.toString() },
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
    transactions: { created: a.createTxHash, settled: a.settleTxHash },
    metadata: a.metadata ?? {},
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}
