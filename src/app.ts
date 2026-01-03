import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';

import { db } from './db';
import { requestContext } from './shared/logging/requestContext';
import { errorHandler } from './shared/http/error-handler';

import { productsModule } from './modules/products';
import { ordersModule } from './modules/orders';
import { customersModule } from './modules/customers';

export function createApp() {
  const app = new Elysia({ name: 'order-service' }).use(requestContext).use(errorHandler);

  app.get(
    '/healthz',
    async () => {
      // DB ping (optional tapi berguna)
      try {
        await db.execute(sql`select 1 as ok`);
        return { ok: true, db: 'up' as const };
      } catch {
        return { ok: false, db: 'down' as const };
      }
    },
    {
      response: {
        200: t.Object({
          ok: t.Boolean(),
          db: t.Union([t.Literal('up'), t.Literal('down')]),
        }),
      },
    },
  );

  app.get('/boom', () => {
    throw new Error('boom');
  });

  app.use(productsModule);
  app.use(customersModule);
  app.use(ordersModule);

  return app;
}
