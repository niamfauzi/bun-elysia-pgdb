import { Elysia } from 'elysia';
import { env } from '../../config/env';
import { logger } from './logger';
import { initRequestMeta, getRequestMeta } from './requestMeta';

function getPath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export const requestContext = new Elysia({ name: 'request-context' })
  .onRequest(({ request, set }) => {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();

    set.headers['x-request-id'] = requestId;
    initRequestMeta(request, requestId);

    if (env.NODE_ENV !== 'production') {
      logger.info(
        { requestId, method: request.method, path: getPath(request.url) },
        'request_start',
      );
    }
  })

  // penting: export derive ke parent instance juga
  .derive({ as: 'scoped' }, ({ request, set }) => {
    const meta = getRequestMeta(request);
    return {
      requestId:
        meta?.requestId ??
        set.headers['x-request-id'] ??
        request.headers.get('x-request-id') ??
        crypto.randomUUID(),
    };
  })

  // penting: export hook end-log ke parent instance
  .onAfterHandle({ as: 'scoped' }, ({ request, set, requestId }) => {
    const meta = getRequestMeta(request);
    const responseTimeMs = meta ? Math.round(performance.now() - meta.startAt) : undefined;

    if (env.NODE_ENV !== 'production') {
      logger.info(
        {
          requestId,
          method: request.method,
          path: getPath(request.url),
          status: set.status,
          responseTimeMs,
        },
        'request_end',
      );
    } else {
      logger.info(
        {
          requestId,
          method: request.method,
          path: getPath(request.url),
          status: set.status,
          responseTimeMs,
        },
        'access',
      );
    }
  });
