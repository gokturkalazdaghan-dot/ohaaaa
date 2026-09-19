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
}
