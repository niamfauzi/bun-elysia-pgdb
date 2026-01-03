import { pgTable, integer, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { customers } from '../customers';
import { orderStatus } from '../enums';

/**
 * Anti-circular rule:
 * - orders layer boleh import customers + enums.
 * - customers/products JANGAN import apapun dari orders/.
 */
export const orders = pgTable(
  'orders',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),

    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),

    status: orderStatus().notNull().default('PENDING'),

    totalAmountCents: integer('total_amount_cents').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('orders_customer_id_idx').on(t.customerId),
    index('orders_status_idx').on(t.status),
    check('orders_total_amount_ck', sql`${t.totalAmountCents} >= 0`),
  ],
);
