import type Redis from 'ioredis';
import type { RateLimitResult, RateLimitStore } from './types';

const LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])

local current = redis.call("INCR", key)
if current == 1 then
  redis.call("PEXPIRE", key, windowMs)
end

local ttl = redis.call("PTTL", key)
if ttl < 0 then ttl = windowMs end

if current > limit then
  return {0, current, ttl}
else
  return {1, current, ttl}
end
`;

function isNoScript(err: unknown) {
  return err instanceof Error && err.message.includes('NOSCRIPT');
}

export class RedisRateLimitStore implements RateLimitStore {
  private sha?: string;

  constructor(private readonly redis: Redis) {}

  private async ensureSha(): Promise<string> {
    if (this.sha) return this.sha;

    const sha = (await this.redis.script('LOAD', LUA)) as string; // ✅ cast
    this.sha = sha;
    return sha;
  }

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();

    try {
      const sha = await this.ensureSha();
      const res = (await this.redis.evalsha(sha, 1, key, limit, windowMs)) as any[];

      const allowed = Number(res[0]) === 1;
      const current = Number(res[1]);
      const ttl = Number(res[2]);

      return {
        allowed,
        remaining: Math.max(limit - current, 0),
        resetAt: now + Math.max(ttl, 0),
      };
    } catch (err) {
      // Redis restart / failover => script cache hilang
      if (isNoScript(err)) {
        const sha = (await this.redis.script('LOAD', LUA)) as string; // ✅ pastikan string
        this.sha = sha;

        const res = (await this.redis.evalsha(sha, 1, key, limit, windowMs)) as any[];

        const allowed = Number(res[0]) === 1;
        const current = Number(res[1]);
        const ttl = Number(res[2]);

        return {
          allowed,
          remaining: Math.max(limit - current, 0),
          resetAt: now + Math.max(ttl, 0),
        };
      }
      throw err;
    }
  }
}
