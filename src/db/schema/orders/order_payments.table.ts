import { pgTable, integer, timestamp, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core';

import { orders } from './orders.table';

/**
 * Idempotency payment:
 * - payment_id unik global
 * - order_id unik => 1 order = 1 payment (model sederhana)
 */
export const orderPayments = pgTable(
  'order_payments',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),

    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),

    paymentId: varchar('payment_id', { length: 128 }).notNull(),

    paidAt: timestamp('paid_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('order_payments_payment_id_uq').on(t.paymentId),
    uniqueIndex('order_payments_order_id_uq').on(t.orderId),
    index('order_payments_order_id_idx').on(t.orderId),
  ],
);
