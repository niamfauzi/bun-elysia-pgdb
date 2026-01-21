import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../shared/logging/logger';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (redis) return redis;

  redis = new Redis(env.REDIS_URL, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

  redis.on('connect', () => logger.info('redis_connect'));
  redis.on('error', (err) => logger.error({ err }, 'redis_error'));

  return redis;
}

export async function closeRedis() {
  if (!redis) return;
  const r = redis;
  redis = null;

  try {
    await r.quit();
  } catch {
    r.disconnect();
  }
}
