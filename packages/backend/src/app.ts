/**
 * Express uygulamasının kurulumu.
 *
 * Uygulama, sunucudan (server.ts) ayrı tutulur: testler portu dinlemeye
 * gerek kalmadan uygulamayı doğrudan ayağa kaldırabilir.
 */

import express, { type Express } from 'express';

import type { Env } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { createRateLimiter } from './lib/rateLimiter.js';
import type { ServiceClient } from './lib/supabase.js';
import { apiKeyAuth, type ApiKeyStore } from './middleware/apiKeyAuth.js';
import { requestContext } from './middleware/context.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { ordersRouter } from './routes/v1/orders.js';
import { productsRouter } from './routes/v1/products.js';

export interface AppDependencies {
  env: Env;
  logger: Logger;
  supabase: ServiceClient;
  apiKeyStore: ApiKeyStore;
}

export function createApp({ env, logger, supabase, apiKeyStore }: AppDependencies): Express {
  const app = express();

  // Ters vekil (reverse proxy) arkasında gerçek istemci IP'si için gerekli.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext(logger));
  app.use(securityHeaders);
  app.use(cors(env.CORS_ORIGINS));

  // 2 MB: 500 ürünlük bir besleme sayfası rahatça sığar, kötü niyetli
  // devasa gövdeler ise ayrıştırılmadan reddedilir.
  app.use(express.json({ limit: '2mb' }));

  // -------------------------------------------------------------------------
  // Sağlık kontrolü — kimlik doğrulama GEREKTİRMEZ.
  // Yük dengeleyicinin ve izleme sistemlerinin uç noktasıdır.
  // -------------------------------------------------------------------------
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'ohaaaa-vendor-api',
      version: '1.0.0',
      time: new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------------------
  // Korumalı taşeron API'si
  //
  // Sıra önemlidir: önce kimlik (kim?), sonra hız sınırı (anahtar başına).
  // `guard` /api/v1 altındaki HER uç noktaya uygulanır — /me dahil. Sağlık
  // kontrolü dışında sınırsız bir uç nokta bırakmak, kimlik doğrulama
  // maliyetini bedava bir DoS yüzeyine çevirir.
  // -------------------------------------------------------------------------
  const limiter = createRateLimiter();
  setInterval(() => limiter.prune(), 60_000).unref?.();

  const guard = [apiKeyAuth(apiKeyStore), rateLimit(limiter, env.RATE_LIMIT_CEILING)];

  /** Taşeronların entegrasyonu doğrulamak için çağırdığı ilk uç nokta. */
  app.get('/api/v1/me', ...guard, (req, res) => {
    const vendor = req.vendor!;
    res.json({
      data: {
        vendor_id: vendor.vendorId,
        vendor_slug: vendor.vendorSlug,
        vendor_name: vendor.vendorName,
        scopes: vendor.scopes,
        rate_limit_per_minute: vendor.rateLimitPerMinute,
      },
    });
  });

  app.use('/api/v1/products', ...guard, productsRouter(supabase));
  app.use('/api/v1/orders', ...guard, ordersRouter(supabase));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Bağımlılıksız temel güvenlik başlıkları (helmet'in kullandığımız alt kümesi). */
function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  // Bu bir JSON API'sidir; hiçbir kaynağı yüklemesine gerek yoktur.
  res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  next();
}

/**
 * CORS. Tarayıcıdan çağrılmayan bir API için gevşek bırakmak yaygın bir
 * hatadır; izinli origin listesi ortam değişkeninden gelir.
 */
function cors(originsConfig: string) {
  const allowAll = originsConfig.trim() === '*';
  const allowed = new Set(
    originsConfig
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== '' && origin !== '*'),
  );

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const origin = req.header('origin');

    if (origin && (allowAll || allowed.has(origin))) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type,x-api-key,authorization,x-request-id');
      res.setHeader('access-control-max-age', '86400');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
