import type { DbClient } from '../../db';
import { customers, orders, orderItems, products, orderPayments } from '../../db/schema';
import { eq, sql, asc, desc, and, gte, lte, or, lt, inArray } from 'drizzle-orm';

export type CreateOrderRowInput = {
  customerId: number;
  totalAmountCents: number;
};

export type CreateOrderItemRowInput = {
  orderId: number;
  productId: number;
  qty: number;
  unitPriceCents: number;
  subtotalCents: number;
};

export type LockedProduct = {
  id: number;
  priceCents: number;
  stock: number;
};

// PAY

export type LockedOrder = {
  id: number;
  customerId: number;
  status: 'PENDING' | 'PAID' | 'CANCELED' | string;
  totalAmountCents: number;
  createdAt: unknown;
};

export type PaymentRow = {
  orderId: number;
  paymentId: string;
  paidAt: unknown;
};

export type ListOrdersParams = {
  limit: number;
  offset: number;
  customerId?: number;
  status?: 'PENDING' | 'PAID' | 'CANCELED';
};

export type ListOrdersFilters = {
  customerId?: number;
  status?: 'PENDING' | 'PAID' | 'CANCELED';
  createdAtFrom?: Date;
  createdAtTo?: Date;
};

export type OrderListRow = {
  id: number;
  customerId: number;
  status: string;
  totalAmountCents: number;
  createdAt: unknown;
  paymentId: string | null;
  paidAt: unknown | null;
  itemsCount: number;
};

export type Cursor = { createdAt: Date; id: number };

export class OrderRepository {
  constructor(private readonly dbc: DbClient) {}

  // pakai conn supaya bisa db atau tx
  private conn(conn?: unknown) {
    return (conn ?? this.dbc) as any;
  }

  private buildWhere(filters: ListOrdersFilters) {
    return and(
      filters.customerId ? eq(orders.customerId, filters.customerId) : undefined,
      filters.status ? eq(orders.status, filters.status) : undefined,
      filters.createdAtFrom ? gte(orders.createdAt, filters.createdAtFrom) : undefined,
      filters.createdAtTo ? lte(orders.createdAt, filters.createdAtTo) : undefined,
    );
  }

