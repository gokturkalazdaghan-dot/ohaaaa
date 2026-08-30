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

// ---------------------------------------------------------------------------
// Yetkilendirme kararı
// ---------------------------------------------------------------------------
/**
 * Bir anahtar kaydının doğrulama için gereken alanları.
 *
 * Veritabanı satırının tamamı değil, KARARI ETKİLEYEN alanlar. Böylece karar
 * mantığı depodan bağımsız kalır ve gerçek bir veritabanı olmadan sınanabilir.
 */
export interface ApiKeyDecisionInput {
  /** İstemcinin sunduğu ham anahtar. */
  presented: string;
  /** Önekle bulunan kayıt; bulunamadıysa null. */
  record: {
    keyHash: string;
    scopes: string[];
    revokedAt: string | null;
    expiresAt: string | null;
    vendorStatus: string | null;
  } | null;
  /**
   * İstenen yetki.
   *
   * İsteğe bağlı: Express katmanı kimlik doğrulamayı ve yetki kontrolünü iki
   * ayrı middleware'de yapar (yetki route'a göre değişir). Verilmezse yetki
   * adımı atlanır, geri kalan tüm kontroller aynen uygulanır.
   */
  requiredScope?: string;
  /** Şimdi (test edilebilirlik için dışarıdan verilir). */
  now?: Date;
}

export type ApiKeyDecision =
  | { ok: true; scopes: string[] }
  | { ok: false; code: 'unauthorized' | 'forbidden'; reason: ApiKeyDenialReason };

export type ApiKeyDenialReason =
  | 'malformed'
  | 'not_found'
  | 'mismatch'
  | 'revoked'
  | 'expired'
  | 'vendor_pending'
  | 'vendor_not_approved'
  | 'missing_scope';

/**
 * Bir API isteğine izin verilip verilmeyeceğine karar verir.
 *
 * SAF FONKSİYON: ağ yok, saat okuması dışarıdan. Kimlik doğrulamanın tüm
 * güvenlik kararları burada toplandığı için hepsi testlenebilir — bu kod
 * yolu paranın geçtiği yol ve daha önce hiç testi yoktu.
 *
 * SIRA ÖNEMLİ: özet karşılaştırması, kayıt BULUNAMASA BİLE yapılır. Aksi
 * hâlde "önek yok" hızlı, "önek var ama gizli kısım yanlış" yavaş dönerdi;
 * saldırgan yanıt süresini ölçerek geçerli önekleri ayıklayabilirdi.
 */
export function decideApiKeyAccess(input: ApiKeyDecisionInput): ApiKeyDecision {
  const now = input.now ?? new Date();

  if (extractPrefix(input.presented) === null) {
    return { ok: false, code: 'unauthorized', reason: 'malformed' };
  }

  // Kayıt yoksa kukla bir özetle karşılaştırılır: zamanlama farkı oluşmasın.
  const expectedHash = input.record?.keyHash ?? DUMMY_HASH;
  const matches = safeCompareHash(hashApiKey(input.presented), expectedHash);

  if (!input.record) {
    return { ok: false, code: 'unauthorized', reason: 'not_found' };
  }

  if (!matches) {
    return { ok: false, code: 'unauthorized', reason: 'mismatch' };
  }

  if (input.record.revokedAt !== null) {
    return { ok: false, code: 'unauthorized', reason: 'revoked' };
  }

  if (
    input.record.expiresAt !== null &&
    new Date(input.record.expiresAt).getTime() <= now.getTime()
  ) {
    return { ok: false, code: 'unauthorized', reason: 'expired' };
  }

  // Askıya alınmış ya da henüz onaylanmamış bir mağazanın anahtarı geçerli
  // olsa bile iş göremez: onay durumu anahtardan bağımsız bir kapıdır.
  //
  // "Bekliyor" ile "aktif değil" AYRILIR. Anahtarın sahibi zaten o mağazadır,
  // yani kendi durumunu bilmeye hakkı var; sızıntı değil. Ayrım pratik bir
  // fark yaratır: başvurusu bekleyen satıcının yapacağı şey beklemek,
  // askıya alınmışın yapacağı şey bize ulaşmaktır.
  if (input.record.vendorStatus === 'pending') {
    return { ok: false, code: 'forbidden', reason: 'vendor_pending' };
  }

  if (input.record.vendorStatus !== 'approved') {
    return { ok: false, code: 'forbidden', reason: 'vendor_not_approved' };
  }

  if (input.requiredScope !== undefined && !input.record.scopes.includes(input.requiredScope)) {
    return { ok: false, code: 'forbidden', reason: 'missing_scope' };
  }

  return { ok: true, scopes: input.record.scopes };
}

/**
 * Var olmayan anahtarlarda karşılaştırma yapmak için kullanılan kukla özet.
 * Değeri önemsiz; önemli olan HER YOLDA bir karşılaştırma yapılması.
 */
const DUMMY_HASH = hashApiKey('ohaaaa-nonexistent-key-placeholder');
