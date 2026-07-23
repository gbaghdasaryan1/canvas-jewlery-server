import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS settings for the browser clients.
 *
 * Two entries here fail *invisibly* if removed — the browser reports an opaque
 * error and the server logs nothing — so both are covered by tests:
 *
 * - `PATCH` in `methods`: without it the admin dashboard's status control dies
 *   at the preflight.
 * - `DELETE` in `methods`: without it deleting an order dies the same way.
 * - `Content-Disposition` in `exposedHeaders`: it is not a CORS-safelisted
 *   response header, so without it the dashboard cannot read the STL filename
 *   and silently saves every download as `<order-id>.stl`.
 */
export function buildCorsOptions(rawOrigin: string | undefined): CorsOptions {
  const origins = (rawOrigin ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    // An unset CORS_ORIGIN allows any origin — convenient in dev, and the staff
    // endpoints are still guarded by the API key.
    origin: origins.length > 0 ? origins : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
    exposedHeaders: ['Content-Disposition'],
  };
}