  async findCustomerById(customerId: number, conn?: unknown) {
    const db = this.conn(conn);
    const [row] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Lock product row (SELECT ... FOR UPDATE) agar aman dari oversell.
   * Ini dieksekusi di dalam transaction.
   */
  async lockProductForUpdate(productId: number, conn: unknown): Promise<LockedProduct | null> {
    const db = this.conn(conn);

    // Raw SQL: paling kompatibel untuk "FOR UPDATE"
    const res = await db.execute(
      sql`select id, price_cents as "priceCents", stock
          from products
          where id = ${productId}
          for update`,
    );

    // bun-sql/drizzle execute bisa berbeda bentuk, jadi ambil rows defensif
    const rows = (res?.rows ?? res) as Array<any>;
    const row = rows?.[0];
    if (!row) return null;

    return {
      id: Number(row.id),
      priceCents: Number(row.priceCents),
      stock: Number(row.stock),
    };
  }

  async decrementStock(productId: number, qty: number, conn: unknown) {
    const db = this.conn(conn);

    await db
      .update(products)
      .set({
        stock: sql`${products.stock} - ${qty}`,
        updatedAt: sql`now()`,
      })
      .where(eq(products.id, productId));
  }

  async createOrder(input: CreateOrderRowInput, conn: unknown) {
    const db = this.conn(conn);
    const [row] = await db
      .insert(orders)
      .values({
        customerId: input.customerId,
        totalAmountCents: input.totalAmountCents,
        // status default PENDING dari schema
      })
      .returning();

    return row!;
  }

  async createOrderItems(items: CreateOrderItemRowInput[], conn: unknown) {
    const db = this.conn(conn);
    if (items.length === 0) return [];

    const rows = await db.insert(orderItems).values(items).returning();
    return rows as any[];
  }

  // -------- PAY: idempotency --------

  /** lock order row supaya pay tidak race */
  async lockOrderForUpdate(orderId: number, conn: unknown): Promise<LockedOrder | null> {
    const db = this.conn(conn);

    const res = await db.execute(
      sql`select id,
                 customer_id as "customerId",
                 status,
                 total_amount_cents as "totalAmountCents",
                 created_at as "createdAt"
          from orders
          where id = ${orderId}
          for update`,
    );

    const rows = (res?.rows ?? res) as Array<any>;
    const row = rows?.[0];
    if (!row) return null;

    return {
      id: Number(row.id),
      customerId: Number(row.customerId),
      status: row.status,
      totalAmountCents: Number(row.totalAmountCents),
      createdAt: row.createdAt,
    };
  }

  async findPaymentByOrderId(orderId: number, conn: unknown): Promise<PaymentRow | null> {
    const db = this.conn(conn);
    const [row] = await db
      .select({
        orderId: orderPayments.orderId,
        paymentId: orderPayments.paymentId,
        paidAt: orderPayments.paidAt,
      })
      .from(orderPayments)
      .where(eq(orderPayments.orderId, orderId))
      .limit(1);

    return row ?? null;
  }

  async createPayment(orderId: number, paymentId: string, conn: unknown): Promise<PaymentRow> {
    const db = this.conn(conn);
    const [row] = await db.insert(orderPayments).values({ orderId, paymentId }).returning({
      orderId: orderPayments.orderId,
      paymentId: orderPayments.paymentId,
      paidAt: orderPayments.paidAt,
    });

    return row!;
  }

  async markOrderPaid(orderId: number, conn: unknown) {
    const db = this.conn(conn);
    const [row] = await db
      .update(orders)
      .set({ status: 'PAID' })
      .where(eq(orders.id, orderId))
      .returning({
        id: orders.id,
        status: orders.status,
        totalAmountCents: orders.totalAmountCents,
      });

    return row!;
  }

  // ========= GET DETAIL =========

  /**
   * Read-heavy: single join query for order detail.
   * Returns 0 rows if order not found.
   * Rows count ~= number of items (N).
   */
  async getOrderDetailJoined(orderId: number, conn?: unknown) {
    const db = this.conn(conn);

    const rows = await db
      .select({
        // order
        orderId: orders.id,
        customerId: orders.customerId,
        status: orders.status,
        totalAmountCents: orders.totalAmountCents,
        createdAt: orders.createdAt,

        // payment (0/1)
        paymentId: orderPayments.paymentId,
        paidAt: orderPayments.paidAt,

        // item (N)
        itemId: orderItems.id,
        productId: orderItems.productId,
        qty: orderItems.qty,
        unitPriceCents: orderItems.unitPriceCents,
        subtotalCents: orderItems.subtotalCents,

        // product
        productName: products.name,
      })
      .from(orders)
      .leftJoin(orderPayments, eq(orderPayments.orderId, orders.id))
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orders.id, orderId))
      .orderBy(asc(orderItems.id));

