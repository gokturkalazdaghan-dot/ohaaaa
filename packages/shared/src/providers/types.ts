/**
 * Ortaklık ağı (provider) sözleşmesi.
 *
 * NEDEN AYRI BİR KATMAN
 * Önceki hâlde `/api/postback/:merchant` tek bir generic şema ve tek bir HMAC
 * şeması varsayıyordu. `merchants.network` sütunu veritabanında duruyor ama
 * çalışma anında hiç okunmuyordu; yani "bu Awin mi, direct mi" sorusunun
 * cevabı yoktu ve ağa özgü davranışın yaşayacağı bir yer de yoktu.
 *
 * Bu dosya o yeri tanımlar. Yeni bir ağ eklemek = yeni bir dosya + registry'ye
 * bir satır. `/git/:offerId`, `clicks`, `conversions` ve open-redirect
 * savunması değişmeden kalır.
 *
 * DÖRT SORUMLULUK AYRI TUTULUR:
 *   1. verifyPostback     — bildirim gerçekten bu ağdan mı geldi
 *   2. normalizePostback  — ağın alan adları → ortak model
 *   3. buildDeeplink      — yalnızca ağın özel biçimi gerekiyorsa
 *   4. metadata           — ağın kimliği
 *
 * 1 ve 2'nin ayrı olması kritiktir: doğrulanmamış bir gövdeyi ayrıştırmak,
 * saldırganın belirlediği veriyi ortak modele sokmak demektir. Çağıran önce
 * doğrular, sonra normalize eder.
 */

/** Dönüşüm durumları — `public.conversion_status` enum'uyla birebir. */
export type ConversionStatus = 'pending' | 'approved' | 'rejected' | 'paid';

/**
 * Ağ bağımsız dönüşüm modeli.
 *
 * Tutarlar KURUŞ (tam sayı). Kayan noktalı para hesabı yapılmaz: 0.1 + 0.2
 * ikilik tabanda 0.30000000000000004'tür ve komisyon mutabakatında bu fark
 * gerçek paradır.
 */
export interface NormalizedConversion {
  /** Ağın sipariş kimliği — idempotentlik anahtarının yarısı. */
  orderId: string;
  /** Bizim tıklama kimliğimiz. Ağ döndürmediyse null. */
  subid: string | null;
  status: ConversionStatus;
  orderTotalCents: number;
  commissionCents: number;
  /** ISO-4217, üç harf, büyük harfe normalize edilmiş. */
  currency: string;
  /** ISO-8601. */
  occurredAt: string;
}

export interface PostbackContext {
  /**
   * HAM gövde. JSON.parse edilip yeniden serileştirilmiş hâli DEĞİL:
   * baytlar değişir ve imza tutmaz.
   */
  rawBody: string;
  /** İstek başlıkları (Headers benzeri, salt okunur). */
  headers: { get(name: string): string | null };
  /** `merchants.postback_secret`. Yalnızca sunucuda okunur. */
  secret: string;
}

export interface DeeplinkContext {
  /** `merchants.deeplink_template` */
  template: string;
  /** Mağazadaki ürün sayfası */
  productUrl: string;
  /** Yayıncı kimliğimiz (`merchants.tracking_id`) */
  trackingId: string | null;
  /** Bu tıklama için üretilmiş izleme kimliği */
  subid: string;
  /** Yönlendirmenin çıkabileceği alan adları */
  allowedHosts: string[];
}

export type ProviderErrorCode =
  | 'unknown_network'
  | 'verification_unavailable'
  | 'invalid_payload'
  | 'unsupported_status';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: ProviderErrorCode,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Dönüşüm bu ağdan BİZE mi gelir, yoksa biz mi ÇEKERİZ?
 *
 * NEDEN SÖZLEŞMEDE
 * Postback sırrı zorunluluğu şimdiye kadar ağdan bağımsız uygulanıyordu ve
 * bu, bir varsayımdı: "her ağ imzalı bildirim gönderir". Awin için YANLIŞ --
 * Awin'in yayıncı bildirimi imzasız (resmî doküman: callback URL'i panele
 * yazılır, imza/HMAC yoktur) ve asıl yol Transactions API'sinden ÇEKMEKTİR.
 *
 * Bu alan o varsayımı sözleşmeye taşır: her ağ kendi yolunu söyler, route
 * da ona göre davranır. Böylece Awin'den sır beklenmez, imzalı ağların
 * (direct, ileride CJ/Impact) doğrulaması ise hiç gevşemez.
 */
