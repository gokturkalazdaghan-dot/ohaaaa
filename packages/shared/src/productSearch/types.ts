/**
 * TALEP ANINDA ÜRÜN ARAMA (on-demand product search) sözleşmesi.
 *
 * ======================================================================
 * BU KATMAN, `../providers/` İLE AYNI ŞEY DEĞİLDİR
 * ======================================================================
 * `../providers/` bir ortaklık ağının DÖNÜŞÜM tarafını tanımlar: postback
 * doğrulama, dönüşüm normalizasyonu, deeplink biçimi. Awin oraya bağlıdır
 * ve besleme (feed) alımı da o yoldan beslenir.
 *
 * Buradaki sözleşme bambaşka bir soruya cevap verir: "kullanıcı şu anda bir
 * şey aradı; katalogda OLMAYAN bir kaynaktan, İSTEK ANINDA sonuç
 * getirebilir miyiz?"
 *
 * İkisi kasıtlı olarak ayrı tutuldu. Aynı arayüze sıkıştırmak, çalışan
 * Awin/feed hattını yeni bir kaynağın ihtiyaçlarına göre değiştirmek
 * demekti; bu hat para taşıyor ve değiştirilmesi için bir sebep yok.
 *
 * ----------------------------------------------------------------------
 * VERİ NEREDE DURUR: HİÇBİR YERDE (KISA ÖNBELLEK DIŞINDA)
 * ----------------------------------------------------------------------
 * Bu katmandan geçen ürünler Supabase'e YAZILMAZ. Katalog aynası
 * kurulmaz, `products` tablosuna kalıcı alım yapılmaz. Sebep hem hukuki
 * (ortak şartları genellikle katalog kopyasına izin vermez) hem teknik:
 * aynalanan bir katalog, tazeliği bizim sorumluluğumuza geçirir ve bayat
 * fiyat göstermek karşılaştırma sitesinin yapabileceği en pahalı hatadır.
 *
 * Tek istisna, okuma anında tutulan KISA ömürlü önbellektir (bkz.
 * `cacheKey.ts`) ve süresi merkezî olarak sınırlanmıştır.
 */

/**
 * Stok durumu.
 *
 * `unknown` AYRI BİR DEĞERDİR ve bilerek öyle: "bilmiyoruz" ile "stokta
 * yok" aynı şey değildir. İkisini birleştirmek, sağlayıcının alanı hiç
 * göndermediği her üründe kullanıcıya olmayan bir bilgi söylemek olurdu.
 *
 * Affiliate.com üç değer tanımlıyor -- `InStock`, `OutOfStock`, `Unknown`
 * -- ve alan `null` da olabiliyor. `Unknown` ile `null` burada aynı yere
 * düşer: ikisi de "bilmiyoruz"dur.
 *
 * `preorder`/`backorder` SÖZLEŞMEDE YOK. Model onları taşımaya devam
 * ediyor çünkü bu katman tek sağlayıcıya bağlı değil; Affiliate.com
 * adaptörü onları hiçbir zaman üretmez.
 */
export type ProductAvailability = 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' | 'unknown';

/**
 * Ürün durumu. `unknown` gerekçesi `ProductAvailability` ile aynı.
 *
 * `open-box` Affiliate.com'un resmî listesindedir (`new`, `used`,
 * `refurbished`, `open-box`) ve kendi adıyla taşınır. `used`'a katlamak
 * fiyat karşılaştırmasında yanlış olurdu: açılmış kutu ile kullanılmış
 * ürün aynı şey değildir ve kullanıcı için farkı paradır.
 */
export type ProductCondition = 'new' | 'used' | 'refurbished' | 'open-box' | 'unknown';

/**
 * Tıklama için kullanılabilecek adresin TÜRÜ.
 *
 * `outclick` tercih edilir: yer tutucu taşımaz ve Affiliate.com'un
 * tıklamayı KAYDETTİĞİ tek adres odur (resmî doküman). `affiliate` ağın
 * kendi linkidir ve raporlamaya girmez.
 */
export type TrackingUrlKind = 'outclick' | 'affiliate';

/**
 * Dış kaynaktan gelen, Ohaaaa modeline normalize edilmiş ürün.
 *
 * TUTARLAR KURUŞ (tam sayı). Kayan noktalı para hesabı yapılmaz -- ortak
 * gerekçe `providers/types.ts` içinde yazılı.
 *
 * ALANLAR UYDURULMAZ. Sağlayıcı bir alanı göndermiyorsa karşılığı `null`
 * kalır. Varsayılan değer koymak (ör. para birimi yoksa 'TRY') sessizce
 * yanlış fiyat göstermenin en kolay yoludur.
 */
