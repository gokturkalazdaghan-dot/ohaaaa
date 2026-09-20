/**
 * `affiliate-com` — Affiliate.com talep-anı ürün arama sağlayıcısı.
 *
 * ======================================================================
 * BU SAĞLAYICI AWIN'İN YERİNE GEÇMEZ
 * ======================================================================
 * Awin bu depoda DÖNÜŞÜM ve BESLEME (feed) hattıdır: `providers/awin.ts`,
 * `packages/ingest`, `sources` tablosu, `/api/cron/alim`. O hat tek satır
 * değişmeden çalışmaya devam eder.
 *
 * Buradaki sağlayıcı bambaşka bir yeri doldurur: katalogda olmayan bir
 * sonucu, kullanıcı aradığı ANDA getirmek. İki hat birbirine hiç
 * dokunmaz -- ne tablo, ne kuyruk, ne cron paylaşırlar.
 *
 * ======================================================================
 * SÖZLEŞME DOĞRULANMAMIŞTIR -- VE BU DOSYA ONU GİZLEMEZ
 * ======================================================================
 * Elimizde olan tek kesin bilgi şudur:
 *
 *   POST https://api.affiliate.com/v1/products
 *   Authorization: Bearer <anahtar>
 *
 * İstek gövdesinin alan adları, filtre sözlüğü, sayfalama biçimi ve yanıt
 * şeması BİZE RESMÎ OLARAK DOĞRULANMADI. Bu durumda iki yol vardı:
 *
 *   (a) Makul görünen bir sözleşme uydurmak ve "çalışıyor" demek.
 *   (b) Yalnızca bilinen kadarını sabitlemek, gerisini savunmacı okumak
 *       ve eksik olanı AÇIKÇA işaretlemek.
 *
 * (b) seçildi. (a) seçilseydi, ilk gerçek anahtar takıldığında iki sonuç
 * olurdu: ya 422 (arama hiç çalışmaz) ya da filtrelerin sessizce yok
 * sayılması -- yani kullanıcıya "Türkiye sonuçları" diye dünya geneli
 * sonuç göstermek. İkincisi daha pahalıdır çünkü kimse fark etmez.
 *
 * PRATİKTE BU NE DEMEK:
 *   • `buildRequest` YALNIZCA sorgu metnini ve limiti gönderir.
 *   • Pazar/ülke/para birimi/ağ/satıcı filtreleri SÖZLEŞMEDE vardır
 *     (bkz. `types.ts` -> `ProductSearchQuery`) ama tel üzerine
 *     yazılmazlar; `DOGRULANMAMIS_FILTRELER` onları tek yerde listeler.
 *     Doküman doğrulandığında yapılacak iş: o listeden alanı silmek ve
 *     `buildRequest` içine bir satır eklemek.
 *   • `parseResponse` alanları ADAY YOLLAR üzerinden okur: aynı bilgi
 *     `image_url`, `imageUrl` ya da `images[0]` diye gelebilir. Aday
 *     listesinde olmayan hiçbir şey UYDURULMAZ; alan `null` kalır.
 */

import { isCurrencyCode, parseMoneyToCents } from '../money.js';
import type {
  ExternalProduct,
  ProductAvailability,
  ProductCondition,
  ProductSearchProvider,
  ProductSearchQuery,
} from './types.js';

/** Bilinen tek kesin bilgi: uç nokta. */
export const AFFILIATE_COM_ENDPOINT = 'https://api.affiliate.com/v1/products';

/** `ExternalProduct.source` ve önbellek anahtarındaki kimlik. */
export const AFFILIATE_COM_ID = 'affiliate-com';

/** Tek istekte istenebilecek en fazla ürün. */
export const AFFILIATE_COM_MAX_LIMIT = 50;

/**
 * SÖZLEŞMESİ DOĞRULANMAMIŞ FİLTRELER -- TEK LİSTE, TEK YER.
 *
 * Bu alanlar `ProductSearchQuery` içinde taşınır, önbellek anahtarına
 * girer (aynı metin farklı pazarda farklı sonuç verebilir, o yüzden
 * anahtar onları saymak ZORUNDA) ama HTTP gövdesine YAZILMAZ.
 *
 * Buradan bir ad silmek, o filtrenin gerçekten desteklendiğinin
 * doğrulandığı anlamına gelir -- ve ancak o zaman `buildRequest` onu
 * gönderir.
 */
export const DOGRULANMAMIS_FILTRELER = [
  'market',
  'country',
  'currency',
  'network',
  'merchant',
] as const;

