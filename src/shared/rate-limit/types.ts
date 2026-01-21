export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms
};

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
  prefix?: string;
  keyGenerator?: (req: Request) => string;
  store: RateLimitStore;
};
