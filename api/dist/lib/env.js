import { z } from "zod";
const schema = z.object({
    PORT: z.coerce.number().default(8080),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    AUCTRA_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    API_PUBLIC_URL: z.string().url().default("http://localhost:8080"),
    DATABASE_URL: z.string().startsWith("postgresql://", {
        message: "Auctra requires Postgres. See docs: /guides/self-hosting",
    }),
    CHAIN_ID: z.coerce.number(),
    RPC_URL: z.string().url(),
    RPC_URL_FALLBACK: z.string().url().optional().or(z.literal("")),
    AUCTION_HOUSE_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    COLLECTIBLE_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    INDEXER_START_BLOCK: z.coerce.bigint().default(0n),
    INDEXER_POLL_INTERVAL_MS: z.coerce.number().default(4000),
    INDEXER_CONFIRMATIONS: z.coerce.number().default(2),
    API_KEY_PEPPER: z.string().min(32),
    WEBHOOK_SIGNING_SECRET: z.string().min(8),
    MANAGED_SIGNER_PRIVATE_KEY: z.string().optional().or(z.literal("")),
    // Dashboard login. SESSION_SECRET signs the login cookie — changing it logs
    // every signed-in user out at once, the same way API_KEY_PEPPER does for keys.
    SESSION_SECRET: z.string().min(32),
    // The exact origin (scheme + host, no path) the dashboard is served from,
    // e.g. "https://auctra-api.vercel.app". The login cookie is only ever sent
    // to this one origin — see server.ts for why that has to be exact, not a
    // wildcard, given the dashboard and API live on different domains.
    DASHBOARD_ORIGIN: z.string().url(),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    const detail = parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
    throw new Error(`Invalid environment.\n${detail}`);
}
export const env = parsed.data;
/** The key prefix this process will accept. A sandbox process rejects live keys. */
export const KEY_PREFIX = env.AUCTRA_ENV === "production" ? "sk_live_" : "sk_test_";
