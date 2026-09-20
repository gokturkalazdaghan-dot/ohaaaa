/**
 * ÖDÜNÇ TEKLİF ARAMA SÖZLEŞMESİ — partner'dan istek anında ürün çekme.
 *
 * Karar belgesi: `docs/odunc-teklif-karari.md`. Bu dosya o belgenin kod
 * karşılığıdır; belgeyle çelişen bir satır varsa YANLIŞ OLAN BU DOSYADIR.
 *
 * ======================================================================
 * `AffiliateProvider` İLE KARIŞTIRILMAMALI
 * ======================================================================
 * `types.ts` içindeki `AffiliateProvider` PARANIN sözleşmesidir: postback
 * doğrulama, dönüşüm normalleştirme, deeplink. Bu dosya ÜRÜNÜN
 * sözleşmesidir: bir sorguya karşılık teklif listesi.
 *
 * İkisi ayrı tutuluyor çünkü aynı partner ikisinden yalnızca birini
 * destekleyebilir. Awin'in ürün arama API'si yok ama dönüşüm çekmesi var;
 * Amazon ve eBay'in tersi. Tek arayüzde birleştirmek, her partner'ın
 * yarısını "desteklenmiyor" fırlatan boş metotlarla doldurması demekti --
 * ve bir gün biri o boş metodu sessizce doldururdu.
 *
 * Kayıt (`registry.ts`), postback yolu, `/git/:offerId` ve `Fetcher` bu
 * dosyadan ETKİLENMEZ. Burada tanımlanan hiçbir şey onlara dokunmuyor.
 *
 * ======================================================================
 * BU DOSYA AĞA ÇIKMAZ, VERİTABANINA YAZMAZ
 * ======================================================================
 * Yalnızca tip ve saf fonksiyon. Partner adaptörleri bu sözleşmeyi
 * uygular; cache katmanı anahtarı buradan alır. Böylece anahtar üretimi
 * TEK yerde kalır: iki çağıran farklı anahtar üretirse aynı sorgu iki kez
 * partner'a gider ve isabet oranı sessizce çöker.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Hata
// ---------------------------------------------------------------------------

export type ProductSearchErrorCode =
  /** Sorgu ya da parametre geçersiz. Yeniden denemek düzeltmez. */
  | 'invalid_query'
  /** Partner kotası doldu. Bekleyip yeniden denemek düzeltir. */
  | 'quota_exceeded'
  /** Partner şu an cevap vermiyor (5xx, zaman aşımı, devre kesici açık). */
  | 'partner_unavailable'
  /** Partner bu pazarı/dili/işlemi desteklemiyor. Yeniden denemek düzeltmez. */
  | 'not_supported';

/**
 * `ProviderError`'dan AYRI bir sınıf.
 *
 * İkisini birleştirmek, "komisyon bildirimi doğrulanamadı" ile "arama
 * kotası doldu" hatalarını aynı `catch` bloğunda yakalatırdı. Birincisi
 * para kaybı, ikincisi geçici bir yavaşlama; aynı tepkiyi hak etmiyorlar.
 */
export class ProductSearchError extends Error {
  constructor(
    message: string,
    readonly code: ProductSearchErrorCode,
  ) {
    super(message);
    this.name = 'ProductSearchError';
  }
}

// ---------------------------------------------------------------------------
// Sabitler — karar belgesindeki değerlerin tek kopyası
// ---------------------------------------------------------------------------

/**
 * Cache anahtarının şema sürümü.
 *
 * NORMALİZASYON YA DA YÜK BİÇİMİ DEĞİŞİRSE ARTIRIN. Artırıldığında bütün
 * anahtarlar bir hamlede değişir, eski girdiler öksüz kalır ve ilk istek
 * partner'a gider. `onbellek.ts`'deki `KATALOG_SURUMU` ile aynı kalıp;
 * orada bu kaldıraç olmadığı için bir veri düzeltmesi bir saatten uzun
 * süre vitrine yansımamıştı.
 */
export const BORROWED_CACHE_KEY_VERSION = 'v1';

/**
 * Anahtara giren en büyük sayfa numarası.
 *
 * Derin sayfalama partner kotasını, dönüşüme gitmeyen trafik için yakar:
 * üçüncü sayfanın altındaki teklife pratikte kimse tıklamıyor. Sınırın
 * dışına çıkan istek SESSİZCE KIRPILMAZ, hata fırlatır -- kırpsaydık
 * 5. sayfayı isteyen 3. sayfayı alır ve bunu fark etmezdi.
 */
export const BORROWED_MAX_PAGE = 3;

/** Normalizasyondan sonra kalması gereken en az karakter. */
export const BORROWED_MIN_QUERY_LENGTH = 2;

