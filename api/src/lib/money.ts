import { formatEther, parseEther } from "viem";
import { errors } from "./errors.js";

/**
 * Amounts cross the wire as decimal *strings* of wei. Never as JSON numbers:
 * 1 ETH is 1e18 wei and IEEE-754 doubles lose integer precision above 2^53,
 * so `"1000000000000000001"` silently becomes 1000000000000000000 the moment
 * it touches JSON.parse in a naive client. Every response also carries a
 * lossy `*_display` field in ETH for humans; never do arithmetic on it.
 */
export function assertWei(value: unknown, param: string): bigint {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw errors.validation(
      "Expected a decimal string of wei, e.g. \"1050000000000000000\".",
      param,
    );
  }
  return BigInt(value);
}

export function display(wei: bigint | string): string {
  return formatEther(BigInt(wei));
}

export function ethToWei(eth: string): bigint {
  return parseEther(eth);
}

/** The smallest bid the contract will accept right now. */
export function minimumBid(highestBidWei: bigint, reserveWei: bigint, incrementBps: number): bigint {
  if (highestBidWei === 0n) return reserveWei;
  return highestBidWei + (highestBidWei * BigInt(incrementBps)) / 10_000n;
}
