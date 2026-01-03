import { db } from '../../db';
import { OrderRepository, type Cursor, type ListOrdersFilters } from './order.repository';
import { badRequest, conflict, notFound } from '../../shared/http/errors';

type CreateOrderInput = {
  customerId: number;
  items: Array<{ productId: number; qty: number }>;
};

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return String(v);
}

function parseDate(label: string, v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${label} must be ISO date-time`);
  return d;
}

function parseIncludeItems(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v === undefined || v === null) return false;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

function encodeCursor(c: { createdAt: string; id: number }): string {
  const json = JSON.stringify(c);
  const b64 = Buffer.from(json).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(cursor?: string): Cursor | undefined {
  if (!cursor) return undefined;
  const pad = cursor.length % 4 === 0 ? '' : '='.repeat(4 - (cursor.length % 4));
  const b64 = (cursor + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = Buffer.from(b64, 'base64').toString('utf8');
  const obj = JSON.parse(raw);

  const id = Number(obj?.id);
  const createdAt = new Date(obj?.createdAt);
  if (!Number.isFinite(id) || Number.isNaN(createdAt.getTime())) throw badRequest('invalid cursor');

  return { id, createdAt };
}

export class OrderService {
  constructor(private readonly repo: OrderRepository) {}

  /**
   * Create Order + reserve stock (anti-oversell)
   * Strategy:
   * - DB transaction
   * - Lock setiap product row FOR UPDATE
   * - Validate stock
   * - Insert order + items
   * - Decrement stock
   */
  async createOrder(input: CreateOrderInput) {
    if (!input.items || input.items.length === 0) {
      throw badRequest('items is required');
    }

    // Normalize: gabungkan duplicate productId (best practice)
    const aggregated = new Map<number, number>();
    for (const it of input.items) {
      if (it.qty <= 0) throw badRequest('qty must be > 0');
      aggregated.set(it.productId, (aggregated.get(it.productId) ?? 0) + it.qty);
    }

    const items = [...aggregated.entries()].map(([productId, qty]) => ({
      productId,
      qty,
    }));

    return db.transaction(async (tx: any) => {
      // 1) customer exists
      const cust = await this.repo.findCustomerById(input.customerId, tx);
      if (!cust) throw notFound('customer not found', { customerId: input.customerId });

      // 2) lock products + compute totals
      const lockedProducts = new Map<number, { priceCents: number; stock: number }>();

      for (const it of items) {
        const p = await this.repo.lockProductForUpdate(it.productId, tx);
        if (!p) throw notFound('product not found', { productId: it.productId });

        lockedProducts.set(it.productId, { priceCents: p.priceCents, stock: p.stock });

        if (p.stock < it.qty) {
          throw conflict('insufficient stock', {
            productId: it.productId,
            requested: it.qty,
            available: p.stock,
          });
        }
      }

      // 3) build order items rows
      const itemRows = items.map((it) => {
        const p = lockedProducts.get(it.productId)!;
        const subtotalCents = p.priceCents * it.qty;
        return {
          productId: it.productId,
          qty: it.qty,
          unitPriceCents: p.priceCents,
          subtotalCents,
        };
      });

      const totalAmountCents = itemRows.reduce((sum, r) => sum + r.subtotalCents, 0);

      // 4) insert order
      const orderRow = await this.repo.createOrder(
        { customerId: input.customerId, totalAmountCents },
        tx,
      );

      // 5) insert order items
      await this.repo.createOrderItems(
        itemRows.map((r) => ({ ...r, orderId: orderRow.id })),
        tx,
      );

      // 6) decrement stock (still within same tx + locked rows)
      for (const it of items) {
        await this.repo.decrementStock(it.productId, it.qty, tx);
      }

      // 7) return DTO
      return {
        id: orderRow.id,
        customerId: orderRow.customerId,
        status: orderRow.status,
        totalAmountCents: orderRow.totalAmountCents,
        createdAt: toIso(orderRow.createdAt),
        items: itemRows,
      };
    });
  }

  // -------- SESI 5: PAY ORDER (Idempotency) --------
  async payOrder(orderId: number, input: { paymentId: string }) {
    const paymentId = input.paymentId.trim();
    if (!paymentId) throw badRequest('paymentId is required');

    return db.transaction(async (tx: any) => {
      // 1) lock order
      const order = await this.repo.lockOrderForUpdate(orderId, tx);
      if (!order) throw notFound('order not found', { orderId });

      // 2) reject canceled
      if (order.status === 'CANCELED') {
        throw conflict('order is canceled', { orderId });
      }

      // 3) check existing payment (if any)
      const existingPayment = await this.repo.findPaymentByOrderId(orderId, tx);

      // 4) idempotency for already paid
      if (order.status === 'PAID') {
        if (existingPayment?.paymentId === paymentId) {
          return {
            order: { id: order.id, status: 'PAID', totalAmountCents: order.totalAmountCents },
            payment: {
              paymentId: existingPayment.paymentId,
              paidAt: toIso(existingPayment.paidAt),
            },
          };
        }
        throw conflict('order already paid', {
          orderId,
          paymentId: existingPayment?.paymentId ?? null,
        });
      }

      // 5) order PENDING
      if (existingPayment) {
        // payment record already exists (maybe retry)
        if (existingPayment.paymentId === paymentId) {
          // ensure order marked paid (self-heal if needed)
          await this.repo.markOrderPaid(orderId, tx);
          return {
            order: { id: order.id, status: 'PAID', totalAmountCents: order.totalAmountCents },
            payment: {
              paymentId: existingPayment.paymentId,
              paidAt: toIso(existingPayment.paidAt),
            },
          };
        }
        throw conflict('payment already exists for this order', {
          orderId,
          paymentId: existingPayment.paymentId,
        });
      }

      // 6) create payment + mark order paid atomically
      let paymentRow;
      try {
        paymentRow = await this.repo.createPayment(orderId, paymentId, tx);
      } catch (e: any) {
        // handle concurrent unique conflict (Postgres unique violation)
        if (e?.code === '23505') {
          // re-read and decide idempotency
          const p = await this.repo.findPaymentByOrderId(orderId, tx);
          if (p?.paymentId === paymentId) {
            await this.repo.markOrderPaid(orderId, tx);
            return {
              order: { id: order.id, status: 'PAID', totalAmountCents: order.totalAmountCents },
              payment: { paymentId: p.paymentId, paidAt: toIso(p.paidAt) },
            };
          }
          throw conflict('duplicate payment', { orderId, paymentId });
        }
        throw e;
      }

      await this.repo.markOrderPaid(orderId, tx);

      return {
        order: { id: order.id, status: 'PAID', totalAmountCents: order.totalAmountCents },
        payment: { paymentId: paymentRow.paymentId, paidAt: toIso(paymentRow.paidAt) },
      };
    });
  }

  async getOrderDetail(orderId: number) {
    const rows = await this.repo.getOrderDetailJoined(orderId);
    // console.log('rows:', rows);

    if (!rows.length) throw notFound('order not found', { orderId });

    const head = rows[0];

    const payment = head.paymentId
      ? {
          paymentId: String(head.paymentId),
          paidAt: toIso(head.paidAt),
        }
      : null;

    const items = rows
      .filter((r) => r.itemId != null && r.productId != null)
      .map((r) => ({
        productId: Number(r.productId),
        qty: Number(r.qty),
        unitPriceCents: Number(r.unitPriceCents),
        subtotalCents: Number(r.subtotalCents),
        ...(r.productName ? { productName: r.productName } : {}),
      }));

    return {
      id: head.orderId,
      customerId: head.customerId,
      status: head.status,
      totalAmountCents: head.totalAmountCents,
      createdAt: toIso(head.createdAt),
      items,
      payment,
    };
  }

  async getOrderDetailQueryApi(orderId: number) {
    const row = await this.repo.getOrderDetailViaQueryApi(orderId);
    if (!row) throw notFound('order not found', { orderId });

    return {
      id: row.id,
      customerId: row.customerId,
      status: row.status,
      totalAmountCents: row.totalAmountCents,
      createdAt: toIso(row.createdAt),
      payment: row.payment
        ? { paymentId: row.payment.paymentId, paidAt: toIso(row.payment.paidAt) }
        : null,
      items: row.items.map((it) => ({
        productId: it.productId,
        qty: it.qty,
        unitPriceCents: it.unitPriceCents,
        subtotalCents: it.subtotalCents,
        ...(it.product?.name ? { productName: it.product.name } : {}),
      })),
    };
  }

  async listOrdersOffset(query: {
    limit: number;
    offset: number;
    customerId?: number;
    status?: 'PENDING' | 'PAID' | 'CANCELED';
    createdAtFrom?: string;
    createdAtTo?: string;
    includeItems?: unknown;
  }) {
    const includeItems = parseIncludeItems(query.includeItems);

    const filters: ListOrdersFilters = {
      customerId: query.customerId,
      status: query.status,
      createdAtFrom: parseDate('createdAtFrom', query.createdAtFrom),
      createdAtTo: parseDate('createdAtTo', query.createdAtTo),
    };

    const [rows, count] = await Promise.all([
      this.repo.listOrdersOffset({ ...filters, limit: query.limit, offset: query.offset }),
      this.repo.countOrders(filters),
    ]);

    let itemsByOrder = new Map<number, any[]>();
    if (includeItems && rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const items = await this.repo.listOrderItemsByOrderIds(ids);

      for (const it of items) {
        const arr = itemsByOrder.get(it.orderId) ?? [];
        arr.push({
          productId: it.productId,
          qty: it.qty,
          unitPriceCents: it.unitPriceCents,
          subtotalCents: it.subtotalCents,
          ...(it.productName ? { productName: it.productName } : {}),
        });
        itemsByOrder.set(it.orderId, arr);
      }
    }

    return {
      data: rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        status: r.status,
        totalAmountCents: r.totalAmountCents,
        createdAt: toIso(r.createdAt),
        itemsCount: r.itemsCount,
        payment: r.paymentId ? { paymentId: r.paymentId, paidAt: toIso(r.paidAt) } : null,
        ...(includeItems ? { items: itemsByOrder.get(r.id) ?? [] } : {}),
      })),
      meta: { limit: query.limit, offset: query.offset, count },
    };
  }

  async listOrdersCursor(query: {
    limit: number;
    cursor?: string;
    customerId?: number;
    status?: 'PENDING' | 'PAID' | 'CANCELED';
    createdAtFrom?: string;
    createdAtTo?: string;
    includeItems?: unknown;
  }) {
    const includeItems = parseIncludeItems(query.includeItems);

    const filters: ListOrdersFilters = {
      customerId: query.customerId,
      status: query.status,
      createdAtFrom: parseDate('createdAtFrom', query.createdAtFrom),
      createdAtTo: parseDate('createdAtTo', query.createdAtTo),
    };

    const decoded = decodeCursor(query.cursor);

    // get limit+1 for detect hasMore
    const rowsPlus = await this.repo.listOrdersCursor({
      ...filters,
      cursor: decoded,
      limit: query.limit + 1,
    });

    const hasMore = rowsPlus.length > query.limit;
    const rows = hasMore ? rowsPlus.slice(0, query.limit) : rowsPlus;

    let itemsByOrder = new Map<number, any[]>();
    if (includeItems && rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const items = await this.repo.listOrderItemsByOrderIds(ids);

      for (const it of items) {
        const arr = itemsByOrder.get(it.orderId) ?? [];
        arr.push({
          productId: it.productId,
          qty: it.qty,
          unitPriceCents: it.unitPriceCents,
          subtotalCents: it.subtotalCents,
          ...(it.productName ? { productName: it.productName } : {}),
        });
        itemsByOrder.set(it.orderId, arr);
      }
    }

    const last = rows[rows.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            createdAt: toIso(last.createdAt) ?? new Date().toISOString(),
            id: last.id,
          })
        : null;

    return {
      data: rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        status: r.status,
        totalAmountCents: r.totalAmountCents,
        createdAt: toIso(r.createdAt),
        itemsCount: r.itemsCount,
        payment: r.paymentId ? { paymentId: r.paymentId, paidAt: toIso(r.paidAt) } : null,
        ...(includeItems ? { items: itemsByOrder.get(r.id) ?? [] } : {}),
      })),
      meta: { limit: query.limit, nextCursor, hasMore },
    };
  }

  async cancelOrder(orderId: number) {
    return db.transaction(async (tx: any) => {
      // 1) lock order (anti race pay vs cancel)
      const order = await this.repo.lockOrderForUpdate(orderId, tx);
      if (!order) throw notFound('order not found', { orderId });

      // idempotent
      if (order.status === 'CANCELED') {
        return {
          order: { id: order.id, status: 'CANCELED' },
          rolledBack: false,
        };
      }

      // business rule: tidak boleh cancel kalau sudah paid
      if (order.status === 'PAID') {
        throw conflict('order already paid', { orderId });
      }

      // kita anggap hanya PENDING yang bisa dicancel
      if (order.status !== 'PENDING') {
        throw conflict('order is not cancelable', { orderId, status: order.status });
      }

      // 2) ambil items untuk rollback stock
      const items = await this.repo.listOrderItemsForStock(orderId, tx);

      // 3) lock product rows dalam urutan productId (hindari deadlock)
      for (const it of items) {
        const p = await this.repo.lockProductForUpdate(it.productId, tx);
        if (!p) {
          // idealnya gak terjadi (FK), tapi tetap aman
          throw notFound('product not found', { productId: it.productId });
        }
      }

      // 4) rollback stock
      for (const it of items) {
        await this.repo.incrementStock(it.productId, it.qty, tx);
      }

      // 5) update order status -> CANCELED
      const canceled = await this.repo.markOrderCanceled(orderId, tx);
      if (!canceled) throw notFound('order not found', { orderId });

      return {
        order: { id: canceled.id, status: canceled.status },
        rolledBack: true,
      };
    });
  }
}
