/**
 * Zod tabanlı gövde/sorgu doğrulama yardımcıları.
 *
 * Doğrulanmış veriyi `req.body`/`req.query` üzerine YAZAR; böylece route
 * gövdesinde tip güvenliği vardır ve şemada tanımsız alanlar (strict şemalar
 * sayesinde) hiç ilerlemez.
 */

import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

import { validationFailed } from '../lib/errors.js';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(
        validationFailed(
          'İstek gövdesi doğrulanamadı.',
          result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        ),
      );
      return;
    }

    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      next(
        validationFailed(
          'Sorgu parametreleri doğrulanamadı.',
          result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        ),
      );
      return;
    }

    // Express 5'te req.query salt-okunur bir getter'dır; yeniden tanımlanır.
    Object.defineProperty(req, 'query', { value: result.data, configurable: true });
    next();
  };
}
