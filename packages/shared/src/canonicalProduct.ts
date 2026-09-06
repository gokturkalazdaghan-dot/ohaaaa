/**
 * Kanonik ürün kimliği — saf, belirlenimci, ağdan ve mağazadan bağımsız.
 *
 * ======================================================================
 * NEDEN KODDA DA VAR
 * ======================================================================
 * Tekillik veritabanında (`product_groups.canonical_key` ÜRETİLMİŞ ve
 * TEKİL) ve orası son kapı olarak kalıyor. Ama alım hattı, bir partiyi
 * yazmadan ÖNCE aynı anahtara düşen satırları kendi içinde birleştirmek
 * zorunda: 50 000 satırlık bir parti içinde aynı ürün üç kez geçiyorsa,
 * üçünü de veritabanına gönderip ikisinin 23505 almasını beklemek partiyi
 * üç kat yavaşlatır ve `on conflict` kilitlerini gereksizce çoğaltır.
 *
 * İkisi ayrışırsa sonuç sessizdir: kod bir anahtar hesaplar, veritabanı
 * başka birini üretir, `on conflict` hiç eşleşmez ve her tur aynı ürün
 * için yeni satır açılır. `scripts/verify-canonical-parity.mjs` bunu
 * gerçek veritabanına sorarak kilitliyor.
 *
 * ======================================================================
 * NORMALIZE_SEARCH BURADA TEKRARLANMIYOR
 * ======================================================================
 * `productSignature` ile aynı normalizasyon zinciri kullanılıyor; ikinci
 * bir Türkçe küçültme/ayıklama uygulaması yazmak, üçüncü bir ayrışma
 * yüzeyi açmak olurdu.
 */

import { normalizeSearch } from './productSync.js';

/**
 * Boşlukları tek gösterime indirir — `public.collapse_space()` ile birebir.
 *
 * Feed'ler aynı başlığı farklı boşluklarla gönderir; fark anahtara girseydi
 * aynı ürün her feed'de yeni bir kanonik satır açardı.
 */
export function collapseSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** GTIN'in geçerli sayıldığı uzunluklar: GTIN-8, UPC-12, EAN-13, GTIN-14. */
export const GTIN_LENGTHS: readonly number[] = [8, 12, 13, 14];

/**
 * GTIN'i tek gösterime indirir: yalnız rakamlar, GTIN-14'e sola dolgulu.
 *
 * Aynı ürün bir feed'de UPC-12, diğerinde EAN-13, üçüncüsünde tireli gelir.
 * Üçü de AYNI üründür; ham metin karşılaştırması üç ayrı ürün sayardı ve
 * bu, tekilleştirmenin en sık sessizce kaçırdığı durumdur.
 *
 * Geçersiz uzunluk `null` döner — '0' ya da boş metin DEĞİL. İkisi de bir
 * DEĞER gibi davranır ve iki geçersiz GTIN'i eşitleyerek alakasız ürünleri
 * birleştirirdi.
 */
export function normalizeGtin(gtin: string | null | undefined): string | null {
  if (gtin === null || gtin === undefined) return null;

  const rakamlar = String(gtin).replace(/[^0-9]/g, '');
  if (!GTIN_LENGTHS.includes(rakamlar.length)) return null;

  return rakamlar.padStart(14, '0');
}

export interface CanonicalKeyInput {
  gtin: string | null;
  brand: string | null;
  mpn: string | null;
  title: string | null;
}

/**
 * Kanonik eşleştirme anahtarı — GÜVENİLİRLİK SIRASIYLA.
 *
 *   1. GTIN         üreticinin küresel kimliği; en güvenilir
 *   2. marka + MPN  GTIN yoksa en iyi ikinci
 *   3. marka + başlık  son çare; zayıf ama HİÇ eşleştirmemekten iyi --
 *      alternatifi, aynı ürünün her feed'de yeni satır açmasıdır
 *
 * Önek ZORUNLU: öneksiz, bir ürünün GTIN'i başka bir ürünün MPN'siyle
 * çakışabilir ve iki alakasız ürün birleşirdi.
 */
export function canonicalProductKey(input: CanonicalKeyInput): string {
  const gtin = normalizeGtin(input.gtin);
  if (gtin !== null) return `gtin:${gtin}`;

  const marka = (input.brand ?? '').trim();
  const mpn = (input.mpn ?? '').trim();

  if (marka.length > 0 && mpn.length > 0) {
    return `mpn:${collapseSpace(normalizeSearch(marka))}:${collapseSpace(normalizeSearch(mpn))}`;
  }

  return `title:${collapseSpace(normalizeSearch(`${input.brand ?? ''} ${input.title ?? ''}`))}`;
}

/**
 * Bir partiyi kanonik anahtara göre gruplar.
 *
 * Aynı partide aynı ürün birden çok kez geçebilir (aynı feed'de varyant
 * satırları, ya da birleştirilmiş çoklu kaynak). Hepsini veritabanına
 * göndermek partiyi kat kat yavaşlatır ve `on conflict` kilitlerini
 * çoğaltır; burada tek satıra iniyorlar.
 */
export function groupByCanonicalKey<T>(
  items: readonly T[],
  anahtar: (item: T) => CanonicalKeyInput,
): Map<string, T[]> {
  const gruplar = new Map<string, T[]>();

  for (const item of items) {
    const k = canonicalProductKey(anahtar(item));
    const mevcut = gruplar.get(k);
    if (mevcut) mevcut.push(item);
    else gruplar.set(k, [item]);
  }

  return gruplar;
}