/** Bu süre içinde sonuç TAZE sayılır ve doğrudan sunulur. */
export const BORROWED_FRESH_SECONDS = 900;

/**
 * Bunun ötesinde sonuç SUNULMAZ.
 *
 * 24 saat bir hedef değil, İHTİYATLI ÜST SINIR. Gerçek tavan her
 * partner'ın sözleşmesinde yazılı ve `affiliate_networks.contract_verified`
 * şu an hepsi için `false`. `partners.ts`'in kuralı burada da geçerli:
 * bilginin yokluğu olumsuz bir cevap değildir -- ama ihtiyatlı davranmayı
 * da engellemez.
 */
export const BORROWED_STALE_CEILING_SECONDS = 86_400;

// ---------------------------------------------------------------------------
// Sorgu normalizasyonu
// ---------------------------------------------------------------------------

/**
 * NFKD'nin ÇÖZEMEDİĞİ harfler.
 *
 * NFKD + aksan düşürme çoğu harfi halleder (`ü`→`u`, `ş`→`s`, `é`→`e`)
 * çünkü onlar taban harf + birleştirici işaret olarak ayrışır. Buradakiler
 * ayrışmaz; tek kod noktasıdırlar ve dokunulmazsa bir sonraki adımda
 * TAMAMEN DÜŞERLER. "kulaklık" → "kulaklk" olurdu: sonuç yine deterministik
 * ama "kulaklik" yazan kullanıcı BAŞKA bir anahtara düşerdi ve aynı sorgu
 * partner'a iki kez giderdi.
 */
const NFKD_COZMEYEN: Readonly<Record<string, string>> = {
  ı: 'i',
  ø: 'o',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ħ: 'h',
  ŧ: 't',
};

/**
 * Sorguyu cache anahtarı için normalleştirir.
 *
 * ADIM SIRASI SABİTTİR ve `BORROWED_CACHE_KEY_VERSION` ile sürümlenir:
 *   1. NFKD                      — `é` → `e` + birleştirici aksan
 *   2. Birleştirici işaretleri düşür
 *   3. Küçült (dilden bağımsız)
 *   4. NFKD'nin çözemediklerini katla
 *   5. Alfanümerik, boşluk, `-` ve `+` dışını boşluğa çevir
 *   6. Belirteçleri SIRALA ve tek boşlukla birleştir
 *
 * 6. adım "sony kulaklık" ile "kulaklık sony"yi aynı anahtara indirir:
 * ikisi partner'a giden AYNI istektir, iki ayrı anahtar iki ayrı kota
 * harcaması demekti.
 *
 * ======================================================================
 * BU `public.normalize_search` DEĞİLDİR -- BİLİNÇLİ
 * ======================================================================
 * `normalize_search` yalnızca Türkçe harfleri katlar (`init_schema.sql:53`);
 * `é`, `ñ`, `å` listesinde yok. Global bir vitrinde bu eksik.
 *
 * Deponun "iki doğruluk kaynağı ayrışır" kuralı burada GEÇERLİ DEĞİL,
 * çünkü ikisinin bedeli farklı:
 *   `normalize_search` → kendi kataloğumuzun tsvector'ünü besler.
 *                        Ayrışırsa YANLIŞ SONUÇ döner.
 *   bu fonksiyon       → yalnızca opak bir cache anahtarı üretir.
 *                        Ayrışırsa bedeli BİR CACHE ISKASI.
 * Bu yüzden iki fonksiyon ayrı ve aynı oldukları İDDİA EDİLMİYOR.
 */
export function normalizeSearchQuery(raw: string): string {
  const katlanmis = raw
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

  const harfler = [...katlanmis].map((ch) => NFKD_COZMEYEN[ch] ?? ch).join('');

  return harfler
    .replace(/[^a-z0-9+\- ]+/g, ' ')
    .split(' ')
    .filter((belirtec) => belirtec.length > 0)
    .sort()
    .join(' ');
}

// ---------------------------------------------------------------------------
// Cache anahtarı
// ---------------------------------------------------------------------------

export interface BorrowedCacheKeyInput {
  /** `affiliate_networks.code` — amazon, ebay, cj, impact, rakuten, awin… */
  partner: string;
  /** `markets.code` */
  market: string;
  /** ISO-4217 */
  currency: string;
  /** `locales.code` */
  locale: string;
  /** Kullanıcının yazdığı HAM sorgu. Normalizasyon burada yapılır. */
  query: string;
  /** 1 tabanlı. Varsayılan 1, en fazla `BORROWED_MAX_PAGE`. */
  page?: number;
}