export interface ExternalProduct {
  /** Sağlayıcının kendi ürün kimliği. Bizim kimliğimiz DEĞİLDİR. */
  providerId: string;
  /**
   * Barkod -- sağlayıcının GÖNDERDİĞİ HÂLİYLE, harfi harfine.
   *
   * RAKAMLARA İNDİRGENMEZ. Resmî doküman iki şey söylüyor ve ikisi de bu
   * kararı zorunlu kılıyor: alan UPC/EAN/GTIN **ya da ISBN** olabilir ve
   * `barcode` **büyük/küçük harfe duyarlıdır**. ISBN-10'un kontrol
   * basamağı `X` olabilir; rakam süzgeci onu sessizce siler ve geriye
   * geçersiz, kimseyle eşleşmeyen bir kod bırakır.
   *
   * Sağlayıcıya geri sorgu atarken (`barcode` alanı, `=` operatörü) bu
   * ham değer kullanılır -- süzülmüş hâli eşleşmez.
   */
  barcode: string | null;
  /**
   * Barkodun yalnızca RAKAMLARDAN oluşan hâli -- kanonik ürün
   * eşleştirmesi için KOLAYLIK alanı.
   *
   * Burada GS1 kontrol basamağı doğrulanmaz ve 14 haneye DOLDURULMAZ.
   * O kural zaten iki yerde yazılı ve ikisi de burayı önceler --
   * `packages/ingest/src/normalize.ts#normalizeGtin` ve veritabanındaki
   * `public.normalize_gtin`. Üçüncü bir kopya, zamanla ayrışacak üçüncü
   * bir doğruluk kaynağı demekti.
   *
   * Rakam dışı karakter taşıyan barkodlarda (ISBN-10'un `X`'i) `null`
   * kalır: yarısı silinmiş bir kod vermektense hiç vermemek doğrudur.
   */
  barcodeDigits: string | null;
  /** Sağlayıcının stok kodu. Büyük/küçük harfe duyarlı. */
  sku: string | null;
  name: string;
  description: string | null;
  /**
   * TIKLAMA İÇİN KULLANILACAK ADRES -- çağıranın bakacağı TEK alan.
   *
   * Öncelik sırası resmî dokümandan gelir:
   *   1. `urls.outclick` -- yer tutucu taşımaz, hazırdır ve
   *      Affiliate.com'un tıklamayı KAYDETTİĞİ tek adrestir.
   *   2. `urls.affiliate` (ya da legacy `commission_url`) -- YALNIZCA
   *      içinde çözülmemiş yer tutucu yoksa.
   *
   * İkisi de yoksa `null`. Buraya ASLA `direct_url` düşmez: komisyonsuz
   * bir adresi "ortaklık linki" diye sunmak, trafiği bedavaya vermektir.
   */
  trackingUrl: string | null;
  /** `trackingUrl` hangi kaynaktan geldi? `null` ise adres yok. */
  trackingUrlKind: TrackingUrlKind | null;
  /** `urls.outclick` -- varsa. */
  outclickUrl: string | null;
  /**
   * `urls.affiliate` ya da legacy `commission_url`.
   *
   * ÇÖZÜLMEMİŞ YER TUTUCU İÇEREN ADRES BURAYA GİRMEZ -- `null` olur ve
   * `unresolvedLinkPlaceholders` işaretlenir. Bu bir varsayım değil,
   * resmî dokümanla doğrulanmış bir gerekçedir: rapor sayfası
   * (`/api-reference/reports/outclick`) doldurulmamış `@@@`/`###`
   * değerlerinin tıklama kaydına HARFİ HARFİNE yazıldığını, dolayısıyla
   * atıfın koptuğunu söylüyor.
   */
  affiliateUrl: string | null;
  /** Mağazanın kendi ürün sayfası (komisyonsuz, takipsiz). */
  directUrl: string | null;
  /**
   * Bir ortaklık adresi çözülmemiş yer tutucu (`@@@`, `###`, `{…}`)
   * taşıdığı için düşürüldü mü?
   *
   * Arayüzün ve operatörün bunu görmesi gerekir: "link yok" ile "link
   * vardı ama kullanılamaz durumdaydı" farklı iki arızadır. İkincisi
   * `networks` parametresinin eksik olduğunu söyler (bkz. `affiliateCom.ts`).
   */
  unresolvedLinkPlaceholders: boolean;
  /** ISO-4217, üç harf, büyük harf. Sağlayıcı vermediyse `null`. */
  currency: string | null;
  /** Liste (indirimsiz) fiyat, kuruş. */
  regularPriceCents: number | null;
  /** Ödenecek fiyat, kuruş. */
  finalPriceCents: number | null;
  availability: ProductAvailability;
  stockQuantity: number | null;
  brand: string | null;
  model: string | null;
  /** Sağlayıcının kendi kategori metni. Ohaaaa taksonomisine EŞLENMEZ. */
  category: string | null;
  /**
   * MENŞE ÜLKE -- ürünün üretildiği ülke.
   *
   * PAZAR / TESLİMAT ÜLKESİ DEĞİLDİR. Resmî doküman bu alanı "Country of
   * origin" diye tanımlıyor. Pazar daraltması bambaşka bir mekanizmadan
   * yapılır (bkz. `ProductSearchQuery`): para birimi ve AĞ kimliği --
   * çünkü ağların kendisi bölgeseldir ("Awin UK", "Impact US").
   *
   * Biçim DOĞRULANMAZ ve normalize edilmez: doküman iki harfli kod mu,
   * ülke adı mı olduğunu söylemiyor. Doğrulanmamış bir biçim dayatmak,
   * "Türkiye" yazan her satırı sessizce silmek olurdu.
   */
  originCountry: string | null;
  condition: ProductCondition;
  /** Ürünün geldiği ortaklık ağının ADI (`network.name`). */
  network: string | null;
  /** Satıcı/mağaza ADI (`merchant.name`). */
  merchant: string | null;
  /** ISO-8601 -- besleme verisinin son tazelenme anı (`updated_at`). */
  updatedAt: string | null;
  /**
   * ISO-8601 -- ürünün satıcının beslemesinde İLK göründüğü an.
   *
   * Kaynağı `started_at`'tır. Yanıtta `added_at` DİYE BİR ALAN YOKTUR;
   * o ad yalnızca `sort_by` değeri olarak geçer.
   */
  addedAt: string | null;
  /**
   * Bu ürünü getiren sağlayıcının kimliği (`ProductSearchProvider.id`).
   *
   * Sonuçlar ileride birden çok kaynaktan birleştirilirse, hangi satırın
   * nereden geldiği kaybolmamalı: atıf, hata ayıklama ve ortak şartlarına
   * uyum bu alana bakar.
   */
  source: string;
}

