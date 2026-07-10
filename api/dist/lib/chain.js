import { createPublicClient, createWalletClient, encodeFunctionData, fallback, http, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { auctionHouseAbi } from "../abi/auctionHouse.js";
import { env } from "./env.js";
import { errors } from "./errors.js";
const chain = env.CHAIN_ID === 1 ? mainnet : sepolia;
const transports = [http(env.RPC_URL)];
if (env.RPC_URL_FALLBACK)
    transports.push(http(env.RPC_URL_FALLBACK));
export const publicClient = createPublicClient({
    chain,
    transport: transports.length > 1 ? fallback(transports) : transports[0],
});
export const AUCTION_HOUSE = env.AUCTION_HOUSE_ADDRESS;
export async function prepare(opts) {
    const data = encodeFunctionData({
        abi: auctionHouseAbi,
        functionName: opts.functionName,
        args: opts.args,
    });
    let gasLimit = null;
    let nonce = null;
    let fees = {};
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
    }
    catch (err) {
        const reason = extractRevertReason(err);
        if (reason)
            throw errors.chainReverted(reason);
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
export async function relay(signed) {
    try {
        return await publicClient.sendRawTransaction({ serializedTransaction: signed });
    }
    catch (err) {
        const reason = extractRevertReason(err);
        if (reason)
            throw errors.chainReverted(reason);
        throw errors.rpcUnavailable();
    }
}
const managedAccount = env.MANAGED_SIGNER_PRIVATE_KEY
    ? privateKeyToAccount(env.MANAGED_SIGNER_PRIVATE_KEY)
    : null;
export const managedSignerEnabled = Boolean(managedAccount);
export const managedSignerAddress = managedAccount?.address ?? null;
export async function sendManaged(tx) {
    if (!managedAccount)
        throw errors.managedSignerDisabled();
    const wallet = createWalletClient({
        account: managedAccount,
        chain,
        transport: transports[0],
    });
    try {
        return await wallet.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
        });
    }
    catch (err) {
        const reason = extractRevertReason(err);
        if (reason)
            throw errors.chainReverted(reason);
        throw errors.rpcUnavailable();
    }
}
export async function pendingReturns(bidder) {
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
function extractRevertReason(err) {
    if (typeof err !== "object" || err === null)
        return null;
    const e = err;
    const name = e.cause?.data?.errorName;
    if (name)
        return name;
    if (e.shortMessage?.includes("reverted"))
        return e.shortMessage;
    return null;
}
