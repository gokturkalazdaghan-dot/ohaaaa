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

import type { CapabilityMatrix } from './capabilities.js';

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
  | 'unsupported_status'
  /** Ag bu isi API ile yapmiyor ya da sartlari otomatiklestirmeyi yasakliyor. */
  | 'manual_required'
  /** Yetenegin sozlesmesi henuz dogrulanmadi -- "bilmiyoruz". */
  | 'capability_unavailable'
  /** Beyan `supported` ama kod yok -- BIZIM hatamiz. */
  | 'capability_not_implemented';

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
 * Sağlayıcının ağa erişmek için kullanabileceği TEK yol.
 *
 * ======================================================================
 * NEDEN GETİRİCİ DIŞARIDAN VERİLİYOR
 * ======================================================================
 * Sağlayıcı dosyaları `fetch`'i kendileri İÇE AKTARMAZ. Aktarsalardı her
 * biri SSRF kapısını, gövde boyutu sınırını, zaman aşımını, yeniden
 * denemeyi ve nezaket gecikmesini ATLARDI -- ve bunu fark etmek için her
 * yeni sağlayıcı dosyasını tek tek okumak gerekirdi.
 *
 * Bu bağımlılık tersine çevrildiğinde kural TEK YERDE zorlanıyor: çağıran
 * `createPoliteClient`'ı verir, sağlayıcı başka bir ağ yolu bulamaz.
 * Yeni bir ağ eklendiğinde güvenlik gözden geçirmesi "bu dosya fetch
 * çağırıyor mu" sorusuna iner.
 *
 * `shared` paketi `ingest`'e bağımlı olamaz (ters yönde bağımlılık var),
 * bu yüzden burada YAPISAL olarak uyumlu asgari bir sözleşme duruyor:
 * `createPoliteClient`'ın döndürdüğü nesne bunu zaten karşılıyor.
 */
export interface ProviderFetcher {
  get(
    url: string,
    options?: { headers?: Record<string, string> },
  ): Promise<{ body: string; contentType: string | null }>;
}

export interface ProviderContext {
  /** Ağa erişimin tek yolu. */
  fetch: ProviderFetcher;
  /**
   * Kimlik bilgisi ORTAM DEĞİŞKENİ ADIYLA çözülür, değeriyle değil:
   * sağlayıcı koduna sır girmez ve `programs.raw`'a sızma yolu kapanır.
   * Ad tanımlı değilse çözücü null döner ve sağlayıcı kapalı başarısız olur.
   */
  secret(envVarName: string): string | null;
  /** Enjekte edilebilir saat — testlerde belirlenimci. */
  now(): string;
}

/**
 * Ağdan keşfedilen bir programın AĞ BAĞIMSIZ modeli.
 *
 * TASARIM KURALI: bilinmeyen alan `null`. Boş string, 0 ya da "UNKNOWN"
 * metni KULLANILMAZ -- üçü de bir DEĞER gibi davranır ve puanlamaya,
 * filtreye, rapora sızar. `null` sızmaz; her okuyan onu ele almak zorunda
 * kalır.
 *
 * Bu yüzden `commissionRate` de `number | null`: 0 geçerli bir oran
 * (komisyonsuz program) ve "bilmiyoruz" ile aynı hücreye yazılamaz.
 */
export interface NormalizedProgram {
  /** `merchants.network` ile aynı değer. */
  network: string;
  /** Ağın kendi program/advertiser kimliği (Awin'de MID). */
  networkProgramId: string;
  merchantName: string;
  homepageUrl: string | null;
  /** ISO-3166 alfa-2, büyük harf. */
  countryCode: string | null;
  /** `markets.code`. Ağ pazar kavramı taşımıyorsa null. */
  marketCode: string | null;
  /** ISO-4217. */
  currency: string | null;
  /** Oran (0.10 = %10), yüzde DEĞİL. Bilinmiyorsa null. */
  commissionRate: number | null;
  cookieWindowDays: number | null;
  feedAvailable: boolean | null;
  productCount: number | null;
  applicationSupported: boolean | null;
  deeplinkSupported: boolean | null;
  /** Serbest metin program şartları. */
  terms: string | null;
  /** Ağdaki ham durum metni (ör. "joined", "notjoined"). */
  networkStatus: string | null;
  /** Bu kaydın ağdan en son ne zaman doğrulandığı (ISO-8601). */
  lastVerifiedAt: string;
}

/** Başvuru durum makinesi — `AŞAMA 4` ile birebir. */
export type ApplicationState =
  | 'DISCOVERED'
  | 'ELIGIBLE'
  | 'APPLICATION_READY'
  | 'APPLIED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'MANUAL_REQUIRED';

export interface ApplicationResult {
  state: ApplicationState;
  /** Ağın başvuruya verdiği kimlik; yoksa null. */
  networkApplicationId: string | null;
  /** Ağdan gelen ham gerekçe/mesaj. */
  message: string | null;
  checkedAt: string;
}

/** Ağdan keşfedilen feed — adres doğrulanmadan source açılmaz. */
export interface DiscoveredFeed {
  url: string;
  /** `sources.kind` ile uyumlu: feed_csv | feed_xml | feed_json. */
  kind: string;
  /**
   * Kimlik doğrulama gerekiyorsa yalnızca ORTAM DEĞİŞKENİ ADI taşınır,
   * değeri asla. Depodaki `sources.auth_secret_ref` kalıbının aynısı.
   */
  authSecretRef: string | null;
  lastUpdatedAt: string | null;
}

export interface AffiliateProvider {
  /** `merchants.network` sütunundaki değer. */
  readonly network: string;
  readonly displayName: string;

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

  /**
   * Her yeteneğin durumu. ZORUNLU ve varsayılansız: yeni bir yetenek
   * eklendiğinde derleyici her sağlayıcıyı tek tek uyarır. Varsayılan
   * olsaydı yeni yetenek sessizce o değeri alırdı.
   */
  readonly capabilities: CapabilityMatrix;

  /*
   * Aşağıdakiler İSTEĞE BAĞLI. Bir sağlayıcı yalnızca `supported` beyan
   * ettiği yeteneğin metodunu yazar; çağrı `requireCapability` üzerinden
   * geçtiği için beyan ile kod ayrışamaz.
   *
   * Hiçbiri burada varsayılan bir uygulama taşımıyor: ağdan veri çekmenin
   * "makul varsayılanı" yoktur; olsaydı doğrulanmamış bir sözleşme
   * çalışıyormuş gibi görünürdü.
   */
  discoverPrograms?(ctx: ProviderContext): Promise<NormalizedProgram[]>;
  lookupProgram?(ctx: ProviderContext, networkProgramId: string): Promise<NormalizedProgram | null>;
  submitApplication?(ctx: ProviderContext, networkProgramId: string): Promise<ApplicationResult>;
  applicationStatus?(ctx: ProviderContext, networkProgramId: string): Promise<ApplicationResult>;
  programMetadata?(ctx: ProviderContext, networkProgramId: string): Promise<NormalizedProgram | null>;
  discoverFeeds?(ctx: ProviderContext, networkProgramId: string): Promise<DiscoveredFeed[]>;
}
