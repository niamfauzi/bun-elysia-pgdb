import type { RateLimitResult, RateLimitStore } from './types';

type Entry = { count: number; resetAt: number };

export class MemoryRateLimitStore implements RateLimitStore {
  private map = new Map<string, Entry>();
  private lastCleanup = 0;

  constructor(private cleanupIntervalMs = 60_000) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    this.cleanup(now);

    const e = this.map.get(key);
    if (!e || now >= e.resetAt) {
      const resetAt = now + windowMs;
      this.map.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: Math.max(limit - 1, 0), resetAt };
    }

    e.count += 1;
    const allowed = e.count <= limit;
    return { allowed, remaining: Math.max(limit - e.count, 0), resetAt: e.resetAt };
  }

  private cleanup(now: number) {
    if (now - this.lastCleanup < this.cleanupIntervalMs) return;
    this.lastCleanup = now;

    for (const [k, v] of this.map) {
      if (now >= v.resetAt) this.map.delete(k);
    }
  }
}
