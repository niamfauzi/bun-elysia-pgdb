import { pgTable, integer, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { orders } from './orders.table';
import { products } from '../products';

export const orderItems = pgTable(
  'order_items',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),

    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),

    qty: integer().notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('order_items_order_id_idx').on(t.orderId),
    index('order_items_product_id_idx').on(t.productId),

    check('order_items_qty_ck', sql`${t.qty} > 0`),
    check('order_items_unit_price_ck', sql`${t.unitPriceCents} >= 0`),
    check('order_items_subtotal_ck', sql`${t.subtotalCents} >= 0`),
  ],
);
