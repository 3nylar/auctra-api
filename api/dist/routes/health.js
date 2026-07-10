import { publicClient, managedSignerEnabled } from "../lib/chain.js";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
export async function healthRoutes(app) {
    /** Unauthenticated. Reports the two dependencies that can take the API down. */
    app.get("/v1/health", async () => {
        const [db, block] = await Promise.allSettled([
            prisma.$queryRaw `SELECT 1`,
            publicClient.getBlockNumber(),
        ]);
        const healthy = db.status === "fulfilled" && block.status === "fulfilled";
        return {
            object: "health",
            status: healthy ? "ok" : "degraded",
            environment: env.AUCTRA_ENV,
            chain_id: env.CHAIN_ID,
            head_block: block.status === "fulfilled" ? Number(block.value) : null,
            database: db.status === "fulfilled" ? "ok" : "unreachable",
            rpc: block.status === "fulfilled" ? "ok" : "unreachable",
            managed_signer: managedSignerEnabled ? "enabled" : "disabled",
        };
    });
}
