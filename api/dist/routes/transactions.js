import { z } from "zod";
import { publicClient, relay } from "../lib/chain.js";
import { requireScope } from "../middleware/auth.js";
import { withIdempotency } from "../lib/idempotency.js";
export async function transactionRoutes(app) {
    /**
     * Broadcast a transaction you signed yourself. Optional — you can send it
     * to any node. It exists so an integration needs exactly one network
     * dependency (us) instead of two (us and an RPC provider).
     */
    app.post("/v1/transactions", { preHandler: requireScope("auctions:write") }, async (req, reply) => {
        const { signed_transaction } = z
            .object({ signed_transaction: z.string().regex(/^0x[a-fA-F0-9]+$/) })
            .parse(req.body);
        return withIdempotency(req, reply, req.auth.orgId, async () => {
            const hash = await relay(signed_transaction);
            return {
                status: 202, // accepted, not confirmed — the chain decides that
                body: {
                    object: "transaction",
                    hash,
                    status: "pending",
                    confirmations: 0,
                    poll: `/v1/transactions/${hash}`,
                },
            };
        });
    });
    app.get("/v1/transactions/:hash", { preHandler: requireScope("auctions:read") }, async (req) => {
        const { hash } = z.object({ hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) }).parse(req.params);
        let receipt;
        try {
            receipt = await publicClient.getTransactionReceipt({ hash: hash });
        }
        catch {
            return { object: "transaction", hash, status: "pending", confirmations: 0 };
        }
        const head = await publicClient.getBlockNumber();
        return {
            object: "transaction",
            hash,
            status: receipt.status === "success" ? "confirmed" : "reverted",
            block_number: Number(receipt.blockNumber),
            confirmations: Number(head - receipt.blockNumber) + 1,
            gas_used: receipt.gasUsed.toString(),
            effective_gas_price: receipt.effectiveGasPrice.toString(),
        };
    });
}
