/** `npm run seed:key -- "Acme Marketplace"` — prints the key once, then never again. */
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/db.js";
import { env, KEY_PREFIX } from "../lib/env.js";
import { hashKey } from "../middleware/auth.js";
const name = process.argv[2] ?? "Default organisation";
const org = await prisma.organization.create({
    data: { name, env: env.AUCTRA_ENV },
});
const raw = `${KEY_PREFIX}${randomBytes(24).toString("hex")}`;
await prisma.apiKey.create({
    data: {
        orgId: org.id,
        hash: hashKey(raw),
        prefix: raw.slice(0, 12),
        label: "Primary key",
        scopes: ["auctions:read", "auctions:write", "webhooks:read", "webhooks:write"],
    },
});
console.log(`\norganisation: ${org.id}  (${org.name})`);
console.log(`api key:      ${raw}`);
console.log(`\nStore it now. Only the hash is persisted.\n`);
await prisma.$disconnect();
