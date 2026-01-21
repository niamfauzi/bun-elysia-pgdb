import { Elysia } from 'elysia';

import { productsModule } from './products';
import { customersModule } from './customers';
import { ordersModule } from './orders';

// ✅ add
import { rateLimit } from '../shared/rate-limit';
import { getRateLimitStore } from '../infra/rateLimitStore';

// daftar module di 1 tempat (explicit, gampang maintain)
const modules = [
  productsModule,
  customersModule,
  ordersModule,
  //   ...(env.NODE_ENV !== "production" ? [devModule] : []),
] as const;

// mount semua module sekali
export const appModules = (() => {
  const app = new Elysia({ name: 'app-modules' });
  console.log('[BOOT] appModules building');
  // Global limit (contoh): 100 req / 60 detik per IP
  // ✅ global rate limit
  app.use(
    rateLimit({
      store: getRateLimitStore(),
      limit: 10,
      windowMs: 60_000,
      prefix: 'rl:global',
    }),
  );

  for (const m of modules) app.use(m);

  return app;
})();
