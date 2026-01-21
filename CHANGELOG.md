## CHANGELOG

Mengikuti _Keep a Changelog_ + _Semantic Versioning_.

### [Unreleased]

#### Added

- (Planned) Rate limiting di **edge/gateway** (WAF/Ingress/API Gateway) sebagai proteksi awal
  sebelum aplikasi.

#### Changed

- (Planned) Upgrade algoritma dari **fixed-window counter** ke **token bucket/sliding window** untuk
  kontrol burst yang lebih halus.

---

## [1.8.0] — 2026-01-21

### Added

- Rate limiting berbasis Redis untuk semua endpoint `POST` pada modul Orders:
  - `POST /orders`
  - `POST /orders/:id/cancel`
  - `POST /orders/:id/pay`

- Header rate limit:
  - `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `retry-after`

- Redis sebagai shared store agar rate limit konsisten lintas instance/multi server.
- Toggle debug (`RL_DEBUG`) untuk membantu troubleshooting.

### Changed

- Orders routing dipecah menjadi group khusus `POST` (`ordersPostRoutes`) agar rate limit hanya
  berlaku untuk endpoint mutasi.
- Rate limit diimplementasikan sebagai plugin Elysia (`onBeforeHandle`) dan dipasang pada group
  routes.

### Fixed

- Menghindari konfigurasi rate limit yang saling “ketiban” (dedupe plugin) dengan membuat identitas
  plugin unik per konfigurasi (`name` unik atau `seed`).

### Security

- Mitigasi spam/abuse pada endpoint sensitif Orders (create/cancel/pay) dengan throttling per client
  dan respons 429.

---

## Catatan standar industri yang perlu diperhatikan / diimplementasikan

1. **Layered rate limiting**
   - Edge/Gateway (disarankan) → Application (sudah) → Proteksi endpoint berat (opsional)

2. **Identitas jangan cuma IP**
   - Utamakan `tenantId/userId/apiKey`, fallback IP

3. **Bucket stabil per endpoint**
   - Jangan pecah key karena `:id` dinamis

4. **Algoritma**
   - Fixed window sederhana tapi bisa burst; pertimbangkan token bucket/sliding window jika perlu

5. **Failure mode Redis**
   - Tentukan fail-open vs fail-close + timeout

6. **Observability**
   - Metric allowed/blocked, redis latency, error rate

7. **Trust proxy**
   - Pastikan XFF hanya dipercaya dari proxy trusted dan app tidak bisa diakses langsung

8. **Allowlist/skip**
   - internal/healthcheck/admin

---

# Step-by-step implementasi (yang sekarang digunakan)

> Target: semua `POST` di Orders kena limit **3 request / 10 detik** per client (IP), konsisten
> lintas instance.

## Step 1 — Siapkan Redis & env

1. Jalankan Redis (local docker atau managed).
2. Set env:
   - `REDIS_URL=redis://localhost:6379`
   - `RL_DEBUG=0` (ubah ke `1` saat debugging)

## Step 2 — Implement store Redis (RateLimitStore)

1. Buat store Redis yang punya method:
   - `consume(key, limit, windowMs) -> { allowed, remaining, resetAt }`

2. Gunakan Lua script agar operasi atomic:
   - `INCR key`
   - kalau `current == 1` → `PEXPIRE key windowMs`
   - ambil `PTTL`
   - return flag allowed + ttl

3. Hitung `remaining` dan `resetAt` di aplikasi:
   - `remaining = max(limit - current, 0)`
   - `resetAt = now + ttl`

## Step 3 — Buat factory singleton Redis store

1. Buat `getRateLimitStore()` agar koneksi Redis tidak dibuat berulang.
2. `getRateLimitStore()` membaca `REDIS_URL`.
3. Return store yang sama untuk semua module.

## Step 4 — Implement plugin `rateLimit(opts)` di Elysia

1. Buat plugin Elysia yang memasang hook `onBeforeHandle`.
2. Di hook:
   - Ambil method + path untuk logging.
   - Ambil client identity (default: IP via `x-forwarded-for` lalu `x-real-ip`, fallback `unknown`).
   - Bentuk key Redis: `prefix:keyGen(request)`
   - Panggil `opts.store.consume(...)`.

3. Pasang header rate limit:
   - `x-ratelimit-limit`
   - `x-ratelimit-remaining`
   - `x-ratelimit-reset`
   - jika blocked → `retry-after`

4. Jika `allowed == false`, throw error 429 (`tooManyRequests`).
5. **Penting**:
   - Pakai scope yang tepat agar membungkus group route (`scoped` direkomendasikan).
   - Hindari dedupe plugin dengan identitas unik per konfigurasi (`name` unik atau `seed`).

## Step 5 — Integrasi ke Orders (group khusus POST)

1. Buat group routes khusus POST Orders.
2. Tempel plugin rateLimit di group itu:
   - `limit: 3`
   - `windowMs: 10_000`
   - `prefix: 'rl:orders:post'`

3. Definisikan semua POST Orders di group tersebut:
   - `/orders`
   - `/orders/:id/cancel`
   - `/orders/:id/pay`

4. Export module Orders dan `.use(ordersPostRoutes)` di module utama Orders.

## Step 6 — Daftarkan Orders module ke root modules/app

1. Pastikan module Orders di-use oleh `src/modules/index.ts` atau entrypoint app.
2. Jalankan app dan pastikan routes aktif.

## Step 7 — Testing manual (wajib)

1. Panggil `POST /orders/:id/cancel` 4x dalam 10 detik:
   - request 1–3: sukses
   - request 4: 429

2. Periksa header:
   - `x-ratelimit-limit` harus `3`
   - `retry-after` muncul saat 429

## Step 8 — Debugging cepat (saat tembus)

1. Nyalakan debug: `RL_DEBUG=1`
2. Pastikan log muncul untuk endpoint yang dites:
   - `[RL:init]` (plugin kepasang)
   - `[RL:req]` (hook kepanggil)
   - `[RL:res]` (remaining turun)
   - `[RL:block]` (429 saat limit lewat)

3. Jika limit masih “10”, cek dedupe plugin (name/seed).
4. Jika remaining tidak turun, cek IP/key berubah-ubah (XFF/Real-IP/proxy).
5. Jika aplikasi multi worker, pastikan store benar-benar Redis shared (bukan memory).
