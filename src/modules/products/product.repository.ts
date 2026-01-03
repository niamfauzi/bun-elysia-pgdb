import { asc, eq, sql } from "drizzle-orm";
import type { DbClient } from "../../db";
import { products } from "../../db/schema";

export type ProductRow = typeof products.$inferSelect;

export type CreateProductInput = Pick<
  typeof products.$inferInsert,
  "name" | "priceCents" | "stock"
>;

export type UpdateProductInput = Partial<
  Pick<typeof products.$inferInsert, "name" | "priceCents" | "stock">
>;

export type ListProductsParams = {
  limit: number;
  offset: number;
};

export type ListProductsResult = {
  items: ProductRow[];
  total: number;
};

export class ProductRepository {
  constructor(private readonly dbc: DbClient) {}

  async create(input: CreateProductInput): Promise<ProductRow> {
    const [row] = await this.dbc.insert(products).values(input).returning();
    return row!;
  }

  async findById(id: number): Promise<ProductRow | null> {
    const [row] = await this.dbc
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    return row ?? null;
  }

  async list(params: ListProductsParams): Promise<ProductRow[]> {
    return this.dbc
      .select()
      .from(products)
      .orderBy(asc(products.id))
      .limit(params.limit)
      .offset(params.offset);
  }

  async countAll(): Promise<number> {
    const [row] = await this.dbc
      .select({ count: sql<number>`count(*)::int` })
      .from(products);

    return row?.count ?? 0;
  }

  async listWithCount(params: ListProductsParams): Promise<ListProductsResult> {
    const [items, total] = await Promise.all([
      this.list(params),
      this.countAll(),
    ]);
    return { items, total };
  }

  async updateById(id: number, patch: UpdateProductInput): Promise<ProductRow | null> {
    if (Object.keys(patch).length === 0) return this.findById(id);

    const [row] = await this.dbc
      .update(products)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(products.id, id))
      .returning();

    return row ?? null;
  }

  async deleteById(id: number): Promise<boolean> {
    const [row] = await this.dbc
      .delete(products)
      .where(eq(products.id, id))
      .returning({ id: products.id });

    return !!row;
  }
}