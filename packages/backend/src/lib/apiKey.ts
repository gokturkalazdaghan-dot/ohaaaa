/**
 * API anahtarı üretimi ve doğrulaması.
 *
 * GÜVENLİK MODELİ
 * ---------------
 * Ham anahtar hiçbir yerde saklanmaz. Veritabanında yalnızca SHA-256 özeti
 * bulunur; anahtar tek seferliğine, oluşturulduğu anda gösterilir.
 *
 * Anahtar biçimi:  ohk_live_<16 hex>_<48 hex>
 *                  └── önek ──┘  └── gizli kısım ──┘
 *
 * Önek (prefix) veritabanında AYRICA saklanır ve benzersiz indekslidir.
 * Doğrulama böylece tüm tabloyu taramak yerine tek indeks araması yapar —
 * anahtar sayısı büyüdükçe sabit maliyette kalır.
 *
 * Neden SHA-256, bcrypt/argon2 değil?
 *   Parolalar düşük entropili olduğu için yavaş özet gerektirir. Burada
 *   gizli kısım 192 bit kriptografik rastgelelik taşır; kaba kuvvet zaten
 *   imkânsızdır. Yavaş özet ise her API isteğine gereksiz gecikme eklerdi.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PREFIX_BYTES = 8; // 16 hex karakter
const SECRET_BYTES = 24; // 48 hex karakter — 192 bit entropi

export interface GeneratedApiKey {
  /** Kullanıcıya BİR KEZ gösterilecek ham anahtar. */
  plaintext: string;
  /** Veritabanına yazılacak, aranabilir önek. */
  prefix: string;
  /** Veritabanına yazılacak SHA-256 özeti (hex). */
  hash: string;
  /** Panelde "•••• a1b2" göstermek için son 4 karakter. */
  lastFour: string;
}

export function generateApiKey(environment: 'live' | 'test' = 'live'): GeneratedApiKey {
  const prefixPart = randomBytes(PREFIX_BYTES).toString('hex');
  const secretPart = randomBytes(SECRET_BYTES).toString('hex');

  const prefix = `ohk_${environment}_${prefixPart}`;
  const plaintext = `${prefix}_${secretPart}`;

  return {
    plaintext,
    prefix,
    hash: hashApiKey(plaintext),
    lastFour: secretPart.slice(-4),
  };
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * Ham anahtardan aranabilir öneki çıkarır.
 * Biçim bozuksa null döner — bu durumda veritabanına hiç gidilmez.
 */
export function extractPrefix(plaintext: string): string | null {
  const parts = plaintext.split('_');
  if (parts.length !== 4) return null;

  const [scheme, environment, prefixPart, secretPart] = parts as [string, string, string, string];

  if (scheme !== 'ohk') return null;
  if (environment !== 'live' && environment !== 'test') return null;
  if (!/^[0-9a-f]{16}$/.test(prefixPart)) return null;
  if (!/^[0-9a-f]{48}$/.test(secretPart)) return null;

  return `${scheme}_${environment}_${prefixPart}`;
}

/**
 * Özetleri sabit zamanda karşılaştırır.
 *
 * Düz `===` karşılaştırması ilk farklı karakterde döner; saldırgan yanıt
 * süresini ölçerek doğru özeti karakter karakter türetebilir (timing attack).
 */
export function safeCompareHash(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  // timingSafeEqual farklı uzunlukta hata fırlatır; uzunluk zaten gizli değil.
  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}
