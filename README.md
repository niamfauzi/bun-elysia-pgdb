# Order Service (Bun + Elysia + Drizzle + PostgreSQL)

Service backend untuk **produk + customer + order transaksi** dengan fokus praktik production-ready:

- validasi request
- logging + request-id
- error handler konsisten
- transaksi (reserve stock)
- idempotency payment
- cancel order (rollback stock)
- read-heavy order detail (join)

## Tech Stack

- **Runtime:** Bun
- **Framework:** Elysia
- **Database:** PostgreSQL (Docker Compose)
- **ORM:** Drizzle ORM + drizzle-kit (migrations)
- **Logging:** Pino (structured logs)
- **Validation:** `t.*` (Elysia schema)

---

## Fitur Utama

### Products

- CRUD basic:
  - `POST /products`
  - `GET /products`
  - `GET /products/:id`
  - `PATCH /products/:id`
  - `DELETE /products/:id`

### Customers

- Module customers tersedia (endpoint mengikuti implementasi di repo).

### Orders

- Create order (reserve stock, atomic transaction, anti-oversell)
  - `POST /orders`

- Pay order (idempotency via `paymentId`, anti double-charge)
  - `POST /orders/:id/pay`

- Cancel order (rollback stock jika belum PAID)
  - `POST /orders/:id/cancel`

- Get order detail (read-heavy)
  - `GET /orders/:id`

- List orders
  - Offset pagination: `GET /orders`
  - Cursor pagination (endpoint pembanding): `GET /orders/cursor`
  - Filter date range: `createdAtFrom/createdAtTo`
  - Default hemat query: `includeItems=false`

### Health

- `GET /healthz` (opsional DB ping)

---

## Struktur Project

Contoh struktur (ringkas):

```
src/
  app.ts
  server.ts
  db/
    index.ts                 # init drizzle db
    schema/
      enums.ts
      products.ts
      customers.ts
      orders/
        orders.table.ts
        order_items.table.ts
        order_payments.table.ts
        index.ts
      index.ts               # export semua schema (dan relations jika dipakai)
  modules/
    products/
      product.schema.ts
      product.repository.ts
      product.service.ts
      product.routes.ts
      index.ts
    customers/
      ...
    orders/
      order.schema.ts
      order.repository.ts
      order.service.ts
      order.routes.ts
      index.ts
  shared/
    http/
      error-handler.ts
      errors.ts
      validation.ts
    logging/
      logger.ts
      requestContext.ts
      requestMeta.ts
```

---

## Setup & Menjalankan

### Prerequisites

- Bun
- Docker + Docker Compose

### 1) Jalankan PostgreSQL (Docker)

```bash
docker compose up -d
docker compose logs -f
```

### 2) Install dependencies

```bash
bun install
```

### 3) Migrations (Drizzle)

Generate migration (jika ada perubahan schema):

```bash
bunx drizzle-kit generate
```

Apply migration:

```bash
bunx drizzle-kit migrate
```

### 4) Seed (Products)

Jika repo kamu punya `src/seed.ts`:

```bash
bun run src/seed.ts
```

### 5) Jalankan API

Tergantung script repo kamu, salah satu biasanya:

```bash
bun run dev
# atau
bun run src/server.ts
```

---

## Environment Variables

Contoh `.env`:

```env
NODE_ENV=development
PORT=41102

DATABASE_URL=postgres://app:app@localhost:5432/order_service

# logging
LOG_LEVEL=info
```

### Catatan Logging Query DB

Jika kamu memakai Drizzle custom logger dengan:

- `logger.debug({ query, params }, "db_query")`

maka query log hanya muncul jika:

- `LOG_LEVEL=debug` (dev)

---

## Logging, Request-ID, dan Error Format

### Request-ID

- Server meng-set header `x-request-id` untuk semua response (termasuk 404).
- Jika client mengirim `x-request-id`, server akan meneruskan; kalau tidak, server generate UUID.

### Pola Log (recommended)

- **development**: 2 log (start + end) → membantu debugging request hang/hilang
- **production**: 1 log (end-only / access log) → hemat storage & mudah metrics

### Error Response (konsisten)