    return rows as Array<{
      orderId: number;
      customerId: number;
      status: string;
      totalAmountCents: number;
      createdAt: unknown;

      paymentId: string | null;
      paidAt: unknown | null;

      itemId: number | null;
      productId: number | null;
      qty: number | null;
      unitPriceCents: number | null;
      subtotalCents: number | null;
      productName: string | null;
    }>;
  }

  async getOrderDetailViaQueryApi(orderId: number) {
    const dbAny = this.dbc as any;

    // Pastikan db sudah drizzle(..., { schema })
    const row = await dbAny.query.orders.findFirst({
      where: (o: any, { eq }: any) => eq(o.id, orderId),
      with: {
        payment: {
          columns: {
            paymentId: true,
            paidAt: true,
          },
        },
        items: {
          columns: {
            id: true,
            productId: true,
            qty: true,
            unitPriceCents: true,
            subtotalCents: true,
          },
          with: {
            product: {
              columns: { name: true },
            },
          },
          orderBy: (oi: any, { asc }: any) => [asc(oi.id)],
        },
      },
    });

    return row as null | {
      id: number;
      customerId: number;
      status: string;
      totalAmountCents: number;
      createdAt: unknown;
      payment: null | { paymentId: string; paidAt: unknown };
      items: Array<{
        id: number;
        productId: number;
        qty: number;
        unitPriceCents: number;
        subtotalCents: number;
        product: null | { name: string };
      }>;
    };
  }

  async listOrders(params: ListOrdersParams, conn?: unknown) {
    const db = this.conn(conn);

    const where = and(
      params.customerId ? eq(orders.customerId, params.customerId) : undefined,
      params.status ? eq(orders.status, params.status) : undefined,
    );

    const rows = await db
      .select({
        id: orders.id,
        customerId: orders.customerId,
        status: orders.status,
        totalAmountCents: orders.totalAmountCents,
        createdAt: orders.createdAt,

        paymentId: orderPayments.paymentId,
        paidAt: orderPayments.paidAt,

        itemsCount: sql<number>`count(${orderItems.id})::int`,
      })
      .from(orders)
      .leftJoin(orderPayments, eq(orderPayments.orderId, orders.id))
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(where)
      .groupBy(orders.id, orderPayments.paymentId, orderPayments.paidAt)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(params.limit)
      .offset(params.offset);

    return rows as Array<{
      id: number;
      customerId: number;
      status: string;
      totalAmountCents: number;
      createdAt: unknown;
      paymentId: string | null;
      paidAt: unknown | null;
      itemsCount: number;
    }>;
  }

  //

  async listOrdersOffset(
    params: ListOrdersFilters & { limit: number; offset: number },
    conn?: unknown,
  ): Promise<OrderListRow[]> {
    const db = this.conn(conn);
    const where = this.buildWhere(params);

    const rows = await db
      .select({
        id: orders.id,
        customerId: orders.customerId,
        status: orders.status,
        totalAmountCents: orders.totalAmountCents,
        createdAt: orders.createdAt,

        paymentId: orderPayments.paymentId,
        paidAt: orderPayments.paidAt,

        itemsCount: sql<number>`count(${orderItems.id})::int`,
      })
      .from(orders)
      .leftJoin(orderPayments, eq(orderPayments.orderId, orders.id))
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(where)
      .groupBy(orders.id, orderPayments.paymentId, orderPayments.paidAt)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(params.limit)
      .offset(params.offset);

    return rows as OrderListRow[];
  }

  async countOrders(filters: ListOrdersFilters, conn?: unknown): Promise<number> {
    const db = this.conn(conn);
    const where = this.buildWhere(filters);

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(where);

    return row?.count ?? 0;
  }

  async listOrdersCursor(
    params: ListOrdersFilters & { limit: number; cursor?: Cursor },
    conn?: unknown,
  ): Promise<OrderListRow[]> {
    const db = this.conn(conn);

    const baseWhere = this.buildWhere(params);

    // Cursor rule (DESC): next page = (createdAt < cAt) OR (createdAt = cAt AND id < cId)
    const cursorWhere = params.cursor
      ? or(
          lt(orders.createdAt, params.cursor.createdAt),
          and(eq(orders.createdAt, params.cursor.createdAt), lt(orders.id, params.cursor.id)),
        )
      : undefined;

    const where = and(baseWhere, cursorWhere);

    const rows = await db
      .select({
        id: orders.id,
        customerId: orders.customerId,
        status: orders.status,
        totalAmountCents: orders.totalAmountCents,
        createdAt: orders.createdAt,

        paymentId: orderPayments.paymentId,
        paidAt: orderPayments.paidAt,

        itemsCount: sql<number>`count(${orderItems.id})::int`,
      })
      .from(orders)
      .leftJoin(orderPayments, eq(orderPayments.orderId, orders.id))
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(where)
      .groupBy(orders.id, orderPayments.paymentId, orderPayments.paidAt)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(params.limit);

    return rows as OrderListRow[];
  }

  async listOrderItemsByOrderIds(orderIds: number[], conn?: unknown) {
    const db = this.conn(conn);
    if (orderIds.length === 0) return [];

    const rows = await db
      .select({
        orderId: orderItems.orderId,
        productId: orderItems.productId,
        qty: orderItems.qty,
        unitPriceCents: orderItems.unitPriceCents,
        subtotalCents: orderItems.subtotalCents,
        productName: products.name,
      })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(inArray(orderItems.orderId, orderIds))
      .orderBy(asc(orderItems.orderId), asc(orderItems.id));

    return rows as Array<{
      orderId: number;
      productId: number;
      qty: number;
      unitPriceCents: number;
      subtotalCents: number;
      productName: string | null;
    }>;
  }

  async listOrderItemsForStock(orderId: number, conn: unknown) {
    const db = this.conn(conn);

    const rows = await db
      .select({
        productId: orderItems.productId,
        qty: orderItems.qty,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.productId));

    return rows as Array<{ productId: number; qty: number }>;
  }

  async incrementStock(productId: number, qty: number, conn: unknown) {
    const db = this.conn(conn);

    await db
      .update(products)
      .set({
        stock: sql`${products.stock} + ${qty}`,
        updatedAt: sql`now()`,
      })
      .where(eq(products.id, productId));
  }

  async markOrderCanceled(orderId: number, conn: unknown) {
    const db = this.conn(conn);

    const [row] = await db
      .update(orders)
      .set({ status: 'CANCELED' })
      .where(eq(orders.id, orderId))
      .returning({
        id: orders.id,
        status: orders.status,
      });

    return row ?? null;
  }
}
