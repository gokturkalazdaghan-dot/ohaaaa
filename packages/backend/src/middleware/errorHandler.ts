/**
 * Merkezî hata yakalayıcı ve 404 üreteci.
 *
 * Beklenmeyen hatalarda istemciye ASLA yığın izi (stack trace) veya
 * veritabanı mesajı sızdırılmaz — bunlar yalnızca loglara yazılır.
 * İstemci, destek talebinde kullanabileceği `request_id`'yi alır.
 */

import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { ApiError } from '../lib/errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: `Uç nokta bulunamadı: ${req.method} ${req.path}`,
      request_id: req.requestId,
    },
  });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // Express, 4 parametreli fonksiyonu hata yakalayıcı olarak tanır;
  // `next` kullanılmasa bile imzada kalmalıdır.
  _next: NextFunction,
): void {
  const durationMs = Date.now() - req.startedAt;

  if (error instanceof ApiError) {
    // Beklenen hatalar gürültü yapmasın: sunucu hatası değilse info seviyesi.
    const level = error.status >= 500 ? 'error' : 'info';
    req.log[level]('İstek reddedildi', {
      code: error.code,
      status: error.status,
      duration_ms: durationMs,
    });

    res.status(error.status).json(error.toJSON(req.requestId));
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'Gönderilen veri doğrulanamadı.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
        request_id: req.requestId,
      },
    });
    return;
  }

  // Buraya düşen her şey beklenmeyen bir hatadır.
  req.log.error('İşlenmeyen hata', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    duration_ms: durationMs,
  });

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Beklenmeyen bir hata oluştu. Sorun sürerse istek kimliğiyle bize ulaşın.',
      request_id: req.requestId,
    },
  });
}
