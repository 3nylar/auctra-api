import { createPublicClient, fallback, http } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { env } from "./env.js";

const chain = env.CHAIN_ID === 1 ? mainnet : sepolia;

const transports = [http(env.RPC_URL)];
if (env.RPC_URL_FALLBACK) transports.push(http(env.RPC_URL_FALLBACK));

export const publicClient = createPublicClient({
  chain,
  transport: transports.length > 1 ? fallback(transports) : transports[0],
});

export const AUCTION_HOUSE = env.AUCTION_HOUSE_ADDRESS;