/**
 * `ob:{v}:{partner}:{market}:{currency}:{locale}:{page}:{sha256(query)[0..15]}`
 *
 * NEDEN HER BİLEŞEN İÇERİDE
 *   partner  — iki partner aynı sorguya farklı cevap verir
 *   market   — aynı sorgu DE ve TR'de farklı ürün, farklı stok döndürür
 *   currency — `product_group_price_stats` yorumundaki ders: tek bir min()
 *              iki para birimini kıyaslarsa düşük mezhepli olan her zaman
 *              kazanır. O hatayı cache'e gömmemek için ayrı alan.
 *   locale   — partner başlıkları yerelleştirilmiş döner; CH tek para
 *              birimi ama üç dil, yani pazar dili türetmeye yetmez
 *   page     — partner tek sayfa döndürür; anahtarda olmazsa 2. sayfa
 *              1.'yi ezer
 *
 * NEDEN SIRALAMA VE FİLTRELER DIŞARIDA
 * Cache partner'ın HAM sonuç kümesini tutar; sıralama ve filtreleme bizim
 * kodumuzda, bellekte yapılır. İçeride olsalardı her filtre kombinasyonu
 * ayrı bir partner isteği olurdu: kardinalite patlar, kota yanar.
 *
 * NEDEN HAM SORGU DEĞİL ÖZET
 * Sorgu sınırsız uzunlukta ve çok baytlı; anahtar olarak taşınamaz. Özet
 * sabit uzunlukta. Ham sorgu KAYBOLMUYOR -- saklanan belgenin içinde
 * `queryNorm` olarak durur, yoksa bir anahtarın neyi temsil ettiği
 * incelenemezdi.
 */
export function buildBorrowedCacheKey(input: BorrowedCacheKeyInput): string {
  const sayfa = input.page ?? 1;

  if (!Number.isInteger(sayfa) || sayfa < 1 || sayfa > BORROWED_MAX_PAGE) {
    throw new ProductSearchError(
      `Sayfa 1 ile ${BORROWED_MAX_PAGE} arasinda bir tam sayi olmali; gelen: ${String(input.page)}.`,
      'invalid_query',
    );
  }

  const queryNorm = normalizeSearchQuery(input.query);

  /*
   * BOŞ SORGU ANAHTAR ÜRETMEZ.
   *
   * Üretseydi "!!!", "   " ve "***" aynı anahtara düşer, hepsi tek bir
   * anlamsız sonuç kümesini paylaşır ve o kümeyi kim yazdıysa onu
   * herkese sunardık.
   */
  if (queryNorm.length < BORROWED_MIN_QUERY_LENGTH) {
    throw new ProductSearchError(
      'Normalizasyondan sonra sorgudan anlamli bir sey kalmadi.',
      'invalid_query',
    );
  }

  const ozet = createHash('sha256').update(queryNorm, 'utf8').digest('hex').slice(0, 16);

  return [
    'ob',
    BORROWED_CACHE_KEY_VERSION,
    input.partner.toLowerCase(),
    input.market.toUpperCase(),
    input.currency.toUpperCase(),
    input.locale.toLowerCase(),
    String(sayfa),
    ozet,
  ].join(':');
}

// ---------------------------------------------------------------------------
// Tazelik
// ---------------------------------------------------------------------------

export type BorrowedFreshness =
  /** Doğrudan sunulur. */
  | 'taze'
  /** Sunulur AMA gözlem zamanı ekranda görünmeli ve tazeleme tetiklenmeli. */
  | 'bayat'
  /** Fiyat SUNULMAZ. Girdi yok sayılır. */
  | 'suresi_doldu';

/**
 * Üç durumu TEK yerde hesaplar.
 *
 * Her çağıranın `Date.now() - fetchedAt > ...` yazması, eşiklerden birinin
 * bir yerde farklı kalması demekti; ve farklı kalan yer, bayat fiyatı
 * güncelmiş gibi gösteren yer olurdu.
 *
 * `bayat` sunmanın üç şartı karar belgesinde (§4) yazılı ve bu fonksiyon
 * onları uygulamaz, yalnızca durumu söyler: gözlem zamanını ekrana basmak,
 * tazeleme arızasını SAYMAK (yutmamak) ve giden linki canlı tutmak
 * çağıranın işi.
 */
export function borrowedFreshness(
  fetchedAt: Date | string,
  now: Date = new Date(),
): BorrowedFreshness {
  const gozlem = typeof fetchedAt === 'string' ? new Date(fetchedAt) : fetchedAt;

  if (Number.isNaN(gozlem.getTime())) {
    throw new ProductSearchError('Gecersiz gozlem zamani.', 'invalid_query');
  }

  const gecenSaniye = (now.getTime() - gozlem.getTime()) / 1000;

  /*
   * GELECEK TARİHLİ GÖZLEM BAYAT SAYILIR, TAZE DEĞİL.
   *
   * Saat kayması ya da bozuk bir partner zaman damgası negatif süre
   * üretir. Bunu "çok taze" saymak, süresi hiç dolmayan bir girdi
   * yaratırdı -- yani cache'in tek güvenlik supabını kapatırdı.
   */
  if (gecenSaniye < 0) return 'bayat';

  if (gecenSaniye <= BORROWED_FRESH_SECONDS) return 'taze';
  if (gecenSaniye <= BORROWED_STALE_CEILING_SECONDS) return 'bayat';
  return 'suresi_doldu';
}

