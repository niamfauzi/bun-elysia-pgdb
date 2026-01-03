import { ProductRepository, type ProductRow } from "./product.repository";
import { badRequest, notFound } from "../../shared/http/errors";

export type ProductDTO = {
  id: number;
  name: string;
  priceCents: number;
  stock: number;
  createdAt: string | null;
  updatedAt: string | null;
};

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return String(v);
}

export class ProductService {
  constructor(private readonly repo: ProductRepository) {}

  toDTO(row: ProductRow): ProductDTO {
    return {
      id: row.id,
      name: row.name,
      priceCents: row.priceCents,
      stock: row.stock,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async create(input: { name: string; priceCents: number; stock: number }): Promise<ProductDTO> {
    const name = input.name.trim();
    if (!name) throw badRequest("name is required");

    const row = await this.repo.create({
      name,
      priceCents: input.priceCents,
      stock: input.stock,
    });

    return this.toDTO(row);
  }

  async getById(id: number): Promise<ProductDTO> {
    const row = await this.repo.findById(id);
    if (!row) throw notFound("product not found", { id });
    return this.toDTO(row);
  }

  async list(params: { limit: number; offset: number }) {
    const { items, total } = await this.repo.listWithCount(params);
    return {
      data: items.map((r) => this.toDTO(r)),
      meta: { limit: params.limit, offset: params.offset, count: total },
    };
  }

  async patchById(
    id: number,
    patch: { name?: string; priceCents?: number; stock?: number }
  ): Promise<ProductDTO> {
    // business-level normalization
    if (patch.name !== undefined) {
      patch.name = patch.name.trim();
      if (!patch.name) throw badRequest("name cannot be empty");
    }

    const row = await this.repo.updateById(id, patch);
    if (!row) throw notFound("product not found", { id });

    return this.toDTO(row);
  }

  async deleteById(id: number) {
    const deleted = await this.repo.deleteById(id);
    if (!deleted) throw notFound("product not found", { id });
    return { id, deleted: true };
  }
}