/**
 * Bir arama isteği.
 *
 * ======================================================================
 * "PAZAR" DİYE BİR ALAN YOK -- VE OLMAMALI
 * ======================================================================
 * İlk tasarımda burada `market` ve `country` vardı; ikisi de resmî
 * sözleşmeyle ÇELİŞİYORDU ve kaldırıldılar:
 *
 *   • Affiliate.com'da `market` diye bir arama alanı YOKTUR.
 *   • Ürünün `country` alanı MENŞE ÜLKEDİR (bkz. `ExternalProduct`),
 *     pazar değil. Onu pazar filtresi sanmak, "Türkiye'ye satan
 *     mağazalar" yerine "Türkiye'de üretilmiş ürünler" aramak olurdu --
 *     kullanıcıya sessizce bambaşka bir sonuç kümesi göstermek.
 *
 * Türkiye + Avrupa + Körfez kapsamı gerçekte İKİ mekanizmayla kurulur:
 *
 *   1. PARA BİRİMİ (`currencies`) -- `currency` alanı `=` ile aranır.
 *   2. AĞ / SATICI (`networkIds`, `merchantIds`, `poolId`) -- ağların
 *      KENDİSİ bölgeseldir ("Awin UK", "Impact US"; `region` ve
 *      `country` taşırlar). Hangi ağın hangi ülkeye ait olduğu
 *      `GET /v1/networks` ile öğrenilir; bu depo o listeyi TAHMİN ETMEZ.
 *
 * `poolId` üçüncü ve en kalıcı yoldur: ağ/satıcı kümesi Affiliate.com
 * tarafında adlandırılıp saklanır, her istekte liste tekrarlanmaz.
 */
export interface ProductSearchQuery {
  /** Kullanıcının yazdığı metin. Normalizasyonu çağıran yapar. */
  query: string;
  /**
   * ISO-4217 kodları. Birden fazlası VEYA (OR) olarak birleşir.
   *
   * Pazar daraltmasının birinci ayağı: TRY / EUR / AED / SAR …
   */
  currencies?: string[];
  /**
   * `network.id` listesi -- `GET /v1/networks` ile bulunur.
   *
   * Kod hiçbir ağ kimliğini SABİTLEMEZ: doğrulanmamış bir kimlik, yanlış
   * ülkenin sonuçlarını doğru diye göstermek demektir.
   */
  networkIds?: number[];
  /** `merchant.id` listesi. */
  merchantIds?: number[];
  /**
   * Affiliate.com'da tanımlı ağ/satıcı kümesi -- ÇIPLAK ULID.
   *
   * `pool_` ÖNEKİ İLE GÖNDERİLMEZ: resmî doküman önekli hâlin 422
   * döndüğünü açıkça yazıyor.
   */
  poolId?: string;
  /** Sayfa başına sonuç (`per_page`). Üst sınır abonelik planına bağlıdır. */
  perPage?: number;
  /** Sayfa numarası (`page`), 1'den başlar. */
  page?: number;
}

