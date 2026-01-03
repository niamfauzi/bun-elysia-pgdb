import { Elysia } from 'elysia';
import { AppError } from './errors';
import { env } from '../../config/env';
import { logger } from '../logging/logger';
import { getRequestMeta } from '../logging/requestMeta';
import { formatValidationDetails } from './validation';

function getPath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export const errorHandler = new Elysia({ name: 'error-handler' }).onError(
  { as: 'global' }, // ✅ penting: export lifecycle ke semua instance (parent/current/descendants)
  (ctx) => {
    const { code, error, set, request } = ctx;

    const meta = getRequestMeta(request);
    const requestId =
      meta?.requestId ??
      set.headers['x-request-id'] ??
      request.headers.get('x-request-id') ??
      crypto.randomUUID();

    set.headers['x-request-id'] = requestId;

    const responseTimeMs = meta ? Math.round(performance.now() - meta.startAt) : undefined;
    const path = getPath(request.url);

    const logEnd = (level: 'info' | 'warn' | 'error', status: number, err?: unknown) => {
      const msg = env.NODE_ENV !== 'production' ? 'request_end' : 'access';
      (logger as any)[level](
        {
          requestId,
          method: request.method,
          path,
          status,
          responseTimeMs,
          ...(err ? { err } : {}),
        },
        msg,
      );
    };

    if (error instanceof AppError) {
      set.status = error.status;
      const lvl = error.status >= 500 ? 'error' : error.status >= 400 ? 'warn' : 'info';
      logEnd(lvl as any, error.status, env.NODE_ENV !== 'production' ? error : undefined);
      return {
        error: { code: error.code, message: error.message, details: error.details },
        requestId,
      };
    }

    if (code === 'NOT_FOUND') {
      set.status = 404;
      logEnd('info', 404);
      return { error: { code: 'NOT_FOUND', message: 'Route not found' }, requestId };
    }

    if (code === 'VALIDATION') {
      set.status = 400;

      const details = formatValidationDetails(error);
      // log: dev boleh simpan raw error untuk debugging, prod cukup ringkas
      logEnd('warn', 400, env.NODE_ENV !== 'production' ? error : details);

      return {
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details },
        requestId,
      };
    }

    set.status = 500;
    logEnd('error', 500, error);
    return { error: { code: 'INTERNAL', message: 'Internal server error' }, requestId };
  },
);
