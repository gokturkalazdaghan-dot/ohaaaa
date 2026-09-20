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
 * SÖZLEŞME ARTIK RESMÎ DOKÜMANDAN OKUNDU
 * ======================================================================
 * Kaynak: https://guides.affiliate.com
 *   /authentication, /first-request, /concepts/products,
 *   /concepts/networks, /api-reference/products/search,
 *   /api-reference/reports/outclick
 *
 * İlk sürüm `{query, limit}` gönderiyordu ve bu YANLIŞTI: gerçek
 * sözleşme `search[]` dizisi + `per_page`. O hâliyle ilk gerçek istek
 * 400/422 alırdı.
 *
 * HÂLÂ CANLI DOĞRULANMADI. Gerçek kimlik bilgisi yok, dolayısıyla
 * başarılı (200) bir yanıt hiç görülmedi. Aşağıdaki her kural
 * dokümandan okunmuştur, ölçülmemiştir; `parseResponse` bu yüzden
 * savunmacı kalmaya devam eder (eksik alan = `null`, okunamayan ürün =
 * atlanır).
 */

import { isCurrencyCode, parseMoneyToCents } from '../money.js';
import type {
  ExternalProduct,
  ProductAvailability,
  ProductCondition,
  ProductSearchProvider,
  ProductSearchQuery,
  TrackingUrlKind,
} from './types.js';

/** Resmî uç nokta. */
export const AFFILIATE_COM_ENDPOINT = 'https://api.affiliate.com/v1/products';

/** `ExternalProduct.source` ve önbellek anahtarındaki kimlik. */
export const AFFILIATE_COM_ID = 'affiliate-com';

/**
 * `per_page` için bizim üst sınırımız.
 *
 * Resmî sınır ABONELİK PLANINA bağlıdır ve doküman bir sayı vermez.
 * Planı bilmeden büyük bir değer istemek 422 riskidir; bu yüzden tavan
 * dokümanın VARSAYILANINDA (100) tutuldu -- varsayılanın her planda
 * kabul edildiği kesin.
 */
export const AFFILIATE_COM_MAX_PER_PAGE = 100;

/** Arama sayfası için makul varsayılan. Dokümanın varsayılanı (100) değil. */
export const AFFILIATE_COM_DEFAULT_PER_PAGE = 24;

/**
 * ÇÖZÜLMEMİŞ YER TUTUCU KALIBI -- ARTIK BİR VARSAYIM DEĞİL.
 *
 * Resmî tanım: `@@@` = affiliate ID'niz, `###` = sub ID'niz. İkisi de
 * `networks` parametresi gönderilmediğinde ham kalır.
 *
 * NEDEN "DOLDURMAYA ÇALIŞMAK" DEĞİL DE "DÜŞÜRMEK"
 * Doküman (`/api-reference/reports/outclick`) bunu açıkça yazıyor:
 * doldurulmamış yer tutucular tıklama kaydına HARFİ HARFİNE geçer
 * (`sub_id` alanı `{SUB_ID}` olur) ve hiçbir raporla eşleşmez. Yani
 * link geçerli GÖRÜNÜR, kullanıcı mağazaya varır, tıklama ATIFSIZ
 * kalır -- sessiz gelir kaybı.
 *
 * Doğru çözüm ya `networks` parametresini göndermek ya da yer tutucusuz
 * `urls.outclick` kullanmaktır. İkisi de yoksa adres DÜŞER.
 *
 * Dokümanın andığı `{AFF_ID}` / `{SUB_ID}` biçimi de aynı kalıba girer.
 */
const YER_TUTUCU = /@{2,}|#{2,}|\{[^}]*\}/;

/** Adreste çözülmemiş yer tutucu var mı? */
export function cozulmemisYerTutucuVar(url: string): boolean {
  return YER_TUTUCU.test(url);
}

