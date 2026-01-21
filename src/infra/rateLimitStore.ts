import { getRedis } from './redis';
import { MemoryRateLimitStore } from '../shared/rate-limit/memory-store';
import { RedisRateLimitStore } from '../shared/rate-limit/redis-store';

let store: MemoryRateLimitStore | RedisRateLimitStore | null = null;

export function getRateLimitStore() {
  if (store) return store;

  const redis = getRedis();
  store = redis ? new RedisRateLimitStore(redis) : new MemoryRateLimitStore();

  return store;
}
