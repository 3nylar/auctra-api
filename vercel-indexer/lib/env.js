// Reads and validates process.env. Plain JS, no zod — this folder has zero
// TypeScript dependencies by design, so validation is done by hand instead.
function require_(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Invalid environment.\n  ${name}: Required`);
  return v;
}

export const env = {
  DATABASE_URL: require_("DATABASE_URL"),
  CHAIN_ID: Number(require_("CHAIN_ID")),
  RPC_URL: require_("RPC_URL"),
  RPC_URL_FALLBACK: process.env.RPC_URL_FALLBACK || "",
  AUCTION_HOUSE_ADDRESS: require_("AUCTION_HOUSE_ADDRESS"),
  COLLECTIBLE_ADDRESS: process.env.COLLECTIBLE_ADDRESS || "",
  INDEXER_START_BLOCK: BigInt(process.env.INDEXER_START_BLOCK || "0"),
  INDEXER_CONFIRMATIONS: Number(process.env.INDEXER_CONFIRMATIONS || "2"),
  API_KEY_PEPPER: process.env.API_KEY_PEPPER || "",
  WEBHOOK_SIGNING_SECRET: process.env.WEBHOOK_SIGNING_SECRET || "",
};