/**
 * `availability` alanının resmî değerleri.
 *
 * Doküman üç değer tanımlıyor ve alanın `null` da olabileceğini söylüyor.
 * `Unknown` ile `null` aynı yere düşer: ikisi de "bilmiyoruz"dur ve
 * "stokta yok" DEĞİLDİR -- tanımadığımız bir etiketi stoksuz saymak,
 * satılabilir ürünü gizlemek olurdu.
 */
const STOK_ESLEMESI: Record<string, ProductAvailability> = {
  instock: 'in_stock',
  outofstock: 'out_of_stock',
  unknown: 'unknown',
};

/**
 * `condition` alanının resmî değerleri.
 *
 * `open-box` kendi adıyla taşınır; `used`'a katlanmaz. Açılmış kutu ile
 * kullanılmış ürün arasındaki fark, fiyat karşılaştıran bir kullanıcı
 * için doğrudan paradır.
 */
const DURUM_ESLEMESI: Record<string, ProductCondition> = {
  new: 'new',
  used: 'used',
  refurbished: 'refurbished',
  'open-box': 'open-box',
  openbox: 'open-box',
  open_box: 'open-box',
};

// ---------------------------------------------------------------------------
// Savunmacı okuyucular
// ---------------------------------------------------------------------------
/*
 * TEK KURAL: BEKLENMEYEN BİÇİM HATA DEĞİLDİR, EKSİK VERİDİR.
 *
 * Her okuyucu aday yolları SIRAYLA dener ve KENDİ tipine uyan ilk değeri
 * alır. Tipe uymayan bir aday, okumayı bitirmez -- sıradakine geçilir.
 *
 * Bu ayrıntı bir hatanın düzeltilmesidir: önceki sürümde ortak bir
 * "ilk dolu değer" yardımcısı vardı ve `network` adayını görünce
 * OBJEYİ döndürüyordu; metin okuyucusu objeyi okuyamayıp `null` veriyor
 * ve `network.name` adayına HİÇ ULAŞILMIYORDU. Yanıtta ağ ve satıcı adı
 * daima boş çıkardı. Sözleşmede `network` ve `merchant` birer OBJE.
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

/** Kırpılmış metin; hiçbir aday metne çözülmezse `null`. */
function metin(kaynak: unknown, yollar: readonly string[]): string | null {
  for (const yol of yollar) {
    const deger = yoldanOku(kaynak, yol);

    if (typeof deger === 'string') {
      const kirpilmis = deger.trim();
      if (kirpilmis !== '') return kirpilmis;
    }

    // Sayı gelen kimlik alanları (id, sku) metne çevrilir: kimlik bir
    // dizedir, sayıymış gibi karşılaştırılmaz.
    if (typeof deger === 'number' && Number.isFinite(deger)) return String(deger);
  }

  return null;
}

/** Negatif olmayan tam sayı; okunamıyorsa `null`. */
function tamSayi(kaynak: unknown, yollar: readonly string[]): number | null {
  for (const yol of yollar) {
    const deger = yoldanOku(kaynak, yol);

    const sayi =
      typeof deger === 'number' ? deger : typeof deger === 'string' ? Number(deger.trim()) : NaN;

    if (Number.isFinite(sayi) && sayi >= 0) return Math.trunc(sayi);
  }

  return null;
}

/**
 * Fiyatı KURUŞA çevirir.
 *
 * Sözleşme `float` diyor ama metin gelme ihtimali kapatılmadı; iki biçim
 * de farklı bir tuzak taşır:
 *   • sayı  (19.99)    -> ikilik tabanda tam değildir; `toFixed(2)` ile
 *                         sabitlenip yuvarlanır.
 *   • metin ("19,99")  -> ondalık ayırıcı ülkeye göre değişir;
 *                         `parseMoneyToCents` bu kuralın TEK sahibidir.
 */
