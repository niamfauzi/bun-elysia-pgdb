import { asc, eq, sql } from 'drizzle-orm';
import type { DbClient } from '../../db';
import { customers } from '../../db/schema';

export type CustomerRow = typeof customers.$inferSelect;

export type CreateCustomerInput = Pick<typeof customers.$inferInsert, 'name' | 'email'>;

export type UpdateCustomerInput = Partial<Pick<typeof customers.$inferInsert, 'name' | 'email'>>;

export type ListCustomersParams = { limit: number; offset: number };
export type ListCustomersResult = { items: CustomerRow[]; total: number };

export class CustomerRepository {
  constructor(private readonly dbc: DbClient) {}

  async create(input: CreateCustomerInput): Promise<CustomerRow> {
    const [row] = await this.dbc.insert(customers).values(input).returning();
    return row!;
  }

  async findById(id: number): Promise<CustomerRow | null> {
    const [row] = await this.dbc.select().from(customers).where(eq(customers.id, id)).limit(1);
    return row ?? null;
  }

  async list(params: ListCustomersParams): Promise<CustomerRow[]> {
    return this.dbc
      .select()
      .from(customers)
      .orderBy(asc(customers.id))
      .limit(params.limit)
      .offset(params.offset);
  }

  async countAll(): Promise<number> {
    const [row] = await this.dbc.select({ count: sql<number>`count(*)::int` }).from(customers);

    return row?.count ?? 0;
  }

  async listWithCount(params: ListCustomersParams): Promise<ListCustomersResult> {
    const [items, total] = await Promise.all([this.list(params), this.countAll()]);
    return { items, total };
  }

  async updateById(id: number, patch: UpdateCustomerInput): Promise<CustomerRow | null> {
    if (Object.keys(patch).length === 0) return this.findById(id);

    const [row] = await this.dbc
      .update(customers)
      .set(patch)
      .where(eq(customers.id, id))
      .returning();

    return row ?? null;
  }

  async deleteById(id: number): Promise<boolean> {
    const [row] = await this.dbc
      .delete(customers)
      .where(eq(customers.id, id))
      .returning({ id: customers.id });

    return !!row;
  }
}
