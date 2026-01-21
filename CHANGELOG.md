## Studi kasus

Kamu punya API (Bun + Elysia) dengan modul **Orders**. Endpoint `POST` di Orders rawan “spam” (mis.
create order berulang, cancel/pay berulang) sehingga perlu **rate limit**:

- **Aturan:** 3 request / 10 detik **per client** (berdasarkan IP)
- **Wajib konsisten lintas instance** (multi process / multi server) → harus pakai **Redis**, bukan
  memory
- Saat limit terlewati, API mengembalikan **429 Too Many Requests** + header:
  - `x-ratelimit-limit`
  - `x-ratelimit-remaining`
  - `x-ratelimit-reset`
  - `retry-after`

Di Elysia, implementasinya idealnya sebagai **plugin** (hook `onBeforeHandle`) yang ditempel ke
**group routes** untuk semua `POST /orders*`. Perlu perhatian khusus:

- **Scope lifecycle hook** (`local / scoped / global`) agar plugin benar-benar “membungkus” route
  yang kamu maksud. ([elysiajs.com][1])
- **Deduplication plugin**: Elysia bisa “menganggap plugin sama” berdasarkan `name` (+ `seed`),
  sehingga konfigurasi berbeda bisa ketiban bila `name` tidak unik. ([elysiajs.com][2])

---

# CHANGELOG — v1.8.0

Mengikuti format _Keep a Changelog_.

## [1.8.0] — 2026-01-21

### Added

- Rate limiting berbasis Redis untuk semua endpoint `POST` pada modul Orders (`/orders`,
  `/orders/:id/cancel`, `/orders/:id/pay`).
- Response header rate limit:
  - `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `retry-after`

- Konfigurasi env untuk Redis (`REDIS_URL`) dan toggle debug (`RL_DEBUG`).

### Changed

- Struktur routing Orders: pemisahan group `ordersPostRoutes` agar middleware rate limit hanya
  menempel ke endpoint `POST` Orders.
- Plugin rate limit menggunakan scope `scoped` untuk membungkus parent + descendant tanpa “bleed” ke
  modul lain. ([elysiajs.com][1])

### Fixed

- Deduplication plugin rate limit: `name` plugin dibuat unik per konfigurasi
  (`prefix/limit/windowMs`) atau menggunakan `seed` agar konfigurasi tidak saling ketiban (contoh:
  limit global 10 vs limit orders 3). ([elysiajs.com][2])

### Security

- Mitigasi abuse/spam request pada endpoint sensitif (create/cancel/pay) dengan throttling per IP
  berbasis Redis (shared store).

---

# Step-by-step implementasi

## 0) Prasyarat

1. Redis tersedia (local via docker-compose atau managed Redis).
2. App bisa membaca env (`REDIS_URL`).
3. Bun + Elysia sudah berjalan.

---

## 1) Struktur file yang disarankan

```
src/
  infra/
    rateLimitStore.ts
  shared/
    rate-limit/
      index.ts
      rateLimit.ts
      store.redis.ts
      types.ts
  modules/
    orders/
      order.routes.ts
  modules/
    index.ts
```

---

## 2) Definisikan tipe store + result

**`src/shared/rate-limit/types.ts`**

```ts
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms
};

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

export type RateLimitOptions = {
  store: RateLimitStore;
  limit: number;
  windowMs: number;
  prefix?: string;
  keyGenerator?: (req: Request) => string;
};
```

---

## 3) Implement RateLimitStore Redis (Lua: INCR + PEXPIRE + PTTL)

**`src/shared/rate-limit/store.redis.ts`** (contoh)

```ts
import Redis from 'ioredis';
import type { RateLimitStore, RateLimitResult } from './types';

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

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private redis: Redis) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const [allowedFlag, current, ttl] = (await this.redis.eval(
      LUA,
      1,
      key,
      String(limit),
      String(windowMs),
    )) as [number, number, number];

    const allowed = allowedFlag === 1;
    const remaining = Math.max(limit - current, 0);
    const resetAt = Date.now() + ttl;

    return { allowed, remaining, resetAt };
  }
}
```

---

## 4) Factory `getRateLimitStore()` (shared instance Redis)

**`src/infra/rateLimitStore.ts`**

```ts
import Redis from 'ioredis';
import { RedisRateLimitStore } from '../shared/rate-limit/store.redis';

let singleton: RedisRateLimitStore | null = null;