function kurus(kaynak: unknown, yollar: readonly string[]): number | null {
  for (const yol of yollar) {
    const deger = yoldanOku(kaynak, yol);

    if (typeof deger === 'number') {
      if (Number.isFinite(deger) && deger >= 0) return Math.round(Number(deger.toFixed(2)) * 100);
      continue;
    }

    if (typeof deger === 'string' && deger.trim() !== '') {
      const sonuc = parseMoneyToCents(deger);
      if (sonuc !== null && sonuc >= 0) return sonuc;
    }
  }

  return null;
}

/**
 * Adresi doğrular.
 *
 * `http`/`https` DIŞINDAKİ şemalar reddedilir: `javascript:` ya da `data:`
 * bir ürün adresinde işi olmayan, ama arayüze verildiğinde zarar
 * verebilen şemalardır.
 *
 * `bozuk` bayrağı, "hiç yoktu" ile "vardı ama yer tutucu taşıyordu"yu
 * ayırır -- ikincisi `networks` parametresinin eksik olduğunu söyler.
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

/** Stok durumu -- resmî değerler üzerinden, tanınmayan etiket `unknown`. */
function stokDurumu(kaynak: unknown): ProductAvailability {
  // Bazı beslemeler bunu boolean gönderir; sözleşmede yok ama zararsız.
  const bool = yoldanOku(kaynak, 'availability');
  if (typeof bool === 'boolean') return bool ? 'in_stock' : 'out_of_stock';

  const ham = metin(kaynak, ['availability', 'stock_status']);
  if (ham === null) return 'unknown';

  return STOK_ESLEMESI[ham.toLowerCase().replace(/[\s_-]+/g, '')] ?? 'unknown';
}

/** Ürün durumu -- resmî değerler üzerinden. */
function urunDurumu(kaynak: unknown): ProductCondition {
  const ham = metin(kaynak, ['condition']);
  if (ham === null) return 'unknown';

  return DURUM_ESLEMESI[ham.toLowerCase().trim()] ?? 'unknown';
}

/**
 * Barkodun yalnızca rakamlardan oluşan hâli.
 *
 * Rakam DIŞI karakter varsa `null` döner -- kırpmaz. ISBN-10'un `X`
 * kontrol basamağını silmek, geçersiz ve hiçbir şeyle eşleşmeyen bir kod
 * üretirdi. Ham değer `ExternalProduct.barcode` içinde olduğu gibi durur.
 */
