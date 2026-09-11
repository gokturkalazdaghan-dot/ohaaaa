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
import { normalizeGtin } from '@ohaaaa/shared';

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

  // --- SKU / MPN / durum ---------------------------------------------------
  const sku = (mapping.sku ? read(record, mapping.sku) : null)?.trim() || null;
  const mpn = (mapping.mpn ? read(record, mapping.mpn) : null)?.trim() || null;
  const condition = normalizeCondition(mapping.condition ? read(record, mapping.condition) : null);

  return {
    externalId,
    title: title.slice(0, 300),
    productUrl,
    priceCents,
    compareAtPriceCents,
    /*
     * PARA BIRIMI: BOS SUTUN "BOS PARA BIRIMI" DEGILDIR.
     *
     * Eskiden `?.trim().toUpperCase() ?? defaultCurrency` yaziyordu. `??`
     * yalnizca null/undefined'i yakalar; sutun VARSA ama BOSSA sonuc `''`
     * oluyordu ve teklif bos para birimiyle yaziliyordu. `products.currency`
     * char(3) ve `currencies` tablosuna yabanci anahtarla bagli: butun yigin
     * yazma aninda duserdi -- ya da daha kotusu, "" bir sekilde gecseydi
     * fiyat para birimsiz kalirdi.
     *
     * Ayrica UC HARF olmayan her deger reddediliyor: bazi beslemeler bu
     * sutuna "GB", "Pound" ya da sembol koyuyor. Taninmayan degerde kaynagin
     * yapilandirilmis para birimine dusuluyor -- cikarim degil, operatorun
     * verdigi deger.
     */
    currency: gecerliParaBirimi(mapping.currency ? read(record, mapping.currency) : null)
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
    sku: sku ? sku.slice(0, 120) : null,
    mpn: mpn ? mpn.slice(0, 120) : null,
    condition,
  };
}

/**
 * Ürün durumunu ŞEMANIN TANIDIĞI üç değere indirger.
 *
 * Beslemeler bunu serbest metin gönderir: "New", "brand new", "Refurbished",
 * "pre-owned", "A-stock"... Tanınmayan bir değeri olduğu gibi taşımak, yazma
 * anında enum ihlaliyle BÜTÜN yığını düşürürdü -- tek bir satır yüzünden
 * 35 000 ürün kaybedilirdi.
 *
 * TANINMAYAN DEĞER null DÖNER, 'new' DEĞİL. Bilmediğimizi "sıfır ürün" diye
 * yazmak bir çıkarım olurdu; null, sütunun şema varsayılanına (new) bırakır
 * ve bu kararı şema verir, biz değil.
 */
export function normalizeCondition(
  raw: string | null | undefined,
): 'new' | 'refurbished' | 'used' | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;

  if (/(^|\b)(new|neu|nuevo|nuovo|sifir|sıfır)(\b|$)/.test(v)) return 'new';
  if (/refurb|yenilen|reacondicion|ricondizion/.test(v)) return 'refurbished';
  if (/used|second[\s-]?hand|pre[\s-]?owned|gebraucht|ikinci\s?el/.test(v)) return 'used';

  return null;
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
/** Uc harfli ISO-4217 koduna indirger; degilse null (cagiran varsayilana duser). */
function gecerliParaBirimi(raw: string | null | undefined): string | null {
  const v = raw?.trim().toUpperCase();
  return v && /^[A-Z]{3}$/.test(v) ? v : null;
}

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

/*
 * GTIN normalizasyonu TEK UYGULAMADA: `@ohaaaa/shared`.
 *
 * Burada ikinci bir uygulama vardı ve iki hesap AYRIŞMIŞTI: bu dosyadaki
 * sürüm kontrol basamağını doğruluyor ama GTIN-14'e doldurmuyordu; kanonik
 * anahtarı üreten sürüm dolduruyor ama kontrol basamağına bakmıyordu. İkisi
 * birleştirildi -- doğrulama VE doldurma artık aynı yerde ve `products.gtin`
 * ile `product_groups.canonical_key` aynı hesaptan geçiyor.
 */
export { normalizeGtin } from '@ohaaaa/shared';

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