/**
 * ÇÖZÜLMEMİŞ YER TUTUCU KALIBI.
 *
 * Görev tanımında `@@@` ve `###` gibi yer tutucuların geçtiği söylendi ama
 * bunların GERÇEKTE nasıl doldurulduğu doğrulanmadı. Bu dosya varsayım
 * yapmaz: böyle bir dizi taşıyan adres KULLANILABİLİR SAYILMAZ.
 *
 * NEDEN "DOLDURMAYA ÇALIŞMAK" DEĞİL DE "DÜŞÜRMEK"
 * Aynı hata bu depoda bir kez ölçüldü ve `affiliate.ts` içinde yazılı:
 * çözülmemiş bir yer tutucu adres dilbilgisini BOZMAZ. Yani link geçerli
 * görünür, yönlendirme çalışır, kullanıcı mağazaya varır ve tıklama
 * ATIFSIZ kalır. Sessiz gelir kaybı. Boş link ise gürültülüdür: arayüz
 * düğmeyi çizmez, operatör eksiği görür.
 *
 * İki ayrı kalıp:
 *   • `@@`/`##` gibi TEKRARLI işaretler -- gerçek bir adreste bulunmaz.
 *   • `{...}` süslü parantez -- `buildAffiliateUrl` ile aynı kural.
 */
const YER_TUTUCU = /@{2,}|#{2,}|\{[^}]*\}/;

/** Adreste çözülmemiş yer tutucu var mı? */
export function cozulmemisYerTutucuVar(url: string): boolean {
  return YER_TUTUCU.test(url);
}

// ---------------------------------------------------------------------------
// Savunmacı okuyucular
// ---------------------------------------------------------------------------
/*
 * Aşağıdaki yardımcılar tek bir kurala hizmet eder: BEKLENMEYEN BİÇİM
 * HATA DEĞİLDİR, EKSİK VERİDİR.
 *
 * Doğrulanmamış bir sözleşmede her alan için "ya gelmezse" sorusunun
 * cevabı `null` olmalıdır. Fırlatmak, tek bir tuhaf üründe bütün arama
 * turunu düşürürdü.
 */

/** İç içe yoldan (`urls.outclick`) değer okur. */
function yoldanOku(kaynak: unknown, yol: string): unknown {
  let current: unknown = kaynak;

  for (const parca of yol.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[parca];
  }

  return current;
}

/** Aday yolları sırayla dener; ilk DOLU değeri döndürür. */
function ilkDolu(kaynak: unknown, yollar: readonly string[]): unknown {
  for (const yol of yollar) {
    const deger = yoldanOku(kaynak, yol);
    if (deger !== undefined && deger !== null && deger !== '') return deger;
  }

  return undefined;
}

/** Kırpılmış metin; boşsa `null`. */
function metin(kaynak: unknown, yollar: readonly string[]): string | null {
  const deger = ilkDolu(kaynak, yollar);

  if (typeof deger === 'string') {
    const kirpilmis = deger.trim();
    return kirpilmis === '' ? null : kirpilmis;
  }

  // Sayı gelen kimlik alanları (id, sku) metne çevrilir: kimlik bir
  // dizedir, sayıymış gibi karşılaştırılmaz.
  if (typeof deger === 'number' && Number.isFinite(deger)) return String(deger);

  return null;
}

/** Negatif olmayan tam sayı; okunamıyorsa `null`. */
function tamSayi(kaynak: unknown, yollar: readonly string[]): number | null {
  const deger = ilkDolu(kaynak, yollar);

  const sayi =
    typeof deger === 'number' ? deger : typeof deger === 'string' ? Number(deger.trim()) : NaN;

  if (!Number.isFinite(sayi) || sayi < 0) return null;

  return Math.trunc(sayi);
}

/**
 * Fiyatı KURUŞA çevirir.
 *
 * İki biçim de beklenir ve ikisi de farklı bir tuzak taşır:
 *   • sayı  (19.99)    -> ikilik tabanda tam değildir; `toFixed(2)` ile
 *                         sabitlenip yuvarlanır.
 *   • metin ("19,99")  -> ondalık ayırıcı ülkeye göre değişir;
 *                         `parseMoneyToCents` bu kuralın TEK sahibidir.
 */
function kurus(kaynak: unknown, yollar: readonly string[]): number | null {
  const deger = ilkDolu(kaynak, yollar);

  if (typeof deger === 'number') {
    if (!Number.isFinite(deger) || deger < 0) return null;
    return Math.round(Number(deger.toFixed(2)) * 100);
  }

  if (typeof deger === 'string') {
    const sonuc = parseMoneyToCents(deger);
    return sonuc === null || sonuc < 0 ? null : sonuc;
  }

  return null;
}

