import { buildServer } from "./server.js";
import { env } from "./lib/env.js";
const app = await buildServer();
try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info({ env: env.AUCTRA_ENV, chain: env.CHAIN_ID }, `Auctra API listening on :${env.PORT}`);
}
catch (err) {
    app.log.error(err);
    process.exit(1);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
        app.log.info(`${signal} received, draining`);
        await app.close();
        process.exit(0);
    });
}
