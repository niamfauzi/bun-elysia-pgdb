import { Elysia } from 'elysia';
import { db } from '../../db';
import { CustomerRepository } from './customer.repository';
import { CustomerService } from './customer.service';
import {
  CreateCustomerBody,
  CreateCustomerResponse,
  CustomerIdParams,
  DeleteCustomerResponse,
  GetCustomerResponse,
  ListCustomersQuery,
  ListCustomersResponse,
  PatchCustomerBody,
  PatchCustomerResponse,
} from './customer.schema';

const repo = new CustomerRepository(db);
const service = new CustomerService(repo);

export const customersModule = new Elysia({ name: 'customers-module' })
  .post(
    '/customers',
    async ({ body, set }) => {
      const created = await service.create(body);
      set.status = 201;
      return { data: created };
    },
    { body: CreateCustomerBody, response: { 201: CreateCustomerResponse } },
  )
  .get(
    '/customers',
    async ({ query }) => {
      const limit = query.limit ?? 20;
      const offset = query.offset ?? 0;
      return service.list({ limit, offset });
    },
    { query: ListCustomersQuery, response: { 200: ListCustomersResponse } },
  )
  .get('/customers/:id', async ({ params }) => ({ data: await service.getById(params.id) }), {
    params: CustomerIdParams,
    response: { 200: GetCustomerResponse },
  })
  .patch(
    '/customers/:id',
    async ({ params, body }) => ({ data: await service.patchById(params.id, body) }),
    { params: CustomerIdParams, body: PatchCustomerBody, response: { 200: PatchCustomerResponse } },
  )
  .delete('/customers/:id', async ({ params }) => ({ data: await service.deleteById(params.id) }), {
    params: CustomerIdParams,
    response: { 200: DeleteCustomerResponse },
  });
