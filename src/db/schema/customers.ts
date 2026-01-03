import { pgTable, integer, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const customers = pgTable(
  'customers',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),

    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('customers_email_uq').on(t.email)],
);
