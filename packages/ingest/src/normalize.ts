/**
 * Ham feed kaydını doğrulanmış tekliflere çevirir.
 *
 * Buradaki tek kural şudur: ŞÜPHELİ VERİ ALINMAZ. Bozuk bir kayıt sessizce
 * "0 TL" veya "stokta yok" olarak geçerse, fiyat karşılaştırma motoru yanlış
 * bir "en ucuz" gösterir ve kullanıcı güveni bir daha geri gelmez. Atlanan
 * kayıt görünürdür (ingest_runs.sample_errors); bozuk kayıt görünmez.
 */

import { parseMoneyToCents } from '@ohaaaa/shared';

import type { FieldMapping, NormalizedOffer, RawRecord } from './types.js';

export interface NormalizeResult {
  offers: NormalizedOffer[];
  errors: Array<{ externalId: string | null; reason: string }>;
}

/** Fiyatın makul üst sınırı (10 milyon TL). Üstü neredeyse daima veri hatasıdır. */
const MAX_PRICE_CENTS = 1_000_000_000;

export function normalizeRecords(
  records: RawRecord[],
  mapping: FieldMapping,
  options: { defaultCurrency: string; allowedHosts: string[] },
): NormalizeResult {
  const offers: NormalizedOffer[] = [];
  const errors: NormalizeResult['errors'] = [];

  // Aynı feed'de tekrar eden external_id, upsert sırasında "ON CONFLICT
  // DO UPDATE command cannot affect row a second time" hatası verir.
  const seen = new Set<string>();

  for (const record of records) {
    const externalId = read(record, mapping.external_id)?.trim() ?? null;

    if (!externalId) {
      errors.push({ externalId: null, reason: 'external_id boş' });
      continue;
    }

    if (seen.has(externalId)) {
      errors.push({ externalId, reason: 'feed içinde mükerrer external_id' });
      continue;
    }

    const offer = normalizeOne(record, mapping, options, externalId);

    if ('reason' in offer) {
      errors.push({ externalId, reason: offer.reason });
      continue;
    }

    seen.add(externalId);
    offers.push(offer);
  }

  return { offers, errors };
}

function normalizeOne(
  record: RawRecord,
  mapping: FieldMapping,
  options: { defaultCurrency: string; allowedHosts: string[] },
  externalId: string,
): NormalizedOffer | { reason: string } {
  const title = read(record, mapping.title)?.trim();
  if (!title || title.length < 2) {
    return { reason: 'başlık eksik veya çok kısa' };
  }

  // --- Adres ---------------------------------------------------------------
  const rawUrl = read(record, mapping.url)?.trim();
  if (!rawUrl) return { reason: 'ürün adresi eksik' };

  const productUrl = validateUrl(rawUrl, options.allowedHosts);
  if (!productUrl) {
    return { reason: `ürün adresi geçersiz veya mağazaya ait değil: ${rawUrl}` };
  }

  // --- Fiyat ---------------------------------------------------------------
  const rawPrice = read(record, mapping.price);
  if (!rawPrice) return { reason: 'fiyat eksik' };

  const priceCents = parseMoneyToCents(rawPrice);
  if (priceCents === null) {
    return { reason: `fiyat okunamadı: "${rawPrice}"` };
  }

  // 0 TL bir fiyat değil, bir veri hatasıdır. Listelenirse karşılaştırmanın
  // tepesine oturur ve tüm sıralamayı bozar.
  if (priceCents <= 0) {
    return { reason: `fiyat sıfır veya negatif: "${rawPrice}"` };
  }

  if (priceCents > MAX_PRICE_CENTS) {
    return { reason: `fiyat makul üst sınırın üstünde: "${rawPrice}"` };
  }

  // --- Üstü çizili fiyat ---------------------------------------------------
  let compareAtPriceCents: number | null = null;
  const rawCompare = mapping.compare_at_price ? read(record, mapping.compare_at_price) : null;

  if (rawCompare) {
    const parsed = parseMoneyToCents(rawCompare);
    // Satış fiyatından DÜŞÜK bir "üstü çizili" fiyat anlamsızdır; sahte
    // indirim göstermektense alanı boş bırakmak doğrudur.
    if (parsed !== null && parsed > priceCents && parsed <= MAX_PRICE_CENTS) {
      compareAtPriceCents = parsed;
    }
  }

  // --- Stok ----------------------------------------------------------------
  const stock = parseStock(mapping.stock ? read(record, mapping.stock) : null);

  // --- GTIN ----------------------------------------------------------------
  const gtin = normalizeGtin(mapping.gtin ? read(record, mapping.gtin) : null);

  // --- Görseller -----------------------------------------------------------
  const imageUrls = (mapping.image ? read(record, mapping.image) : null)
    ?.split('|')
    .map((url) => url.trim())
    .filter((url) => url !== '' && isHttpUrl(url))
    .slice(0, 12) ?? [];

  const shippingFeeCents = mapping.shipping_fee
    ? parseMoneyToCents(read(record, mapping.shipping_fee) ?? '') ?? 0
    : 0;

  return {
    externalId,
    title: title.slice(0, 300),
    productUrl,
    priceCents,
    compareAtPriceCents,
    currency: (mapping.currency ? read(record, mapping.currency) : null)?.trim().toUpperCase()
      ?? options.defaultCurrency,
    stock,
    gtin,
    brand: (mapping.brand ? read(record, mapping.brand) : null)?.trim().slice(0, 120) || null,
    description:
      (mapping.description ? read(record, mapping.description) : null)?.trim().slice(0, 20_000)
      || null,
    imageUrls,
    categorySlug: (mapping.category ? read(record, mapping.category) : null)?.trim() || null,
    shippingFeeCents: Math.max(0, shippingFeeCents),
  };
}