function barkodRakamlari(ham: string | null): string | null {
  if (ham === null) return null;

  const temiz = ham.trim();
  return /^\d+$/.test(temiz) ? temiz : null;
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

  const providerId = metin(raw, ['id']);
  const name = metin(raw, ['name']);

  if (providerId === null || name === null) return null;

  /*
   * ADRES ÖNCELİĞİ -- RESMÎ DOKÜMANIN SIRASI.
   *
   *   1. urls.outclick   yer tutucu taşımaz, hazırdır ve Affiliate.com'un
   *                      tıklamayı KAYDETTİĞİ tek adrestir.
   *   2. urls.affiliate  ağın kendi linki; `commission_url` onun LEGACY
   *                      adıdır ("Prefer `urls` instead" -- doküman).
   *
   * `direct_url` bu zincire HİÇ girmez: komisyonsuz bir adresi ortaklık
   * linki diye sunmak, trafiği bedavaya vermektir.
   */
  const outclick = adres(raw, ['urls.outclick']);
  const ortaklik = adres(raw, ['urls.affiliate', 'commission_url']);
  const dogrudan = adres(raw, ['urls.direct', 'direct_url']);

  const trackingUrl = outclick.url ?? ortaklik.url;
  const trackingUrlKind: TrackingUrlKind | null =
    outclick.url !== null ? 'outclick' : ortaklik.url !== null ? 'affiliate' : null;

  const paraBirimiHam = metin(raw, ['currency']);
  const paraBirimi = paraBirimiHam ? paraBirimiHam.toUpperCase() : null;

  const barkod = metin(raw, ['barcode', 'identifiers.barcode', 'identifiers.ean', 'identifiers.gtin', 'identifiers.upc', 'identifiers.isbn']);

  /*
   * TODO -- `sale_discount` BİLEREK OKUNMUYOR.
   *
   * Resmî doküman kendi içinde çelişiyor:
   *   /concepts/products          -> "Discount amount in the product's
   *                                  currency" (float, PARA)
   *   /api-reference/products/search -> "Discount percentage applied to
   *                                  regular_price" (integer, YÜZDE)
   *
   * İkisi arasında seçim yapmak bir VARSAYIMDIR ve yanlış seçim doğrudan
   * yanlış indirim oranı göstermek demektir (₺150 indirimi %150 diye
   * basmak gibi). Alan, gerçek bir yanıtla hangisi olduğu ölçülene kadar
   * modele HİÇ girmiyor. Eksik bir alan görünür; yanlış bir alan değil.
   */

  return {
    providerId,
    barcode: barkod,
    barcodeDigits: barkodRakamlari(barkod),
    sku: metin(raw, ['sku', 'identifiers.sku']),
    name,
    description: metin(raw, ['description']),
    trackingUrl,
    trackingUrlKind,
    outclickUrl: outclick.url,
    affiliateUrl: ortaklik.url,
    directUrl: dogrudan.url,
    unresolvedLinkPlaceholders: outclick.bozuk || ortaklik.bozuk || dogrudan.bozuk,
    // Biçimi bozuk para birimi kodu TAŞINMAZ: `formatMoney` tanımadığı
    // kodu ham basar ve kullanıcı ekranda "XXX 1.299,00" görür.
    currency: paraBirimi && isCurrencyCode(paraBirimi) ? paraBirimi : null,
    regularPriceCents: kurus(raw, ['regular_price']),
    finalPriceCents: kurus(raw, ['final_price']),
    availability: stokDurumu(raw),
    stockQuantity: tamSayi(raw, ['stock_quantity']),
    brand: metin(raw, ['brand']),
    model: metin(raw, ['model', 'mpn', 'identifiers.mpn']),
    category: metin(raw, ['category']),
    // MENŞE ülke. Biçim doğrulanmaz -- doküman iki harfli kod mu ülke adı
    // mı olduğunu söylemiyor ve uydurulmuş bir biçim geçerli veriyi siler.
    originCountry: metin(raw, ['country']),
    condition: urunDurumu(raw),
    // `network` ve `merchant` sözleşmede birer OBJE; ad alt alanda.
    network: metin(raw, ['network.name']),
    merchant: metin(raw, ['merchant.name']),
    updatedAt: zaman(raw, ['updated_at']),
    // Yanıtta `added_at` YOKTUR; o ad yalnızca `sort_by` değeridir.
    addedAt: zaman(raw, ['started_at']),
    source: AFFILIATE_COM_ID,
  };
}

/**
 * Yanıt gövdesinden ürün dizisini bulur.
 *
 * Sözleşmedeki ad `data`; diğer adaylar savunma amaçlıdır. Hiçbiri
 * tutmazsa BOŞ dizi döner. Burada fırlatmak, sağlayıcının bir gün alan
 * adını değiştirmesi hâlinde aramanın tamamını düşürürdü -- oysa doğru
 * davranış "bu turda sonuç yok" deyip Ohaaaa katalog sonuçlarıyla devam
 * etmektir.
 */
function urunDizisi(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  for (const yol of ['data', 'products', 'results', 'items']) {
    const aday = yoldanOku(payload, yol);
    if (Array.isArray(aday)) return aday;
  }

  return [];
}

/** Bir filtre koşulu (`search[]` elemanı). */
interface AramaKosulu {
  field: string;
  value: string;
  operator: string;
}

