import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./shared/logging/logger";

const app = createApp();

app.listen(env.PORT);

logger.info({ port: env.PORT }, "server_started");

async function shutdown(signal: string) {
  logger.info({ signal }, "shutdown_start");

  try {
    await app.stop();
  } catch (e) {
    logger.error({ err: e }, "shutdown_error");
  } finally {
    logger.info("shutdown_done");
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