export type ConversionSource = 'postback' | 'pull';

/**
 * Ağın raporundan ÇEKİLMİŞ dönüşüm.
 *
 * `NormalizedConversion`'dan tek farkı: hangi reklamverene ait olduğunu da
 * taşır. Postback'te bunu URL'deki mağaza söyler; çekmede tek bir istek
 * birçok reklamvereni birden döndürür, dolayısıyla satırın kendisi
 * söylemelidir.
 */
export interface PulledConversion extends NormalizedConversion {
  /** Ağın reklamveren kimliği (Awin'de `advertiserId`). */
  networkMerchantId: string;
  /** Tıklama zamanı — ağ biliyorsa. Atıf penceresi denetimi için. */
  clickedAt: string | null;
}

export interface AffiliateProvider {
  /** `merchants.network` sütunundaki değer. */
  readonly network: string;
  readonly displayName: string;
  /**
   * Dönüşümlerin geliş yolu. `'pull'` olan ağlarda postback ucu KAPALIDIR
   * ve `postback_secret` aranmaz -- o ağ zaten bildirim göndermiyor.
   */
  readonly conversionSource: ConversionSource;

  /**
   * Bildirimin bu ağdan geldiğini doğrular.
   *
   * Doğrulanamıyorsa `false` DÖNMEZ, `ProviderError` FIRLATIR
   * ('verification_unavailable'). İkisi farklı şeydir: "imza yanlış" ile
   * "bu ağın imza şemasını henüz bilmiyoruz" aynı yanıtı almamalıdır.
   */
  verifyPostback(context: PostbackContext): boolean;

  /** Ağın kendi gövdesini ortak modele çevirir. Doğrulamadan SONRA çağrılır. */
  normalizePostback(payload: unknown): NormalizedConversion;

  /**
   * Ağa özgü deeplink biçimi. Tanımlı değilse çağıran ortak
   * `buildAffiliateUrl` akışını kullanır — mevcut davranış korunur.
   */
  buildDeeplink?(context: DeeplinkContext): string;

  // -------------------------------------------------------------------------
  // YETENEK İLANI (FAZ 1) — ayrıntı için dosyanın sonundaki bölüm
  // -------------------------------------------------------------------------
  /**
   * Bu ağ neyi, hangi taşıma ile sunar. ZORUNLU: bir ağın katalog verip
   * vermediği çalışma anında denenerek değil, önceden BİLİNEREK öğrenilmeli.
   */
  readonly capabilities: ProviderCapabilities;
  /** Ağın ilan ettiği kota ve sayfalama sınırları. */
  readonly limits: ProviderLimits;

  /**
   * Program/reklamveren keşfi isteği. `capabilities.programs === 'api'`
   * değilse TANIMSIZDIR.
   */
  programsRequest?(context: ProviderRequestContext & {
    page?: number;
    pageSize?: number;
  }): ProviderRequest;
  /** Keşif yanıtını ortak modele çevirir. Çevrilemeyen satır DÜŞER. */
  parsePrograms?(raw: unknown): DiscoveredProgram[];

  /** Katalog listesi isteği (ağda birden çok feed/katalog olabilir). */
  catalogsRequest?(context: ProviderRequestContext & {
    programId?: string;
  }): ProviderRequest;
  /** Bir katalogun kalemleri. */
  catalogItemsRequest?(context: ProviderRequestContext & {
    catalogId: string;
    page?: number;
    pageSize?: number;
  }): ProviderRequest;
  /** Katalog yanıtını ortak modele çevirir. */
  parseCatalogItems?(raw: unknown): CatalogOffer[];

