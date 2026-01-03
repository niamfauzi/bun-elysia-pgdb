import { pgTable, integer, varchar, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const products = pgTable(
  'products',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),

    name: varchar({ length: 255 }).notNull(),
    priceCents: integer('price_cents').notNull(),
    stock: integer().notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('products_name_idx').on(t.name),
    check('products_price_cents_ck', sql`${t.priceCents} >= 0`),
    check('products_stock_ck', sql`${t.stock} >= 0`),
  ],
);
