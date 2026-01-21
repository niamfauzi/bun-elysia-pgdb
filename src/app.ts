import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';

import { db } from './db';
import { requestContext } from './shared/logging/requestContext';
import { errorHandler } from './shared/http/error-handler';

import { appModules } from './modules';
import { getRedis, closeRedis } from './infra/redis';

export function createApp() {
  const app = new Elysia({ name: 'order-service' }).use(requestContext).use(errorHandler);

  app.get(
    '/healthz',
    async () => {
      // DB ping
      const dbUp = await (async () => {
        try {
          await db.execute(sql`select 1 as ok`);
          return true;
        } catch {
          return false;
        }
      })();

      // Redis ping (optional)
      const redisClient = getRedis();
      const redisStatus = await (async () => {
        if (!redisClient) return 'disabled' as const;

        try {
          const pong = await redisClient.ping();
          return pong === 'PONG' ? ('up' as const) : ('down' as const);
        } catch {
          return 'down' as const;
        }
      })();

      const ok = dbUp && (redisStatus === 'up' || redisStatus === 'disabled');

      return {
        ok,
        db: dbUp ? ('up' as const) : ('down' as const),
        redis: redisStatus,
      };
    },
    {
      response: {
        200: t.Object({
          ok: t.Boolean(),
          db: t.Union([t.Literal('up'), t.Literal('down')]),
          redis: t.Union([t.Literal('up'), t.Literal('down'), t.Literal('disabled')]),
        }),
      },
    },
  );

  app.get('/boom', () => {
    throw new Error('boom');
  });

  app.use(appModules);

  // graceful shutdown
  app.onStop(async () => {
    await closeRedis();
  });

  return app;
}