  /** Dönüşüm çekme isteği. `conversionSource === 'pull'` olan ağlarda. */
  conversionsRequest?(context: ProviderRequestContext & {
    startDate: Date;
    endDate: Date;
    programIds?: readonly string[];
  }): ProviderRequest;
  /** Çekilen yanıtı ortak modele çevirir. */
  parsePulledConversions?(raw: unknown): PulledConversion[];

  /**
   * Sonraki sayfanın isteği. Yanıtın kendi sayfalama bilgisinden okunur;
   * sayfa numarası TAHMİN EDİLMEZ -- son sayfadan sonra istek atmak kotayı
   * yer ve bazı ağlarda 400 döner.
   *
   * `null` = sayfa kalmadı.
   */
  nextPageRequest?(raw: unknown, previous: ProviderRequest): ProviderRequest | null;
}

// ===========================================================================
// YETENEK SÖZLEŞMESİ (FAZ 1)
// ===========================================================================
/*
 * NEDEN BURAYA EKLENDİ, NEDEN AYRI BİR DOSYAYA DEĞİL
 *
 * Yukarıdaki dört sorumluluk (verify / normalize / deeplink / kimlik) bir
 * ağın yalnızca DÖNÜŞÜM tarafını tanımlıyordu. Katalog, program keşfi ve
 * sayfalama Awin'e özgü kodda ve script'lerde dağınık duruyordu; ikinci bir
 * ağ eklemek "her yeri bul ve bir dal daha aç" demekti.
 *
 * Aşağısı o dağınıklığı sözleşmeye taşıyor. Tasarım kararı tek cümlede:
 *
 *   SAĞLAYICI İSTEĞİ TARİF EDER VE YANITI ÇÖZER; İSTEĞİ ATMAZ.
 *
 * Bu, Awin'de zaten uygulanan kalıptır (`awinTransactionsUrl` adresi kurar,
 * `awinTransactionToConversion` yanıtı çözer, `fetch` çağıran taraftadır) ve
 * bilerek korunuyor: SSRF kapısı, nezaket gecikmesi, gövde boyutu sınırı ve
 * devre kesici `politeClient` içinde TEK yerde duruyor. Sağlayıcıya `fetch`
 * vermek, o korumaların her ağda yeniden -- ve er geç eksik -- yazılması
 * demekti.
 *
 * İKİNCİ KARAR: SIR PAKETE GİRMEZ.
 * `ProviderRequest` hazır bir `Authorization` başlığı TAŞIMAZ; yalnızca
 * hangi ortam değişkeninin gerektiğini SÖYLER. Böylece bu paket hiçbir
 * koşulda sır taşımaz, sırrı çözen taraf tek ve denetlenebilir kalır, ve
 * bir ağın hangi değişkeni istediği koda değil VERİYE yazılmış olur.
 */

/** Bir yeteneğin hangi taşıma ile karşılandığı. `'none'` = ağ bunu sunmuyor. */
export interface ProviderCapabilities {
  /** Program/reklamveren keşfi. `'manual'` = operatör elle girer. */
  programs: 'api' | 'feed' | 'manual';
  /** Ürün kataloğu. Awin'de CSV feed, Impact'te REST. */
  catalog: 'api' | 'feed' | 'none';
  /**
   * Deeplink üretimi. `'template'` = ortak `buildAffiliateUrl` yeterli;
   * `'api'` = her link için ağa çağrı gerekir (tıklama anında KULLANILAMAZ).
   */
  deeplink: 'template' | 'api';
  /** Tıklama sayacı. Bugün her ağda bizim `clicks` tablomuz. */
  clicks: 'local' | 'api';
  conversions: ConversionSource;
  /**
   * Komisyon nereden okunur. `'in_conversion'` = dönüşüm satırının kendi
   * alanında; `'separate'` = ayrı bir uç nokta gerekir.
   */
  commissions: 'in_conversion' | 'separate';
}

