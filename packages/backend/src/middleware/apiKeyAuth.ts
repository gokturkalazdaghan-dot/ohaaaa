/**
 * Taşeron API anahtarı doğrulama katmanı.
 *
 * Akış:
 *   1. `x-api-key` başlığını oku (yoksa `Authorization: Bearer ohk_...` kabul et)
 *   2. Anahtarın BİÇİMİNİ doğrula → bozuksa veritabanına hiç gitme
 *   3. Öneki (prefix) indeksli aramayla bul → tek satır
 *   4. SHA-256 özetini SABİT ZAMANDA karşılaştır
 *   5. İptal/süre/taşeron durumu kontrolleri
 *   6. req.vendor'ı doldur
 *
 * Zamanlama sızıntısına karşı: bulunamayan anahtarda da sahte bir
 * karşılaştırma yapılır, böylece "anahtar yok" ile "anahtar yanlış"
 * yanıt süreleri ayrışmaz.
 */

import type { NextFunction, Request, Response } from 'express';

import type { ApiScope } from '@ohaaaa/shared';

import { extractPrefix, hashApiKey, safeCompareHash } from '@ohaaaa/shared/api-key';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { AuthenticatedVendor } from './context.js';

/** Anahtar aramasının döndürdüğü ham kayıt. */
export interface ApiKeyRecord {
  id: string;
  vendor_id: string;
  key_hash: string;
  scopes: string[];
  rate_limit_per_minute: number;
  revoked_at: string | null;
  expires_at: string | null;
  vendor: {
    id: string;
    slug: string;
    display_name: string;
    status: string;
  } | null;
}

/**
 * Anahtar deposu soyutlaması.
 * Middleware'in Supabase'e doğrudan bağlanmaması, birim testlerde gerçek
 * bir veritabanı olmadan tüm güvenlik yollarının denenebilmesini sağlar.
 */
export interface ApiKeyStore {
  findByPrefix(prefix: string): Promise<ApiKeyRecord | null>;
  /** Son kullanım bilgisini günceller. Hataları isteği düşürmemelidir. */
  touch(apiKeyId: string, ip: string | null): Promise<void>;
}

/** Var olmayan anahtarlarda karşılaştırma yapmak için kullanılan kukla özet. */
const DUMMY_HASH = hashApiKey('ohaaaa-nonexistent-key-placeholder');

export function apiKeyAuth(store: ApiKeyStore) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const presented = readKeyFromRequest(req);

      if (!presented) {
        throw unauthorized(
          "API anahtarı bulunamadı. İsteğinize 'x-api-key' başlığını ekleyin.",
        );
      }

      const prefix = extractPrefix(presented);

      if (!prefix) {
        // Biçim bozuksa veritabanına gitmeye gerek yok — ucuz erken çıkış.
        throw unauthorized('API anahtarının biçimi geçersiz.');
      }

      const record = await store.findByPrefix(prefix);

      // Kayıt yoksa bile karşılaştırma yapılır: zamanlama farkı oluşmasın.
      const expectedHash = record?.key_hash ?? DUMMY_HASH;
      const matches = safeCompareHash(hashApiKey(presented), expectedHash);

      if (!record || !matches) {
        throw unauthorized('API anahtarı geçersiz.');
      }

      if (record.revoked_at !== null) {
        throw unauthorized('Bu API anahtarı iptal edilmiş.');
      }

      if (record.expires_at !== null && new Date(record.expires_at).getTime() <= Date.now()) {
        throw unauthorized('Bu API anahtarının süresi dolmuş.');
      }

      if (!record.vendor) {
        throw unauthorized('Anahtara bağlı taşeron kaydı bulunamadı.');
      }

      if (record.vendor.status !== 'approved') {
        throw forbidden(
          record.vendor.status === 'pending'
            ? 'Taşeron başvurunuz henüz onaylanmadı.'
            : 'Taşeron hesabınız aktif değil.',
        );
      }

      const vendor: AuthenticatedVendor = {
        vendorId: record.vendor_id,
        vendorSlug: record.vendor.slug,
        vendorName: record.vendor.display_name,
        apiKeyId: record.id,
        scopes: record.scopes as ApiScope[],
        rateLimitPerMinute: record.rate_limit_per_minute,
      };

      req.vendor = vendor;
      req.log = req.log.child({ vendor_id: vendor.vendorId, api_key_id: vendor.apiKeyId });

      // Son kullanım kaydı isteği bekletmemeli: hata olsa bile akış sürer.
      void store.touch(record.id, req.ip ?? null).catch((error: unknown) => {
        req.log.warn('API anahtarı son kullanım bilgisi güncellenemedi', {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Belirtilen yetkiyi (scope) zorunlu kılar.
 * apiKeyAuth'tan SONRA kullanılmalıdır.
 */
export function requireScope(scope: ApiScope) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.vendor) {
      next(unauthorized());
      return;
    }

    if (!req.vendor.scopes.includes(scope)) {
      next(
        forbidden(
          `Bu işlem '${scope}' yetkisi gerektiriyor. Anahtarınızın yetkileri: ` +
            `${req.vendor.scopes.join(', ') || '(yok)'}`,
        ),
      );
      return;
    }

    next();
  };
}

function readKeyFromRequest(req: Request): string | null {
  const headerKey = req.header('x-api-key');
  if (headerKey && headerKey.trim() !== '') return headerKey.trim();

  const authorization = req.header('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    if (token !== '') return token;
  }

  return null;
}