/**
 * Stok bilgisini yorumlar.
 *
 * Feed'ler bunu üç farklı biçimde gönderir:
 *   • Sayı            : "42"
 *   • Google Merchant : "in stock" / "out of stock" / "preorder"
 *   • Boolean         : "true" / "1" / "evet" / "var"
 *
 * Alan HİÇ YOKSA stokta varsayılır: çoğu ortaklık feed'i yalnızca satılabilir
 * ürünleri yayınlar. Alan VARSA ve anlaşılmıyorsa 0 döner — belirsizlikte
 * ürünü göstermemek, olmayan ürünü satıyormuş gibi görünmekten iyidir.
 */
export function parseStock(value: string | null | undefined): number {
  if (value === null || value === undefined) return 100;

  const text = value.trim().toLowerCase();
  if (text === '') return 100;

  const numeric = Number.parseInt(text, 10);
  if (Number.isFinite(numeric) && /^\d+$/.test(text)) {
    return Math.max(0, Math.min(numeric, 1_000_000));
  }

  const inStock = ['in stock', 'instock', 'available', 'true', 'yes', 'evet', 'var', 'stokta'];
  const outOfStock = [
    'out of stock', 'outofstock', 'unavailable', 'false', 'no',
    'hayir', 'hayır', 'yok', 'tukendi', 'tükendi', 'preorder', 'backorder',
  ];

  if (inStock.includes(text)) return 100;
  if (outOfStock.includes(text)) return 0;

  return 0;
}

/**
 * GTIN doğrulaması — kontrol basamağı dahil.
 *
 * Bu, kanonik ürün eşleştirmesinin en güvenilir sinyalidir; hatalı bir GTIN
 * iki FARKLI ürünü birleştirir ve kullanıcı yanlış ürünü satın alır.
 * Bu yüzden biçim kontrolü yeterli değildir, kontrol basamağı da doğrulanır.
 */
export function normalizeGtin(value: string | null | undefined): string | null {
  if (!value) return null;

  const digits = value.replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return null;

  // GS1 kontrol basamağı: sağdan sola 3-1-3-1… ağırlıklı toplam.
  const body = digits.slice(0, -1);
  const checkDigit = Number(digits.at(-1));

  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }

  const expected = (10 - (sum % 10)) % 10;
  return expected === checkDigit ? digits : null;
}

/** Adres geçerli, https/http ve mağazanın alan adına ait olmalı. */
function validateUrl(value: string, allowedHosts: string[]): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (allowedHosts.length === 0) return null;

  const host = url.hostname.toLowerCase();

  // Alt alan adı kabul, benzer görünen alan adı ret (bkz. shared/affiliate).
  const allowed = allowedHosts.some((candidate) => {
    const base = candidate.trim().toLowerCase().replace(/^www\./, '');
    return base !== '' && (host === base || host.endsWith(`.${base}`));
  });

  return allowed ? url.toString() : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Harita bir yol (a.b.c) ya da düz anahtar olabilir. */
function read(record: RawRecord, key: string | undefined): string | null {
  if (!key) return null;
  return record[key] ?? null;
}
