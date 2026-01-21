import { Elysia } from 'elysia';
import { tooManyRequests } from '../http/errors';
import type { RateLimitOptions } from './types';

const RL_DEBUG = 1; //process.env.RL_DEBUG === '1';
const rlLog = (...args: any[]) => {
  if (RL_DEBUG) console.log(...args);
};

function getClientIp(req: Request) {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function rateLimit(opts: RateLimitOptions) {
  const prefix = opts.prefix ?? 'rl';
  const keyGen = opts.keyGenerator ?? ((req) => `ip:${getClientIp(req)}`);

  // ✅ biar tidak ketiban dedupe kalau ada rateLimit lain (mis. limit 10 di global)
  const pluginName = `rate-limit:${prefix}:${opts.limit}:${opts.windowMs}`;

  // 🔎 LOG: plugin dibuat (startup)
  rlLog('[RL:init]', {
    pluginName,
    prefix,
    limit: opts.limit,
    windowMs: opts.windowMs,
  });

  return new Elysia({ name: pluginName }).onBeforeHandle(
    // ✅ lebih aman untuk dipakai membungkus group routes
    { as: 'scoped' },
    async ({ request, set }) => {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // 🔎 LOG: request masuk + header proxy penting
      const xff = request.headers.get('x-forwarded-for');
      const xreal = request.headers.get('x-real-ip');
      const ip = getClientIp(request);

      const key = `${prefix}:${keyGen(request)}`;

      rlLog('[RL:req]', {
        method,
        path,
        ip,
        xff,
        xreal,
        key,
      });

      let r;
      try {
        r = await opts.store.consume(key, opts.limit, opts.windowMs);
      } catch (err) {
        rlLog('[RL:error] consume failed', { method, path, key, err });
        throw err;
      }

      // 🔎 LOG: hasil consume
      rlLog('[RL:res]', {
        method,
        path,
        key,
        allowed: r.allowed,
        remaining: r.remaining,
        resetAt: r.resetAt,
        resetInMs: r.resetAt - Date.now(),
      });

      set.headers['x-ratelimit-limit'] = String(opts.limit);
      set.headers['x-ratelimit-remaining'] = String(r.remaining);
      set.headers['x-ratelimit-reset'] = String(Math.floor(r.resetAt / 1000));

      if (!r.allowed) {
        const retryAfterSec = Math.max(Math.ceil((r.resetAt - Date.now()) / 1000), 1);
        set.headers['retry-after'] = String(retryAfterSec);

        // 🔎 LOG: diblok
        rlLog('[RL:block]', {
          method,
          path,
          key,
          retryAfterSec,
          limit: opts.limit,
          windowMs: opts.windowMs,
        });

        throw tooManyRequests('Rate limit exceeded', {
          limit: opts.limit,
          windowMs: opts.windowMs,
          retryAfterSec,
        });
      }
    },
  );
}
