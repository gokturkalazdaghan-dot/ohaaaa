/**
 * İstek bağlamı (request context) tipleri ve istek kimliği.
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import type { ApiScope } from '@ohaaaa/shared';
import type { Logger } from '../lib/logger.js';

/** Doğrulanmış anahtardan türeyen, güvenilir kimlik bilgisi. */
export interface AuthenticatedVendor {
  vendorId: string;
  vendorSlug: string;
  vendorName: string;
  apiKeyId: string;
  scopes: ApiScope[];
  rateLimitPerMinute: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
      startedAt: number;
      /** apiKeyAuth middleware'i tarafından doldurulur. */
      vendor?: AuthenticatedVendor;
    }
  }
}

/**
 * Her isteğe izlenebilir bir kimlik ve o kimliği taşıyan bir log'çu iliştirir.
 * Taşeron bir sorunu bildirdiğinde `x-request-id` ile tek bir isteğin tüm
 * yaşam döngüsü loglardan çekilebilir.
 */
export function requestContext(baseLogger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('x-request-id');
    // Dışarıdan gelen kimliğe güvenilir ama sınırlandırılır: log enjeksiyonu
    // ve şişkin başlıkları önlemek için biçim ve uzunluk kontrol edilir.
    req.requestId =
      incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : randomUUID();

    req.startedAt = Date.now();
    req.log = baseLogger.child({ request_id: req.requestId });

    res.setHeader('x-request-id', req.requestId);
    next();
  };
}