export function getRateLimitStore() {
  if (singleton) return singleton;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required for rate limiting');

  const redis = new Redis(redisUrl);
  singleton = new RedisRateLimitStore(redis);
  return singleton;
}
```

---

## 5) Plugin Elysia `rateLimit()` (scope + anti-dedupe + headers + 429)

**Poin penting:**

- Gunakan **`scoped`** agar plugin membungkus parent (group routes) + descendants.
  ([elysiajs.com][1])
- Buat **`name` unik** (atau gunakan `seed`) agar konfigurasi tidak ketiban dedupe.
  ([elysiajs.com][2])

**`src/shared/rate-limit/rateLimit.ts`**

```ts
import { Elysia } from 'elysia';
import { tooManyRequests } from '../http/errors';
import type { RateLimitOptions } from './types';

const RL_DEBUG = process.env.RL_DEBUG === '1';
const rlLog = (...args: any[]) => RL_DEBUG && console.log(...args);

function getClientIp(req: Request) {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function rateLimit(opts: RateLimitOptions) {
  const prefix = opts.prefix ?? 'rl';
  const keyGen = opts.keyGenerator ?? ((req) => `ip:${getClientIp(req)}`);

  // ✅ anti-dedupe: unik per konfigurasi
  const pluginName = `rate-limit:${prefix}:${opts.limit}:${opts.windowMs}`;

  rlLog('[RL:init]', { pluginName, prefix, limit: opts.limit, windowMs: opts.windowMs });

  return new Elysia({ name: pluginName }).onBeforeHandle(
    { as: 'scoped' }, // ✅ scope benar untuk group routes :contentReference[oaicite:6]{index=6}
    async ({ request, set }) => {
      const path = new URL(request.url).pathname;
      const key = `${prefix}:${keyGen(request)}`;

      const r = await opts.store.consume(key, opts.limit, opts.windowMs);

      rlLog('[RL:req]', { method: request.method, path, key });
      rlLog('[RL:res]', {
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

        rlLog('[RL:block]', { path, key, retryAfterSec });

        throw tooManyRequests('Rate limit exceeded', {
          limit: opts.limit,
          windowMs: opts.windowMs,
          retryAfterSec,
        });
      }
    },
  );
}
```

**`src/shared/rate-limit/index.ts`**

```ts
export * from './rateLimit';
export * from './types';
```

---

## 6) Integrasi ke Orders: group semua POST Orders

**`src/modules/orders/order.routes.ts`** (inti)

```ts
import { Elysia } from 'elysia';
import { rateLimit } from '../../shared/rate-limit';
import { getRateLimitStore } from '../../infra/rateLimitStore';

const ordersPostRoutes = new Elysia({ name: 'orders-post-routes' })
  .use(
    rateLimit({
      store: getRateLimitStore(),
      limit: 3,
      windowMs: 10_000,
      prefix: 'rl:orders:post',
    }),
  )
  .post('/orders' /* ... */)
  .post('/orders/:id/cancel' /* ... */)
  .post('/orders/:id/pay' /* ... */);

export const ordersModule = new Elysia({ name: 'orders-module' })
  .use(ordersPostRoutes)
  .get('/orders' /* ... */)
  .get('/orders/cursor' /* ... */)
  .get('/orders/:id' /* ... */)
  .get('/orders/:id/query' /* ... */);
```

---

## 7) Daftarkan module di root modules

**`src/modules/index.ts`**

```ts
import { Elysia } from 'elysia';
import { ordersModule } from './orders/order.routes';

export const modules = new Elysia().use(ordersModule);
```

---

## 8) Konfigurasi env

**`.env`**

```bash
REDIS_URL=redis://localhost:6379
RL_DEBUG=0
```

---

## 9) Testing manual (curl)

Hit 4 kali dalam 10 detik:

```bash
curl -i -X POST http://localhost:3000/orders/123/cancel
```

Ekspektasi:

- 1–3: status 200, header remaining turun
- ke-4: **429**, ada `retry-after`

---

## 10) Debug checklist kalau “tembus”

1. **Deduplication ketiban** (limit masih 10 padahal harus 3) → pastikan `pluginName` unik atau
   pakai `seed`. ([elysiajs.com][2])
2. **Scope hook salah** → gunakan `scoped` untuk group routes. ([elysiajs.com][1])
3. **IP tidak stabil** (`unknown` atau berubah) → cek `x-forwarded-for` / `x-real-ip` di reverse
   proxy.
4. **Store tidak shared** → pastikan semua instance pakai Redis yang sama (bukan memory).
5. **Key generator salah** → pastikan key tidak berubah tiap request.

Kalau kamu mau, kirim output log `[RL:init]` + 4 request `[RL:req]/[RL:res]` dari endpoint cancel,
nanti aku bantu bacakan alurnya dan tunjukkan titik masalahnya.

[1]: https://elysiajs.com/essential/plugin?utm_source=chatgpt.com 'Plugin'
[2]: https://elysiajs.com/key-concept?utm_source=chatgpt.com 'Key Concept MUST READ'
