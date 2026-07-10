import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  fallback,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { auctionHouseAbi } from "../abi/auctionHouse.js";
import { env } from "./env.js";
import { errors } from "./errors.js";

const chain = env.CHAIN_ID === 1 ? mainnet : sepolia;

const transports = [http(env.RPC_URL)];
if (env.RPC_URL_FALLBACK) transports.push(http(env.RPC_URL_FALLBACK));

export const publicClient = createPublicClient({
  chain,
  transport: transports.length > 1 ? fallback(transports) : transports[0]!,
});

export const AUCTION_HOUSE = env.AUCTION_HOUSE_ADDRESS as Address;

/**
 * The whole design in one comment.
 *
 * Auctra is an auction house whose settlement layer is a public blockchain.
 * That imposes a rule no amount of API design can wish away: a bid is a
 * *transfer of the bidder's own funds*, and only the bidder's private key can
 * authorise it. An API that accepted `POST /bids` and moved someone's ETH
 * would have to hold their key, which turns a trust-minimised auction house
 * into a custodian — the exact thing the contract was written to avoid.
 *
 * So Auctra's write endpoints have two modes:
 *
 *   prepared  (default)  We return an unsigned transaction: to, data, value,
 *                        chain_id, gas estimate. Your client signs it with the
 *                        user's wallet and either broadcasts it directly or
 *                        hands the signed blob back to POST /v1/transactions.
 *                        Auctra never sees a private key.
 *
 *   managed              For operations on a wallet the *organisation itself*
 *                        owns — listing your own inventory, settling your own
 *                        auctions — you may configure a signer and let the API
 *                        broadcast. Never available for `bid`: there is no
 *                        legitimate case where Auctra should be able to spend
 *                        a bidder's balance.
 *
 * Both modes end at the same place: a transaction hash, a confirmation, an
 * indexed row, a webhook. `prepared` just puts the key where it belongs.
 */
export type PreparedTransaction = {
  object: "transaction_request";
  chain_id: number;
  to: Address;
  data: Hex;
  value: string;
  gas_limit: string | null;
  max_fee_per_gas: string | null;
  max_priority_fee_per_gas: string | null;
  nonce_hint: number | null;
};

export async function prepare(opts: {
  functionName: "createAuction" | "bid" | "withdraw" | "endAuction" | "claimItem" | "cancelAuction";
  args: readonly unknown[];
  value?: bigint;
  from?: Address;
}): Promise<PreparedTransaction> {
  const data = encodeFunctionData({
    abi: auctionHouseAbi,
    functionName: opts.functionName,
    args: opts.args as never,
  });

  let gasLimit: bigint | null = null;
  let nonce: number | null = null;
  let fees: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {};

  try {
    fees = await publicClient.estimateFeesPerGas();
    if (opts.from) {
      // Simulate against the caller's address so a doomed bid fails here, with
      // a readable reason, rather than on-chain after they've paid gas.
      gasLimit = await publicClient.estimateGas({
        account: opts.from,
        to: AUCTION_HOUSE,
        data,
        value: opts.value ?? 0n,
      });
      nonce = await publicClient.getTransactionCount({ address: opts.from });
    }
  } catch (err) {
    const reason = extractRevertReason(err);
    if (reason) throw errors.chainReverted(reason);
    // Fee/nonce lookups are best-effort; a caller can fill them in themselves.
  }

  return {
    object: "transaction_request",
    chain_id: env.CHAIN_ID,
    to: AUCTION_HOUSE,
    data,
    value: (opts.value ?? 0n).toString(),
    gas_limit: gasLimit ? ((gasLimit * 120n) / 100n).toString() : null, // +20% headroom
    max_fee_per_gas: fees.maxFeePerGas?.toString() ?? null,
    max_priority_fee_per_gas: fees.maxPriorityFeePerGas?.toString() ?? null,
    nonce_hint: nonce,
  };
}

/** Broadcast an already-signed transaction. Auctra is a relay here, nothing more. */
export async function relay(signed: Hex): Promise<Hex> {
  try {
    return await publicClient.sendRawTransaction({ serializedTransaction: signed });
  } catch (err) {
    const reason = extractRevertReason(err);
    if (reason) throw errors.chainReverted(reason);
    throw errors.rpcUnavailable();
  }
}

const managedAccount = env.MANAGED_SIGNER_PRIVATE_KEY
  ? privateKeyToAccount(env.MANAGED_SIGNER_PRIVATE_KEY as Hex)
  : null;

export const managedSignerEnabled = Boolean(managedAccount);
export const managedSignerAddress = managedAccount?.address ?? null;

export async function sendManaged(tx: PreparedTransaction): Promise<Hex> {
  if (!managedAccount) throw errors.managedSignerDisabled();
  const wallet = createWalletClient({
    account: managedAccount,
    chain,
    transport: transports[0]!,
  });
  try {
    return await wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
    });
  } catch (err) {
    const reason = extractRevertReason(err);
    if (reason) throw errors.chainReverted(reason);
    throw errors.rpcUnavailable();
  }
}

export async function pendingReturns(bidder: Address): Promise<bigint> {
  return publicClient.readContract({
    address: AUCTION_HOUSE,
    abi: auctionHouseAbi,
    functionName: "pendingReturns",
    args: [bidder],
  });
}

/**
 * AuctionHouse.sol uses custom errors (`error BidTooLow(uint256 minimum);`),
 * which arrive as a 4-byte selector, not a string. viem decodes them when it
 * has the ABI; we surface the decoded name so `transaction_reverted` carries
 * something a human can act on instead of "execution reverted".
 */
function extractRevertReason(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { shortMessage?: string; cause?: { data?: { errorName?: string } } };
  const name = e.cause?.data?.errorName;
  if (name) return name;
  if (e.shortMessage?.includes("reverted")) return e.shortMessage;
  return null;
}
