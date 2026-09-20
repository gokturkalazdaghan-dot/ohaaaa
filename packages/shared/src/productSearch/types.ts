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
 */
export type ProductAvailability = 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' | 'unknown';

/** Ürün durumu. `unknown` gerekçesi `ProductAvailability` ile aynı. */
export type ProductCondition = 'new' | 'used' | 'refurbished' | 'unknown';

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
   * Barkod -- sağlayıcı ne gönderdiyse, YALNIZCA rakamlara indirgenmiş
   * hâli. Burada GS1 kontrol basamağı doğrulanmaz ve 14 haneye
   * DOLDURULMAZ.
   *
   * Sebep: o kural zaten iki yerde yazılı ve ikisi de burayı önceler --
   * `packages/ingest/src/normalize.ts#normalizeGtin` ve veritabanındaki
   * `public.normalize_gtin`. Üçüncü bir kopya, zamanla ayrışacak üçüncü
   * bir doğruluk kaynağı demekti. Okuma anında kanonik ürün eşleştirmesi
   * yapılacaksa bu değer o yollardan birine verilir.
   */
  barcode: string | null;
  /** Sağlayıcının stok kodu. */
  sku: string | null;
  name: string;
  description: string | null;
  /**
   * Komisyonlu (ortaklık) adres.
   *
   * ÇÖZÜLMEMİŞ YER TUTUCU İÇEREN ADRES BURAYA GİRMEZ -- `null` olur ve
   * `unresolvedLinkPlaceholders` işaretlenir. Gerekçe `affiliateCom.ts`
   * içinde uzun uzun yazılı: yer tutucunun nasıl doldurulduğu
   * DOĞRULANMADAN link üretmek, sessiz gelir kaybı üretir.
   */
  commissionUrl: string | null;
  /** Mağazanın kendi ürün sayfası (komisyonsuz). */
  directUrl: string | null;
  /**
   * `commissionUrl` çözülmemiş bir yer tutucu (`@@@`, `###` …) içerdiği
   * için düşürüldü mü?
   *
   * Arayüzün ve operatörün bunu görmesi gerekir: "link yok" ile "link
   * vardı ama kullanılamaz durumdaydı" farklı iki arızadır.
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
  /** ISO-3166-1 alpha-2, büyük harf. */
  country: string | null;
  condition: ProductCondition;
  /** Ürünün geldiği ortaklık ağı (sağlayıcının bildirdiği). */
  network: string | null;
  /** Satıcı/mağaza adı. */
  merchant: string | null;
  /** ISO-8601. */
  updatedAt: string | null;
  /** ISO-8601. */
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
 * PAZAR/ÜLKE FİLTRESİ SÖZLEŞMEDE, TELDE DEĞİL.
 *
 * Türkiye + Avrupa + Körfez kapsamı ürün kararıdır ve bu arayüz onu
 * taşır. Ama bir alanın İSTEK GÖVDESİNE yazılması, sağlayıcının o filtreyi
 * gerçekten desteklediği DOĞRULANDIKTAN sonra olur. Doğrulanmamış bir
 * filtre göndermek iki şekilde başarısız olur ve ikisi de sessizdir: ya
 * yok sayılır (filtresiz sonuç, filtreliymiş gibi gösterilir) ya da 422
 * alınır (arama hiç çalışmaz). Bkz. `affiliateCom.ts` -> `buildRequest`.
 */
export interface ProductSearchQuery {
  /** Kullanıcının yazdığı metin. Normalizasyonu çağıran yapar. */
  query: string;
  /** Ohaaaa pazar kodu (`market.ts` -> `Market`). */
  market?: string;
  /** ISO-3166-1 alpha-2. */
  country?: string;
  /** ISO-4217. */
  currency?: string;
  /** Sağlayıcının ağ adı ile daraltma. */
  network?: string;
  /** Satıcı/mağaza ile daraltma. */
  merchant?: string;
  /** En fazla kaç sonuç. Sağlayıcı daha azını döndürebilir. */
  limit?: number;
}

/** Bir arama turunun sonucu. */
export interface ProductSearchResult {
  products: ExternalProduct[];
  /** Hangi sağlayıcı (`ProductSearchProvider.id`). */
  source: string;
}

export type ProductSearchErrorCode =
  /** Kimlik bilgisi yok: hiçbir ağ isteği YAPILMADI. */
  | 'not_configured'
  /** 401 / 403 — anahtar yanlış ya da yetkisiz. */
  | 'unauthorized'
  /** 422 — isteğimiz sağlayıcının sözleşmesine uymadı. */
  | 'invalid_request'
  /** 429 — hız sınırı. */
  | 'rate_limited'
  /** 503 / 5xx — sağlayıcı geçici olarak yok. */
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
}