// ---------------------------------------------------------------------------
// Sözleşme
// ---------------------------------------------------------------------------

export interface BorrowedOfferQuery {
  /** Kullanıcının yazdığı HAM sorgu. */
  query: string;
  /** `markets.code` */
  market: string;
  /** ISO-4217 */
  currency: string;
  /** `locales.code` */
  locale: string;
  /** 1 tabanlı, en fazla `BORROWED_MAX_PAGE`. */
  page?: number;
}

/**
 * Partner'dan gelen TEK bir teklif — ödünç, kalıcı değil.
 *
 * `products` tablosunun satırı DEĞİLDİR ve oraya yazılmaz. Alan listesi
 * bilinçli olarak dar: burada olmayan her alan, bir gün birinin bu nesneyi
 * `products`'a çevirmeye çalışmasını zorlaştırır.
 *
 * ======================================================================
 * "BİLİNMİYOR" İLE "SIFIR" AYRI
 * ======================================================================
 * `shippingFeeCents` ve `inStock` null OLABİLİR ve null "bilinmiyor"
 * demektir, "bedava" ya da "stokta yok" değil.
 *
 * Sebep doğrudan sıralamadır. Bu sitenin sıralama ölçütü ürün + KARGO
 * toplamı (`docs/architecture.md` §3). Bilinmeyen kargoyu 0 saymak, kargo
 * bilgisini vermeyen her partner'ı listenin başına taşırdı -- ve
 * kullanıcı ödeme adımında sürprizle karşılaşırdı. Tam olarak o kararın
 * engellemek için verildiği durum.
 */
export interface BorrowedOffer {
  /** Partner'ın kendi teklif/ürün kimliği. Bizim değil. */
  partnerOfferId: string;
  title: string;
  brand: string | null;
  /** Kanonik eşleştirmenin en güvenilir girdisi. Yoksa imzaya düşülür. */
  gtin: string | null;

  priceCents: number;
  /** ISO-4217. Sorgudakinden FARKLI olabilir; çağıran kıyas yapmadan önce bakmalı. */
  currency: string;
  /** null = partner söylemedi. 0 DEĞİL. */
  shippingFeeCents: number | null;
  /** null = partner söylemedi. false DEĞİL. */
  inStock: boolean | null;

  imageUrl: string | null;
  /** Satıcının adı — ekranda "şu mağazada" diye gösterilen şey. */
  merchantName: string;
  /** Mağazadaki ürün sayfası. Giden link bundan türetilir. */
  productUrl: string;

  /** `affiliate_networks.code`. Hangi partner'dan ödünç alındığı. */
  partner: string;
  /** ISO-8601. Fiyatın GÖZLENDİĞİ an; ekranda gösterilmek zorunda. */
  observedAt: string;
}

/**
 * Bir partner'ın ürün arama adaptörü.
 *
 * TEK METOT. Sayfalama, sıralama, filtreleme, cache, kota ve kanonik
 * eşleştirme BURADA DEĞİL -- adaptörün tek işi partner'ın cevabını
 * `BorrowedOffer` listesine çevirmek.
 *
 * Yeni partner eklemek = bu arayüzü uygulayan bir dosya. Kayıt tablosuna
 * satır, CHECK kısıtı ve kota defteri ayrı adımlar; hiçbiri bu arayüzü
 * değiştirmez.
 *
 * `search` AĞA ÇIKAR, dolayısıyla saf değildir. Ağ istemcisi adaptörün
 * kendi bağımlılığıdır: feed indiricisi (`Fetcher`, 2 sn nezaket
 * gecikmesi, 30 sn zaman aşımı) ile istek anındaki aramanın bütçesi aynı
 * olamaz, bu yüzden o sözleşme burada YENİDEN KULLANILMIYOR.
 */
export interface ProductSearchProvider {
  /** `affiliate_networks.code` */
  readonly network: string;
  readonly displayName: string;

  /**
   * Partner'ı sorgular.
   *
   * Boş dizi DÖNEBİLİR: "bu sorguya sonuç yok" geçerli bir cevaptır ve
   * hata değildir. Hata yalnızca `ProductSearchError` ile bildirilir --
   * boş dizi ile hatayı aynı şeye indirmek, kota dolduğunda "ürün
   * bulunamadı" göstermek olurdu.
   */
  search(query: BorrowedOfferQuery): Promise<BorrowedOffer[]>;
}
