import { drizzle } from 'drizzle-orm/bun-sql';
import { env } from '../config/env';
import * as schema from './schema';

import type { Logger as DrizzleLogger } from 'drizzle-orm/logger';
import { logger } from '../shared/logging/logger'; // pino kamu

class DrizzlePinoLogger implements DrizzleLogger {
  logQuery(query: string, params: unknown[]) {
    // biasanya cukup di level debug
    logger.debug({ query, params }, 'db_query');
  }
}

export const db = drizzle(env.DATABASE_URL, {
  schema,
  //   logger: env.NODE_ENV !== 'production', // ✅ hanya dev
  logger: env.NODE_ENV !== 'production' ? new DrizzlePinoLogger() : false,
});

export type DbClient = typeof db;
