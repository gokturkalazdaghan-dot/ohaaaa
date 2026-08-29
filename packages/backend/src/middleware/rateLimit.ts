/**
 * Anahtar başına hız sınırı.
 *
 * Sınır, anahtarın kendi `rate_limit_per_minute` değeridir; böylece yüksek
 * hacimli taşeronlara tekil olarak daha geniş tavan tanımlanabilir.
 * Ortam değişkenindeki tavan (RATE_LIMIT_CEILING) mutlak üst sınırdır.
 */

import type { NextFunction, Request, Response } from 'express';

import { ApiError } from '../lib/errors.js';
import type { RateLimiter } from '../lib/rateLimiter.js';

export function rateLimit(limiter: RateLimiter, ceiling: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Kimlik doğrulanmamışsa sınırlayacak bir anahtar da yoktur.
    if (!req.vendor) {
      next();
      return;
    }

    const limit = Math.min(req.vendor.rateLimitPerMinute, ceiling);
    const result = limiter.check(req.vendor.apiKeyId, limit);

    // Standart başlıklar: taşeronlar kendi hızlarını buna göre ayarlar.
    res.setHeader('x-ratelimit-limit', String(result.limit));
    res.setHeader('x-ratelimit-remaining', String(result.remaining));
    res.setHeader('x-ratelimit-reset', String(result.resetAt));

    if (!result.allowed) {
      const retryAfter = Math.max(1, result.resetAt - Math.floor(Date.now() / 1000));
      res.setHeader('retry-after', String(retryAfter));

      req.log.warn('Hız sınırı aşıldı', { limit: result.limit, retry_after: retryAfter });

      next(
        new ApiError(
          'rate_limited',
          `Dakikalık istek sınırı aşıldı (${result.limit}/dk). ` +
            `${retryAfter} saniye sonra tekrar deneyin.`,
          { retry_after_seconds: retryAfter },
        ),
      );
      return;
    }

    next();
  };
}
