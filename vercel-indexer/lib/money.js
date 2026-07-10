import { formatEther } from "viem";
export function display(wei) {
  return formatEther(BigInt(wei));
}
export function minimumBid(highestBidWei, reserveWei, incrementBps) {
  if (highestBidWei === 0n) return reserveWei;
  return highestBidWei + (highestBidWei * BigInt(incrementBps)) / 10000n;
}