/**
 * Ağın ilan ettiği sınırlar. Hepsi OPSİYONEL DEĞİL, `null` ile "ağ
 * yayınlamamış" denir -- bilinmeyen bir sınırı sonsuz saymak, kotayı
 * tüketip 429 yemenin kestirme yoludur.
 */
export interface ProviderLimits {
  requestsPerMinute: number | null;
  requestsPerHour: number | null;
  /** Tek istekte sorulabilecek en geniş tarih aralığı (gün). */
  maxRangeDays: number | null;
  maxPageSize: number | null;
  /** Sayfalamayla ulaşılabilecek en fazla kayıt. Aşılırsa ağ hata döner. */
  maxPagedResults: number | null;
}

/**
 * İsteğin hangi kimlik bilgisini gerektirdiği — DEĞERİ DEĞİL, ADI.
 *
 * Çağıran bu adı ortamda arar. Ad koda gömülü olduğu için `.env.example`
 * ile kodun ayrışması mümkün değil: eksik değişken açık bir hatayla durur,
 * sessizce kimliksiz istek atılmaz.
 */
export type ProviderCredential =
  | { kind: 'none' }
  | { kind: 'bearer'; tokenEnv: string }
  | { kind: 'basic'; usernameEnv: string; passwordEnv: string };

/** Sağlayıcının tarif ettiği tek bir HTTP isteği. */
export interface ProviderRequest {
  method: 'GET';
  url: string;
  credential: ProviderCredential;
  /** Ağ varsayılan olarak XML dönüyorsa JSON bunu gerektirir. */
  accept?: string;
}

/** Ağın program/reklamveren kaydı — onboarding'in ham girdisi. */
export interface DiscoveredProgram {
  /** `programs.network_program_id` */
  networkProgramId: string;
  merchantName: string;
  homepageUrl: string | null;
  /** Ağın bildirdiği ülkeler (ISO-3166 alpha-2, büyük harf). Boş olabilir. */
  countryCodes: string[];
  /** Ham ağ durumu. Normalize EDİLMEZ: ağa özgü sözlük. */
  status: string | null;
  deeplinkSupported: boolean | null;
  /** Ağın verdiği hazır izleme linki — deeplink şablonunun çekirdeği. */
  trackingLink: string | null;
}

/**
 * Ağın katalogundan tek bir teklif.
 *
 * Alan adları `public.products` sütunlarıyla hizalı; tutarlar KURUŞ.
 * Çevrilemeyen alan `null` olur, UYDURULMAZ -- FAZ 0'da ölçüldüğü gibi
 * sıfıra düşen bir fiyat, olmayan bir indirim gibi görünür.
 */
export interface CatalogOffer {
  /** `products.external_id` — ağın kalem kimliği. */
  externalId: string;
  title: string;
  description: string | null;
  brand: string | null;
  gtin: string | null;
  mpn: string | null;
  priceCents: number | null;
  compareAtPriceCents: number | null;
  /** ISO-4217, üç harf, büyük harf. */
  currency: string | null;
  /** `null` = ağ bildirmemiş; `false` ile karıştırılmaz. */
  inStock: boolean | null;
  imageUrl: string | null;
  /** Mağazadaki ürün sayfası ya da ağın izleme adresi. */
  productUrl: string | null;
  category: string | null;
}

/**
 * Her istek kurucusunun ortak bağlamı.
 *
 * `accountSid` ADRESİN parçası olan hesap kimliğidir (Impact'te
 * `/Mediapartners/{sid}/...`). SIR DEĞİLDİR -- sır olan `AuthToken` ve o
 * bu pakete hiç girmez; `ProviderRequest.credential` yalnızca adını taşır.
 *
 * Kimlik gerektirmeyen ağlarda (Awin: yayıncı kimliği adreste, jeton
 * başlıkta) bu alan kullanılmaz.
 */
export interface ProviderRequestContext {
  accountSid?: string;
}