/**
 * Çok değerli bir filtreyi TEK koşula çevirir.
 *
 * Sözleşme: aynı `value` içinde `||` mantıksal VEYA'dır; AYRI objeler ise
 * VE ile birleşir. Yani "TRY veya EUR" tek koşul, "marka=X ve fiyat<Y"
 * iki koşuldur.
 */
function veyaKosulu(field: string, degerler: readonly string[]): AramaKosulu | null {
  const temiz = [...new Set(degerler.map((d) => String(d).trim()).filter((d) => d !== ''))];
  if (temiz.length === 0) return null;

  return { field, value: temiz.join('||'), operator: '=' };
}

export const affiliateComProvider: ProductSearchProvider = {
  id: AFFILIATE_COM_ID,
  displayName: 'Affiliate.com',
  endpoint: AFFILIATE_COM_ENDPOINT,

  /**
   * İSTEK GÖVDESİ -- RESMÎ SÖZLEŞME.
   *
   * `search` bir DİZİDİR; her eleman `{field, value, operator}` taşır ve
   * elemanlar VE ile birleşir. Serbest metin `any` alanına `LIKE` ile
   * sorulur: doküman `any`'nin ad, açıklama, barkod, marka, kategori,
   * etiket, SKU ve ASIN üzerinde -- kök bulmayla (stemming) -- aradığını
   * söylüyor. `any` için `LIKE` DIŞINDA operatör tanımlı değildir.
   *
   * PAZAR DARALTMASI: `market` diye bir alan yok. Kapsam para birimi ve
   * AĞ/SATICI kimliğiyle kurulur -- ağlar bölgeseldir. Kod hiçbir ağ
   * kimliğini sabitlemez; çağıran `GET /v1/networks` ile bulup verir.
   */
  buildRequest(query: ProductSearchQuery): Record<string, unknown> {
    const search: AramaKosulu[] = [
      { field: 'any', value: query.query.trim(), operator: 'LIKE' },
    ];

    const paraBirimi = veyaKosulu('currency', (query.currencies ?? []).map((c) => c.toUpperCase()));
    if (paraBirimi) search.push(paraBirimi);

    const aglar = veyaKosulu('network.id', (query.networkIds ?? []).map(String));
    if (aglar) search.push(aglar);

    const saticilar = veyaKosulu('merchant.id', (query.merchantIds ?? []).map(String));
    if (saticilar) search.push(saticilar);

    const perPage = Math.min(
      Math.max(1, Math.trunc(query.perPage ?? AFFILIATE_COM_DEFAULT_PER_PAGE)),
      AFFILIATE_COM_MAX_PER_PAGE,
    );

    const govde: Record<string, unknown> = { search, per_page: perPage };

    // `page` yalnızca istendiğinde gönderilir: sözleşmenin alt sınırı 1,
    // üst sınırı plana bağlı. Gönderilmediğinde sağlayıcı ilk sayfayı verir.
    if (query.page !== undefined) govde.page = Math.max(1, Math.trunc(query.page));

    /*
     * `pool_id` ÇIPLAK ULID olmalı -- `pool_` öneki 422 döndürür.
     * Öneki burada sessizce kırpmıyoruz: yanlış biçimi düzeltmek, yanlış
     * yapılandırmayı gizlemek olurdu. Çağıran doğru değeri verir.
     */
    if (query.poolId && query.poolId.trim() !== '') govde.pool_id = query.poolId.trim();

    return govde;
  },

  parseResponse(payload: unknown): ExternalProduct[] {
    const urunler: ExternalProduct[] = [];

    for (const ham of urunDizisi(payload)) {
      const normalize = normalizeAffiliateComProduct(ham);
      if (normalize) urunler.push(normalize);
    }

    return urunler;
  },

  parseTotalCount(payload: unknown): number | null {
    const toplam = yoldanOku(payload, 'meta.total');

    if (typeof toplam === 'number' && Number.isFinite(toplam) && toplam >= 0) {
      return Math.trunc(toplam);
    }

    return null;
  },
};
