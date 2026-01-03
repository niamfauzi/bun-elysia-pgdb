import { badRequest, notFound } from '../../shared/http/errors';
import type { CustomerRepository, CustomerRow } from './customer.repository';

export type CustomerDTO = {
  id: number;
  name: string;
  email: string;
  createdAt: string | null;
};

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return String(v);
}

export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  toDTO(row: CustomerRow): CustomerDTO {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: toIso(row.createdAt),
    };
  }

  async create(input: { name: string; email: string }): Promise<CustomerDTO> {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();

    if (!name) throw badRequest('name is required');
    if (!email) throw badRequest('email is required');

    const row = await this.repo.create({ name, email });
    return this.toDTO(row);
  }

  async getById(id: number): Promise<CustomerDTO> {
    const row = await this.repo.findById(id);
    if (!row) throw notFound('customer not found', { id });
    return this.toDTO(row);
  }

  async list(params: { limit: number; offset: number }) {
    const { items, total } = await this.repo.listWithCount(params);
    return {
      data: items.map((r) => this.toDTO(r)),
      meta: { limit: params.limit, offset: params.offset, count: total },
    };
  }

  async patchById(id: number, patch: { name?: string; email?: string }): Promise<CustomerDTO> {
    if (patch.name !== undefined) {
      patch.name = patch.name.trim();
      if (!patch.name) throw badRequest('name cannot be empty');
    }
    if (patch.email !== undefined) {
      patch.email = patch.email.trim().toLowerCase();
      if (!patch.email) throw badRequest('email cannot be empty');
    }

    const row = await this.repo.updateById(id, patch);
    if (!row) throw notFound('customer not found', { id });
    return this.toDTO(row);
  }

  async deleteById(id: number) {
    const deleted = await this.repo.deleteById(id);
    if (!deleted) throw notFound('customer not found', { id });
    return { id, deleted: true };
  }
}
