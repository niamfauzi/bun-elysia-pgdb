import { Elysia } from 'elysia';
import { db } from '../../db';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';
import {
  CreateOrderBody,
  CreateOrderResponse,
  OrderIdParams,
  PayOrderBody,
  PayOrderResponse,
  GetOrderDetailResponse,
  ListOrdersQuery,
  ListOrdersResponse,
  ListOrdersCursorQuery,
  ListOrdersCursorResponse,
  CancelOrderResponse,
} from './order.schema';

// ✅ add
import { rateLimit } from '../../shared/rate-limit';
import { getRateLimitStore } from '../../infra/rateLimitStore';

const repo = new OrderRepository(db);
const service = new OrderService(repo);

// ✅ semua POST orders kena limit 3 req / 10 detik
const ordersPostRoutes = new Elysia({ name: 'orders-post-routes' })
  .use(
    rateLimit({
      store: getRateLimitStore(),
      limit: 3,
      windowMs: 10_000,
      prefix: 'rl:orders:post',
    }),
  )
  .post(
    '/orders',
    async ({ body, set }) => {
      const created = await service.createOrder(body);
      set.status = 201;
      return { data: created };
    },
    { body: CreateOrderBody, response: { 201: CreateOrderResponse } },
  )
  .post(
    '/orders/:id/cancel',
    async ({ params }) => ({ data: await service.cancelOrder(params.id) }),
    { params: OrderIdParams, response: { 200: CancelOrderResponse } },
  )
  .post(
    '/orders/:id/pay',
    async ({ params, body }) => ({ data: await service.payOrder(params.id, body) }),
    { params: OrderIdParams, body: PayOrderBody, response: { 200: PayOrderResponse } },
  );

export const ordersModule = new Elysia({ name: 'orders-module' })
  .use(ordersPostRoutes)

  .get(
    '/orders',
    async ({ query }) => {
      const limit = query.limit ?? 20;
      const offset = query.offset ?? 0;

      return service.listOrdersOffset({
        limit,
        offset,
        customerId: query.customerId,
        status: query.status,
        createdAtFrom: query.createdAtFrom,
        createdAtTo: query.createdAtTo,
        includeItems: query.includeItems,
      });
    },
    { query: ListOrdersQuery, response: { 200: ListOrdersResponse } },
  )

  .get(
    '/orders/cursor',
    async ({ query }) => {
      const limit = query.limit ?? 20;

      return service.listOrdersCursor({
        limit,
        cursor: query.cursor,
        customerId: query.customerId,
        status: query.status,
        createdAtFrom: query.createdAtFrom,
        createdAtTo: query.createdAtTo,
        includeItems: query.includeItems,
      });
    },
    { query: ListOrdersCursorQuery, response: { 200: ListOrdersCursorResponse } },
  )

  .get(
    '/orders/:id/query',
    async ({ params }) => ({ data: await service.getOrderDetailQueryApi(params.id) }),
    { params: OrderIdParams, response: { 200: GetOrderDetailResponse } },
  )

  .get('/orders/:id', async ({ params }) => ({ data: await service.getOrderDetail(params.id) }), {
    params: OrderIdParams,
    response: { 200: GetOrderDetailResponse },
  });
