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
 * GS1 kontrol basamağı — sağdan sola 3-1-3-1 ağırlıklı toplam.
 *
 * BİÇİM KONTROLÜ YETMEZ. Bir feed'de yanlış yazılmış tek bir rakam,
 * TAMAMEN BAŞKA bir ürünün geçerli görünen GTIN'ini üretir. Kontrol
 * basamağı olmadan o iki ürün birleşir ve kullanıcı karşılaştırma
 * tablosunda başka bir ürünün fiyatlarını görür -- yani yanlış ürünü
 * satın alır. Tekilleştirmenin en pahalı hatası budur.
 */
function kontrolBasamagi(body: string): number {
  let toplam = 0;
  for (let i = body.length - 1, agirlik = 3; i >= 0; i -= 1, agirlik = agirlik === 3 ? 1 : 3) {
    toplam += Number(body[i]) * agirlik;
  }
  return (10 - (toplam % 10)) % 10;
}

/**
 * GTIN'i tek gösterime indirir: yalnız rakamlar, GTIN-14'e sola dolgulu.
 *
 * Aynı ürün bir feed'de UPC-12, diğerinde EAN-13, üçüncüsünde tireli gelir.
 * Üçü de AYNI üründür; ham metin karşılaştırması üç ayrı ürün sayardı ve
 * bu, tekilleştirmenin en sık sessizce kaçırdığı durumdur.
 *
 * KONTROL BASAMAĞI DOĞRULANIR: geçersizse `null`. Geçersiz bir GTIN'i
 * kabul etmek, bir yazım hatasını kimlik saymaktır.
 *
 * Geçersiz uzunluk da `null` döner — '0' ya da boş metin DEĞİL. İkisi de
 * bir DEĞER gibi davranır ve iki geçersiz GTIN'i eşitleyerek alakasız
 * ürünleri birleştirirdi.
 *
 * TEK UYGULAMA: `public.normalize_gtin()` (SQL) ve alım hattı aynı
 * hesabı kullanır; `verify-canonical-parity.mjs` eşitliği kilitler.
 */
export function normalizeGtin(gtin: string | null | undefined): string | null {
  if (gtin === null || gtin === undefined) return null;

  const rakamlar = String(gtin).replace(/[^0-9]/g, '');
  if (!GTIN_LENGTHS.includes(rakamlar.length)) return null;

  if (kontrolBasamagi(rakamlar.slice(0, -1)) !== Number(rakamlar.at(-1))) return null;

  return rakamlar.padStart(14, '0');
}

/**
 * UPC-E (8 hane) -> UPC-A (12 hane) genişletmesi.
 *
 * NEDEN AYRI BİR İŞLEV, `normalizeGtin`İN İÇİNDE DEĞİL
 *
 * `normalizeGtin`in bir SQL ikizi var (`public.normalize_gtin`) ve ikisinin
 * eşitliği `verify-canonical-parity.mjs` ile kilitli. Genişletmeyi oraya
 * koymak, iki uygulamayı ayrıştırır ya da aynı kuralı iki dilde iki kez
 * yazmayı gerektirirdi. İhtiyaç da orada değil: BESLEMELER UPC-E GÖNDERMEZ,
 * UPC-A/EAN-13 gönderir. UPC-E yalnızca KAMERADAN gelir -- küçük Amerikan
 * ambalajlarında yaygındır ve katalog US/CA programlarına açıldı.
 *
 * NEDEN GEREKLİ
 *
 * UPC-E'nin kontrol basamağı, 8 hanenin kendisi üzerinden DEĞİL, açılmış
 * UPC-A üzerinden hesaplanır. Yani geçerli bir UPC-E, `normalizeGtin`
 * tarafından "kontrol basamağı tutmuyor" diye reddedilir. Ölçüldü:
 * `04252614` (gerçek bir UPC-E) reddediliyordu; açılımı `042100005264`
 * sorunsuz geçiyor.
 *
 * GS1 açma kuralı, son hanenin (d6) değerine göre:
 *   0,1,2 -> N d1 d2 d6 0 0 0 0 d3 d4 d5 C
 *   3     -> N d1 d2 d3 0 0 0 0 0 d4 d5 C
 *   4     -> N d1 d2 d3 d4 0 0 0 0 0 d5 C
 *   5-9   -> N d1 d2 d3 d4 d5 0 0 0 0 d6 C
 *
 * Yalnızca sayı sistemi 0 ya da 1 olan kodlar UPC-E'dir; başka bir ilk
 * hane geldiğinde `null` döner ve çağıran onu EAN-8 olarak okumaya devam
 * eder.
 */
export function expandUpcE(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  const d = String(raw).replace(/[^0-9]/g, '');
  if (d.length !== 8) return null;
  if (d[0] !== '0' && d[0] !== '1') return null;

  const n = d[0];
  const [d1, d2, d3, d4, d5, d6] = d.slice(1, 7);
  const c = d[7];

  let body: string;
  if (d6 === '0' || d6 === '1' || d6 === '2') body = `${n}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${n}${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${n}${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${n}${d1}${d2}${d3}${d4}${d5}0000${d6}`;

  return `${body}${c}`;
}

/**
 * Kameradan ya da adresten gelen bir barkodu kanonik GTIN-14'e çevirir.
 *
 * SIRALAMA ÖNEMLİ. Sekiz haneli bir kod hem EAN-8 hem UPC-E olabilir ve
 * ikisi FARKLI ürünlerdir. Önce EAN-8 denenir (kontrol basamağı 8 hanenin
 * kendisi üzerinden); yalnızca o tutmazsa UPC-E açılımı denenir. Ters sıra,
 * geçerli bir EAN-8'i başka bir ürüne çevirebilirdi.
 */
export function normalizeScannedGtin(raw: string | null | undefined): string | null {
  const dogrudan = normalizeGtin(raw);
  if (dogrudan) return dogrudan;
  return normalizeGtin(expandUpcE(raw));
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