/**
 * Adresi doğrular.
 *
 * `http`/`https` DIŞINDAKİ şemalar reddedilir: `javascript:` ya da `data:`
 * bir ürün adresinde işi olmayan, ama arayüze düz metin olarak verildiğinde
 * zarar verebilen şemalardır.
 *
 * Çözülmemiş yer tutucu taşıyan adres de reddedilir -- gerekçe yukarıda.
 * `bozuk` bayrağı, "hiç yoktu" ile "vardı ama kullanılamazdı"yı ayırır.
 */
function adres(kaynak: unknown, yollar: readonly string[]): { url: string | null; bozuk: boolean } {
  const ham = metin(kaynak, yollar);
  if (ham === null) return { url: null, bozuk: false };

  if (cozulmemisYerTutucuVar(ham)) return { url: null, bozuk: true };

  let cozumlenmis: URL;
  try {
    cozumlenmis = new URL(ham);
  } catch {
    return { url: null, bozuk: false };
  }

  if (cozumlenmis.protocol !== 'https:' && cozumlenmis.protocol !== 'http:') {
    return { url: null, bozuk: false };
  }

  return { url: cozumlenmis.toString(), bozuk: false };
}

/** ISO-8601 olduğu doğrulanmış zaman damgası. */
function zaman(kaynak: unknown, yollar: readonly string[]): string | null {
  const ham = metin(kaynak, yollar);
  if (ham === null) return null;

  const zamanDamgasi = Date.parse(ham);
  if (Number.isNaN(zamanDamgasi)) return null;

  return new Date(zamanDamgasi).toISOString();
}

/**
 * Stok durumu eşlemesi.
 *
 * Eşlenemeyen değer `unknown` olur, `out_of_stock` DEĞİL. Tanımadığımız
 * bir etiketi "stokta yok" saymak, satılabilir ürünü gizlemek demektir.
 */
function stokDurumu(kaynak: unknown): ProductAvailability {
  const ham = metin(kaynak, ['availability', 'stock_status', 'in_stock', 'stock.status']);

  // Bazı sağlayıcılar bunu boolean gönderir; `metin` onu okuyamaz.
  const bool = ilkDolu(kaynak, ['availability', 'in_stock', 'stock.in_stock']);
  if (typeof bool === 'boolean') return bool ? 'in_stock' : 'out_of_stock';

  if (ham === null) return 'unknown';

  const anahtar = ham.toLowerCase().replace(/[\s-]+/g, '_');

  if (['in_stock', 'instock', 'available', 'yes', 'true', '1'].includes(anahtar)) return 'in_stock';
  if (['out_of_stock', 'outofstock', 'unavailable', 'no', 'false', '0'].includes(anahtar)) {
    return 'out_of_stock';
  }
  if (anahtar === 'preorder') return 'preorder';
  if (anahtar === 'backorder') return 'backorder';

  return 'unknown';
}

/** Ürün durumu eşlemesi. Tanınmayan değer `unknown` -- gerekçe yukarıdaki ile aynı. */
function urunDurumu(kaynak: unknown): ProductCondition {
  const ham = metin(kaynak, ['condition', 'product_condition', 'item_condition']);
  if (ham === null) return 'unknown';

  const anahtar = ham.toLowerCase().replace(/[\s-]+/g, '_');

  if (anahtar === 'new') return 'new';
  if (anahtar === 'used' || anahtar === 'second_hand' || anahtar === 'pre_owned') return 'used';
  if (anahtar === 'refurbished' || anahtar === 'renewed') return 'refurbished';

  return 'unknown';
}

/** Yalnızca rakamlar. Uzunluk ve kontrol basamağı BURADA doğrulanmaz. */
function barkod(kaynak: unknown): string | null {
  const ham = metin(kaynak, [
    'barcode',
    'gtin',
    'ean',
    'upc',
    'identifiers.gtin',
    'identifiers.barcode',
    'identifiers.ean',
    'identifiers.upc',
  ]);
  if (ham === null) return null;

  const rakamlar = ham.replace(/\D/g, '');
  return rakamlar === '' ? null : rakamlar;
}

// ---------------------------------------------------------------------------
// Normalizasyon
// ---------------------------------------------------------------------------

/**
 * Tek bir ham ürünü ortak modele çevirir.
 *
 * `null` DÖNDÜĞÜ TEK DURUM: kimlik ya da ad okunamadı. İkisi olmadan
 * gösterilecek bir ürün yoktur; diğer her alan eksik olabilir ve eksikliği
 * modelde `null` olarak görünür.
 */