/** Bir arama turunun sonucu. */
export interface ProductSearchResult {
  products: ExternalProduct[];
  /** Hangi sağlayıcı (`ProductSearchProvider.id`). */
  source: string;
  /**
   * Eşleşen TOPLAM ürün (`meta.total`). Sağlayıcı bildirmediyse `null`.
   *
   * Sayfalama kararı buna bakar; sonuç dizisinin uzunluğuna değil.
   */
  totalCount: number | null;
}

export type ProductSearchErrorCode =
  /** Kimlik bilgisi yok: hiçbir ağ isteği YAPILMADI. */
  | 'not_configured'
  /** 401 / 403 — anahtar yanlış ya da yetkisiz. */
  | 'unauthorized'
  /**
   * 400 / 422 — İSTEĞİMİZ sağlayıcının sözleşmesine uymadı.
   *
   * Bu BİZİM hatamızdır ve tekrar denemek düzeltmez. Kodda bir şey
   * değişmeli.
   */
  | 'invalid_request'
  /**
   * 422 — ABONELİK KOTASI TÜKENDİ.
   *
   * `invalid_request` ile aynı durum kodunu paylaşır ama bambaşka bir
   * şeydir ve AYRI EYLEM gerektirir: kodda düzeltilecek bir hata yok,
   * planın yükseltilmesi ya da dönemin dolması gerekiyor. İkisini tek
   * kodda birleştirmek, operatörü olmayan bir hatayı aramaya gönderirdi.
   *
   * Ayrım YANIT METNİNDEN çıkarılır ve bu bir SEZGİDİR: resmî doküman
   * iki durumu aynı kodla anlatıyor ama ayırt edici bir alan tanımlamıyor.
   * Gerçek anahtarla doğrulanmalı.
   */
  | 'quota_exhausted'
  /** 429 — dakikalık istek hızı sınırı. */
  | 'rate_limited'
  /** 5xx — sağlayıcı geçici olarak yok. */
  | 'unavailable'
  /** Zaman aşımı. */
  | 'timeout'
  /** Bağlantı kurulamadı. */
  | 'network'
  /** Yanıt geldi ama okunamadı / beklenen biçimde değildi. */
  | 'bad_response';

/**
 * Dış arama hatası.
 *
 * `status` ve `retryAfterSeconds` TAŞINIR ama MESAJA GÖMÜLMEZ: çağıran
 * taraf kararını sayıya bakarak verir, metni ayrıştırarak değil.
 *
 * HATA METNİNDE ASLA: API anahtarı, `authorization` başlığı, yanıt gövdesi.
 * Gövde sağlayıcının hata metnini yankılayabilir ve o metin isteğimizi --
 * dolayısıyla kimlik bilgisini -- içerebilir.
 */
export class ProductSearchError extends Error {
  constructor(
    message: string,
    readonly code: ProductSearchErrorCode,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProductSearchError';
  }
}

/**
 * Bir talep-anı arama sağlayıcısı.
 *
 * ÜÇ SORUMLULUK AYRI:
 *   1. buildRequest  — Ohaaaa sorgusu → sağlayıcının istek gövdesi
 *   2. parseResponse — sağlayıcının yanıtı → `ExternalProduct[]`
 *   3. metadata      — kimlik ve uç nokta
 *
 * HİÇBİRİ AĞA ÇIKMAZ. Ağ işi `client.ts` içindedir ve ayrı olması
 * kasıtlı: böylece normalizasyon, gerçek kimlik bilgisi olmadan ve gerçek
 * istek atmadan birim testiyle doğrulanabilir.
 */
export interface ProductSearchProvider {
  /** Kısa kimlik. Önbellek anahtarına ve `ExternalProduct.source`'a girer. */
  readonly id: string;
  readonly displayName: string;
  /** Varsayılan uç nokta. Ortamdan ezilebilir (staging için). */
  readonly endpoint: string;

  /** Sorguyu sağlayıcının JSON gövdesine çevirir. */
  buildRequest(query: ProductSearchQuery): Record<string, unknown>;

  /**
   * Yanıtı ortak modele çevirir.
   *
   * Okunamayan TEK bir ürün, bütün turu düşürmez: o satır atlanır. Bir
   * alanı beklenmedik biçimde gelen tek ürün yüzünden aramanın tamamını
   * kaybetmek, kullanıcı için çok daha kötü bir sonuçtur.
   */
  parseResponse(payload: unknown): ExternalProduct[];

  /** Yanıttaki toplam eşleşme sayısı (`meta.total`). Bulunamazsa `null`. */
  parseTotalCount(payload: unknown): number | null;
}