Contoh:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found"
  },
  "requestId": "..."
}
```

### Validation Error (ringkas)

Validation error dibuat lebih pendek lewat `shared/http/validation.ts`, contoh:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": {
      "source": "body",
      "issues": [{ "path": "name", "message": "Expected string length greater or equal to 1" }]
    }
  },
  "requestId": "..."
}
```

---

## API Endpoints

### Health

```bash
curl -i http://localhost:41102/healthz
```

### Products

Create:

```bash
curl -i -X POST http://localhost:41102/products \
  -H 'content-type: application/json' \
  -d '{"name":"Apple","priceCents":1000,"stock":10}'
```

List:

```bash
curl -i http://localhost:41102/products
```

Get by id:

```bash
curl -i http://localhost:41102/products/1
```

Patch:

```bash
curl -i -X PATCH http://localhost:41102/products/1 \
  -H 'content-type: application/json' \
  -d '{"stock": 99}'
```

Delete:

```bash
curl -i -X DELETE http://localhost:41102/products/1
```

---

### Orders

#### Create Order (reserve stock)

```bash
curl -i -X POST http://localhost:41102/orders \
  -H 'content-type: application/json' \
  -d '{"customerId":1,"items":[{"productId":1,"qty":2}]}'
```

#### Pay Order (idempotency)

```bash
curl -i -X POST http://localhost:41102/orders/1/pay \
  -H 'content-type: application/json' \
  -d '{"paymentId":"pay_001"}'
```

Retry dengan paymentId sama → **200 OK** (idempotent). paymentId beda untuk order yang sudah PAID →
**409 CONFLICT**.

#### Cancel Order

```bash
curl -i -X POST http://localhost:41102/orders/1/cancel
```

- Jika `PENDING` → status jadi `CANCELED` dan stock di-rollback
- Jika `PAID` → 409 (tidak boleh cancel)
- Jika sudah `CANCELED` → 200 idempotent

#### Get Order Detail (read-heavy)

```bash
curl -i http://localhost:41102/orders/1
```

#### List Orders (Offset)

Default `includeItems=false`:

```bash
curl -i "http://localhost:41102/orders?limit=10&offset=0"
```

Filter by customer/status/date range:

```bash
curl -i "http://localhost:41102/orders?customerId=1&status=PAID&createdAtFrom=2025-12-01T00:00:00.000Z&createdAtTo=2025-12-31T23:59:59.999Z"
```

Include items:

```bash
curl -i "http://localhost:41102/orders?limit=10&offset=0&includeItems=true"
```

#### List Orders (Cursor)

Page 1:

```bash
curl -i "http://localhost:41102/orders/cursor?limit=10"
```

Page 2:

```bash
curl -i "http://localhost:41102/orders/cursor?limit=10&cursor=<nextCursor>"
```

---

## DB Indexes (Read-heavy)

Untuk performa `GET /orders/:id` dan list/cursor:

**Wajib**

- `order_items(order_id, id)` → cepat filter + stable order
- `order_payments(order_id)` unique → 0/1 payment per order
- `order_payments(payment_id)` unique → idempotency

**Disarankan untuk list/cursor**

- `orders(created_at, id)`
- `orders(customer_id, created_at, id)`
- (opsional) `orders(status, created_at, id)` jika filter status sering

Verifikasi dengan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM order_items
WHERE order_id = 123
ORDER BY id;
```

---

## Troubleshooting

### Drizzle migrate: “please install pg/postgres driver”

Pastikan driver DB terinstall sesuai adapter Drizzle yang dipakai (`pg` atau `postgres`).

### Query log tidak muncul

- Jika query log pakai `logger.debug(...)` → pastikan `LOG_LEVEL=debug`.
- Pastikan semua module import `db` dari file init yang sama.

### Error handler tidak override validation / response berubah

Pastikan error handler dipasang sebagai plugin global dan `.use(errorHandler)` dilakukan sebelum
mount routes/modules.

---

## Status Roadmap

Sesi yang sudah terimplementasi:

- S1–S7 (DB/tooling, global concerns, products, create order, pay, cancel, read-heavy detail + list
  pagination) Belum:
- S8 (integration testing minimal + simulasi concurrent)

---

Jika kamu mau, setelah README ini kita lanjut **Sesi 8** dengan setup integration test (Docker
Postgres test DB + happy path + idempotency + race pay vs cancel).