export function normalizeAffiliateComProduct(raw: unknown): ExternalProduct | null {
  if (raw === null || typeof raw !== 'object') return null;

  const providerId = metin(raw, ['id', 'product_id', 'productId', 'uid']);
  const name = metin(raw, ['name', 'title', 'product_name']);

  if (providerId === null || name === null) return null;

  const komisyon = adres(raw, [
    'commission_url',
    'commissionUrl',
    'urls.outclick',
    'urls.commission',
    'outclick_url',
  ]);

  const dogrudan = adres(raw, ['direct_url', 'directUrl', 'urls.direct', 'product_url', 'url']);

  const paraBirimiHam = metin(raw, ['currency', 'currency_code', 'price.currency']);
  const paraBirimi = paraBirimiHam ? paraBirimiHam.toUpperCase() : null;

  const ulkeHam = metin(raw, ['country', 'country_code', 'market.country']);
  const ulke = ulkeHam && /^[A-Za-z]{2}$/.test(ulkeHam) ? ulkeHam.toUpperCase() : null;

  return {
    providerId,
    barcode: barkod(raw),
    sku: metin(raw, ['sku', 'identifiers.sku', 'merchant_sku']),
    name,
    description: metin(raw, ['description', 'short_description', 'summary']),
    commissionUrl: komisyon.url,
    directUrl: dogrudan.url,
    unresolvedLinkPlaceholders: komisyon.bozuk || dogrudan.bozuk,
    // Biçimi bozuk para birimi kodu TAŞINMAZ: `formatMoney` tanımadığı
    // kodu ham basar ve kullanıcı ekranda "XXX 1.299,00" görür.
    currency: paraBirimi && isCurrencyCode(paraBirimi) ? paraBirimi : null,
    regularPriceCents: kurus(raw, ['regular_price', 'regularPrice', 'price.regular', 'list_price']),
    finalPriceCents: kurus(raw, ['final_price', 'finalPrice', 'price.final', 'price', 'sale_price']),
    availability: stokDurumu(raw),
    stockQuantity: tamSayi(raw, ['stock_quantity', 'stockQuantity', 'stock.quantity', 'quantity']),
    brand: metin(raw, ['brand', 'brand_name', 'manufacturer']),
    model: metin(raw, ['model', 'model_name', 'mpn']),
    category: metin(raw, ['category', 'category_name', 'category.name']),
    country: ulke,
    condition: urunDurumu(raw),
    network: metin(raw, ['network', 'network_name', 'network.name']),
    merchant: metin(raw, ['merchant', 'merchant_name', 'merchant.name', 'advertiser']),
    updatedAt: zaman(raw, ['updated_at', 'updatedAt', 'last_updated']),
    addedAt: zaman(raw, ['added_at', 'addedAt', 'created_at']),
    source: AFFILIATE_COM_ID,
  };
}

/**
 * Yanıt gövdesinden ürün dizisini bulur.
 *
 * Sarmalayıcının adı doğrulanmadığı için birkaç aday denenir; hiçbiri
 * tutmazsa BOŞ dizi döner. Burada fırlatmak, sağlayıcının bir gün alan
 * adını değiştirmesi hâlinde aramanın tamamını düşürürdü -- oysa doğru
 * davranış "bu turda sonuç yok" deyip Ohaaaa katalog sonuçlarıyla devam
 * etmektir.
 */
function urunDizisi(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  for (const yol of ['products', 'data', 'results', 'items', 'data.products']) {
    const aday = yoldanOku(payload, yol);
    if (Array.isArray(aday)) return aday;
  }

  return [];
}

export const affiliateComProvider: ProductSearchProvider = {
  id: AFFILIATE_COM_ID,
  displayName: 'Affiliate.com',
  endpoint: AFFILIATE_COM_ENDPOINT,

  /**
   * İSTEK GÖVDESİ BİLEREK DAR.
   *
   * Yalnızca sorgu metni ve limit gönderilir. Diğer alanların adları
   * doğrulanmadı; doğrulanmamış bir alan göndermek en iyi ihtimalle yok
   * sayılır, en kötü ihtimalle 422 üretir (bkz. dosya başlığı).
   */
  buildRequest(query: ProductSearchQuery): Record<string, unknown> {
    const metinSorgu = query.query.trim();

    const limit = Math.min(
      Math.max(1, Math.trunc(query.limit ?? AFFILIATE_COM_MAX_LIMIT)),
      AFFILIATE_COM_MAX_LIMIT,
    );

    return { query: metinSorgu, limit };
  },

  parseResponse(payload: unknown): ExternalProduct[] {
    const urunler: ExternalProduct[] = [];

    for (const ham of urunDizisi(payload)) {
      const normalize = normalizeAffiliateComProduct(ham);
      if (normalize) urunler.push(normalize);
    }

    return urunler;
  },
};
