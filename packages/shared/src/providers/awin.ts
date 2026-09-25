/**
 * `awin` — Awin ortaklık ağı.
 *
 * ======================================================================
 * DÖNÜŞÜM BU AĞDAN ÇEKİLİR, BEKLENMEZ
 * ======================================================================
 * Awin'in resmî dokümantasyonu (help.awin.com/apidocs, success.awin.com)
 * iki yol tanımlıyor ve ikisi eşdeğer değil:
 *
 *   PULL  — GET /publishers/{publisherId}/transactions/
 *           OAuth2 Bearer token, tam ve yetkilendirilmiş.
 *   PUSH  — panelden girilen callback URL ("Transaction Notifications").
 *           Varsayılan olarak KAPALI, açtırmak için destek talebi gerekir.
 *
 * PULL seçildi, çünkü bir dönüşümün durumu SONRADAN değişir:
 * `pending → approved` ya da `pending → declined`. Push tek seferlik bir
 * bildirimdir; nihai durumu yalnızca yeniden okuyarak öğrenebiliriz.
 *
 * ----------------------------------------------------------------------
 * AWIN POSTBACK'İ İMZASIZDIR — BU BİR VARSAYIM DEĞİL, ÖLÇÜM
 * ----------------------------------------------------------------------
 * Resmî doküman callback için HİÇBİR imza, paylaşılan sır ya da HMAC
 * tanımlamıyor; önerilen kurulum örneği düpedüz bir Zapier webhook URL'i.
 * Güvenlik modeli imza değil, URL gizliliği.
 *
 * Bu yüzden bu sağlayıcı `conversionSource: 'pull'` ilan eder. Route o
 * ilanı görünce Awin'den postback sırrı ARAMAZ -- ama imzasız bir yazma
 * yolu da AÇMAZ: Awin için postback ucu kapalı kalır. "Sır yok, o hâlde
 * doğrulamayı atlayalım" kararı kalıcı bir açığa dönüşürdü.
 *
 * `verifyPostback`/`normalizePostback` bu yüzden hâlâ fırlatıyor. Eksik
 * bilgi oldukları için değil -- bu ağda postback ile dönüşüm kabul etmeme
 * KARARI oldukları için.
 */

import {
  ProviderError,
  type AffiliateProvider,
  type ConversionStatus,
  type NormalizedConversion,
  type PostbackContext,
  type ProviderRequest,
  type PulledConversion,
} from './types.js';

/**
 * Yayıncı kimliğimiz (`awinaffid`). Operatör tarafından bildirildi.
 *
 * Bu bir SIR DEĞİLDİR — her ortaklık linkinin içinde açıkça görünür ve
 * yayıncıyı tanımlar, yetkilendirmez. Sır olan `postback_secret` ve API
 * anahtarlarıdır; onlar koda hiç girmez, ortamdan okunur.
 */
export const AWIN_PUBLISHER_ID = '3074081';

/**
 * Transactions API jetonunun ortam değişkeni adı.
 *
 * ADI KODDA, DEĞERİ ORTAMDA. `ProviderRequest.credential` yalnızca bu adı
 * taşır; jetonun kendisi bu pakete hiç girmez. FAZ 0'da ölçülen eksik
 * buydu: ad yalnızca `apps/web/.../donusum-esitle/route.ts` içinde geçiyor
 * ve `.env.example` onu hiç anmıyordu.
 */
export const AWIN_TOKEN_ENV = 'AWIN_API_TOKEN';

/**
 * Ürün feed'i (datafeed) indirme anahtarının ortam değişkeni adı.
 *
 * Awin'de katalog REST'ten değil CSV datafeed'inden gelir ve o adres
 * `sources.endpoint_url` içinde `${AWIN_DATAFEED_API_KEY}` yer tutucusuyla
 * durur. Ad burada da yazılı ki tek kaynak olsun.
 */
export const AWIN_DATAFEED_ENV = 'AWIN_DATAFEED_API_KEY';

/**
 * Deeplink şablonu iskeleti — OPERATÖR İÇİN REFERANS.
 *
 * Kod bunu kullanmaz; `merchants.deeplink_template` sütununa yazılacak
 * değerin biçimini gösterir. `{awinmid}` her REKLAMVEREN için farklıdır ve
 * Awin panelinden alınır; burada sabitlenmesi mümkün değildir.
 *
 * Ortak `buildAffiliateUrl` bu şablonu ZATEN üretebiliyor: `{url_encoded}` ve
 * `{subid}` yer tutucuları destekli, `awin1.com` de mağazanın izinli alan
 * adları arasına `allowedHostsForMerchant` tarafından otomatik ekleniyor.
 * Bu yüzden bu sağlayıcı `buildDeeplink` TANIMLAMAZ — çalışan bir mekanizmayı
 * ikizlemek, iki kopyanın zamanla ayrışması demektir.
 */
export const AWIN_DEEPLINK_TEMPLATE_SHAPE =
  'https://www.awin1.com/cread.php' +
  '?awinmid={awinmid}' +
  `&awinaffid=${AWIN_PUBLISHER_ID}` +
  '&clickref={subid}' +
  '&ued={url_encoded}';

/**
 * Awin `clickref` ↔ Ohaaaa `subid` eşlemesi.
 *
 * Awin, yayıncının tıklama anında gönderdiği `clickref` değerini dönüşüm
 * raporunda geri verir. Bizim tarafta bu değer `clicks.subid`'dir.
 * Eşleme saf bir ad değişikliğidir; protokol varsayımı içermez.
 *
 * Boş/eksik değer `null` döner: atıfsız bir dönüşüm, yanlış atfedilmiş bir
 * dönüşümden iyidir.
 */
export function awinClickrefToSubid(clickref: unknown): string | null {
  if (typeof clickref !== 'string') return null;

  const trimmed = clickref.trim();
  if (trimmed === '') return null;

  // `clicks_subid_format` kısıtı: [A-Za-z0-9_-]{16,64}
  // Uymayan bir değer bizim üretmediğimiz bir clickref'tir; atıf kurulmaz.
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(trimmed)) return null;

  return trimmed;
}

// ---------------------------------------------------------------------------
// TRANSACTIONS API
// ---------------------------------------------------------------------------

/** Awin API kökü. Yalnızca HTTPS; http yönlendirmesi yok (resmî doküman). */
export const AWIN_API_BASE = 'https://api.awin.com';

/**
 * Tek istekte sorulabilecek en geniş aralık: 31 gün (resmî sınır).
 *
 * Daha genişini istemek hata döndürür; bu yüzden çağıran pencereyi
 * bölmek zorunda ve bu sabit onun tek referansı.
 */
export const AWIN_MAX_RANGE_DAYS = 31;

/** Dakikada 20 çağrı (kullanıcı başına, resmî sınır). */
export const AWIN_RATE_LIMIT_PER_MINUTE = 20;

/**
 * Awin `commissionStatus` → bizim `conversion_status`.
 *
 * DİKKAT: Awin "declined" der, bizim enum "rejected". Aynı şey; adlar
 * ayrıştığı için eşleme burada AÇIKÇA yazılı. `paid` bizde var ama Awin
 * bu alanda vermiyor (ödeme bilgisi `paidToPublisher`/`paymentId` ile
 * gelir) -- o yüzden buradan asla `paid` çıkmaz.
 */
const DURUM_ESLEMESI: Record<string, ConversionStatus> = {
  pending: 'pending',
  approved: 'approved',
  declined: 'rejected',
};

/** Awin'in para alanı: `{ amount: number, currency: string }`. */
interface AwinTutar {
  amount: unknown;
  currency: unknown;
}

function kurusaCevir(tutar: unknown): number | null {
  if (typeof tutar !== 'object' || tutar === null) return null;
  const { amount } = tutar as AwinTutar;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  if (amount < 0) return null;

  /*
   * ÖNCE YUVARLA, SONRA TAM SAYIYA AL.
   * `5.59 * 100` ikilik tabanda 558.9999999999999 verir; `Math.trunc` bunu
   * 558 kuruşa indirir ve her dönüşümde bir kuruş kaybederiz. Mutabakatta
   * bu, binlerce satırda gerçek paraya dönüşen bir fark.
   */
  return Math.round(amount * 100);
}

function paraBirimi(tutar: unknown): string | null {
  if (typeof tutar !== 'object' || tutar === null) return null;
  const { currency } = tutar as AwinTutar;
  if (typeof currency !== 'string') return null;
  const kod = currency.trim().toUpperCase();
  // `conversions.currency` char(3); üç harf dışındaki her şey veri hatasıdır.
  return /^[A-Z]{3}$/.test(kod) ? kod : null;
}

/**
 * Awin'in tarih biçimi (`2017-02-20T22:04:00`) saat dilimi TAŞIMAZ; istek
 * `timezone=UTC` ile yapıldığı için UTC'dir. Sonuna `Z` eklenmezse
 * `new Date()` bunu ÇALIŞTIRAN MAKİNENİN yerel saatinde okur ve dönüşüm
 * saatleri sunucunun bulunduğu yere göre kayar.
 */
function utcIsoYap(deger: unknown): string | null {
  if (typeof deger !== 'string') return null;
  const ham = deger.trim();
  if (ham === '') return null;

  const normalize = /(Z|[+-]\d{2}:?\d{2})$/.test(ham) ? ham : `${ham.replace(' ', 'T')}Z`;
  const t = new Date(normalize);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/**
 * Bir Awin transaction satırını ortak modele çevirir.
 *
 * ÇEVRİLEMEYENİ ATAR, UYDURMAZ. Eksik tutar, tanınmayan durum ya da
 * okunamayan tarih -> `null`. Yanlış bir komisyon kaydı, hiç kayıt
 * olmamasından kötüdür: mutabakat gerçek sanılan bir sayının üzerine
 * kurulur ve fark aylar sonra ortaya çıkar.
 *
 * Alan adları resmî `GET /publishers/{id}/transactions/` yanıtından.
 */
export function awinTransactionToConversion(ham: unknown): PulledConversion | null {
  if (typeof ham !== 'object' || ham === null) return null;
  const tx = ham as Record<string, unknown>;

  // `id` sayı gelir; idempotentlik anahtarı olarak metne çevriliyor.
  const id = tx.id;
  const orderId =
    typeof id === 'number' && Number.isFinite(id)
      ? String(id)
      : typeof id === 'string' && id.trim() !== ''
        ? id.trim()
        : null;
  if (orderId === null) return null;

  const advertiserId = tx.advertiserId;
  const networkMerchantId =
    typeof advertiserId === 'number' && Number.isFinite(advertiserId)
      ? String(advertiserId)
      : typeof advertiserId === 'string' && advertiserId.trim() !== ''
        ? advertiserId.trim()
        : null;
  if (networkMerchantId === null) return null;

  const durumHam = typeof tx.commissionStatus === 'string' ? tx.commissionStatus.trim() : '';
  const status = DURUM_ESLEMESI[durumHam.toLowerCase()];
  /*
   * TANINMAYAN DURUM SESSİZCE `pending` SAYILMAZ. Awin sözlüğüne yeni bir
   * değer eklerse onu "beklemede" diye kaydetmek, gerçekte reddedilmiş bir
   * satırı gelir gibi göstermek olurdu.
   */
  if (status === undefined) return null;

  const orderTotalCents = kurusaCevir(tx.saleAmount);
  const commissionCents = kurusaCevir(tx.commissionAmount);
  if (orderTotalCents === null || commissionCents === null) return null;

  // Para birimi komisyondan okunuyor: ödenen tutarın birimi bizim için
  // bağlayıcı olan. Yoksa satış tutarınınkine düşülüyor.
  const currency = paraBirimi(tx.commissionAmount) ?? paraBirimi(tx.saleAmount);
  if (currency === null) return null;

  const occurredAt = utcIsoYap(tx.transactionDate);
  if (occurredAt === null) return null;

  const clickRefs = tx.clickRefs;
  const clickRef =
    typeof clickRefs === 'object' && clickRefs !== null
      ? (clickRefs as Record<string, unknown>).clickRef
      : undefined;

  return {
    orderId,
    networkMerchantId,
    subid: awinClickrefToSubid(clickRef),
    status,
    orderTotalCents,
    commissionCents,
    currency,
    occurredAt,
    clickedAt: utcIsoYap(tx.clickDate),
  };
}

/**
 * Transactions uç noktasının adresini kurar.
 *
 * `startDate`/`endDate` zorunlu ve `yyyy-MM-ddThh:mm:ss` biçiminde; `Z`
 * eki KONULMAZ çünkü saat dilimini ayrı `timezone` parametresi söyler.
 */
export function awinTransactionsUrl(secenek: {
  publisherId: string;
  startDate: Date;
  endDate: Date;
  advertiserIds?: readonly string[];
}): string {
  const bicim = (t: Date) => t.toISOString().slice(0, 19);

  const url = new URL(`/publishers/${secenek.publisherId}/transactions/`, AWIN_API_BASE);
  url.searchParams.set('startDate', bicim(secenek.startDate));
  url.searchParams.set('endDate', bicim(secenek.endDate));
  url.searchParams.set('timezone', 'UTC');
  /*
   * `dateType=transaction`: satırlar İŞLEM tarihine göre gelir.
   * `validation` seçilseydi yalnızca o pencerede DURUMU değişenler
   * dönerdi; ikisi farklı soru ve biz "bu aralıkta ne oldu" diye
   * soruyoruz.
   */
  url.searchParams.set('dateType', 'transaction');
  if (secenek.advertiserIds && secenek.advertiserIds.length > 0) {
    url.searchParams.set('advertiserId', secenek.advertiserIds.join(','));
  }
  return url.toString();
}

/**
 * `merchants.deeplink_template` içindeki `awinmid`.
 *
 * Bu değer, tıklamanın GERÇEKTEN hangi reklamverene gittiğini söyler --
 * çünkü yönlendirmede kullanılan adresin ta kendisidir.
 */
export function awinmidCikar(deeplinkTemplate: string | null | undefined): string | null {
  if (typeof deeplinkTemplate !== 'string') return null;
  const eslesme = /[?&]awinmid=(\d+)/.exec(deeplinkTemplate);
  return eslesme?.[1] ?? null;
}

/**
 * Awin reklamveren kimliği (`awinmid`) → mağaza kimliği eşlemesi.
 *
 * İKİ KAYNAK, BİLEREK:
 *   1. `merchant_network_links` — AÇIKÇA tanımlanmış eşleme (öncelikli).
 *   2. `merchants.deeplink_template` içindeki `awinmid` — tıklamanın
 *      gerçekten gittiği yer.
 *
 * İkincisi gerekli çünkü ölçüldü: bugün ürünlerin ve tıkların tamamını
 * taşıyan mağazanın (awinmid 61655) bağlantı tablosunda satırı YOK.
 * Yalnızca birinci kaynağa dayansaydık o mağazanın bütün dönüşümleri
 * eşlenemeyip düşerdi.
 *
 * ÇELİŞKİ TAHMİNLE ÇÖZÜLMEZ: iki şablon aynı `awinmid`'i farklı
 * mağazalara gösteriyorsa eşleme KURULMAZ. Yanlış mağazaya yazılmış bir
 * komisyon mutabakatı sessizce bozar; eşlenmemiş dönüşüm ise loglanır ve
 * görünür kalır.
 */
export function awinMagazaEslemesi(
  magazalar: readonly { id: string; deeplink_template: string | null }[],
  baglantilar: readonly { merchant_id: string; network_program_id: string }[],
): Map<string, string> {
  const esleme = new Map<string, string>();
  const catisan = new Set<string>();

  for (const m of magazalar) {
    const awinmid = awinmidCikar(m.deeplink_template);
    if (awinmid === null) continue;

    const mevcut = esleme.get(awinmid);
    if (mevcut !== undefined && mevcut !== m.id) {
      catisan.add(awinmid);
      continue;
    }
    esleme.set(awinmid, m.id);
  }

  // Çelişkili şablonlar düşer -- ama açık tanım varsa o kazanır.
  for (const awinmid of catisan) esleme.delete(awinmid);

  // Açık tanım her zaman üstün: operatörün kararı, çıkarımı ezer.
  for (const b of baglantilar) {
    const awinmid = String(b.network_program_id).trim();
    if (awinmid !== '') esleme.set(awinmid, b.merchant_id);
  }

  return esleme;
}

/**
 * Postback yolunun neden kapalı olduğunu anlatan tek metin — hata
 * mesajında ve panelde aynısı görünür.
 */
const POSTBACK_KAPALI =
  'Awin donusumleri Transactions API ile CEKILIR (pull), bildirimle alinmaz. ' +
  "Awin'in yayinci callback'i imzasizdir; imzasiz bir yazma yolu acilmadi.";

export const awinProvider: AffiliateProvider = {
  network: 'awin',
  displayName: 'Awin',
  conversionSource: 'pull',

  /*
   * YETENEK İLANI — DAVRANIŞ DEĞİŞTİRMEZ.
   *
   * Aşağısı bu dosyada zaten var olan gerçeği yazıya döküyor; tek satır
   * kod akışı değişmedi. Gerekçesi FAZ 0'da ölçüldü: "bu ağ katalog veriyor
   * mu, programları API'den mi geliyor" sorusunun cevabı hiçbir yerde
   * yazılı değildi ve ikinci bir ağ eklerken her çağıran kendi varsayımını
   * kurardı.
   *
   * `catalog: 'feed'` çünkü Awin'de ürünler REST'ten değil, CSV
   * datafeed'inden gelir (`sources.endpoint_url`, `packages/ingest`).
   * `deeplink: 'template'` çünkü `buildDeeplink` bilerek tanımsız.
   */
  capabilities: {
    programs: 'api',
    catalog: 'feed',
    deeplink: 'template',
    clicks: 'local',
    conversions: 'pull',
    commissions: 'in_conversion',
  },

  limits: {
    requestsPerMinute: AWIN_RATE_LIMIT_PER_MINUTE,
    // Saatlik bir sınır yayınlanmıyor: `null` "sınırsız" değil "bilinmiyor".
    requestsPerHour: null,
    maxRangeDays: AWIN_MAX_RANGE_DAYS,
    // Transactions uç noktası sayfalama parametresi belgelemez; pencere
    // bölerek daraltılır. Uydurulmuş bir sayfa boyutu sessizce veri
    // kaybettirirdi.
    maxPageSize: null,
    maxPagedResults: null,
  },

  verifyPostback(_context: PostbackContext): never {
    throw new ProviderError(POSTBACK_KAPALI, 'verification_unavailable');
  },

  normalizePostback(_payload: unknown): NormalizedConversion {
    throw new ProviderError(POSTBACK_KAPALI, 'verification_unavailable');
  },

  /*
   * DÖNÜŞÜM ÇEKME — MEVCUT FONKSİYONLARIN ÜZERİNE İNCE BİR SARMAL.
   *
   * `awinTransactionsUrl` ve `awinTransactionToConversion` OLDUĞU GİBİ
   * duruyor ve bugünkü çağıran (`lib/awin/donusum-cek.ts`) onları doğrudan
   * kullanmaya devam ediyor. Buradaki iki üye yalnızca AYNI mantığı
   * sözleşme üzerinden de erişilebilir kılıyor.
   *
   * İkizleme değil, yönlendirme: gövde yok, çağrı var. İki kopya olsaydı
   * biri zamanla sapardı ve sapma sessiz olurdu.
   */
  conversionsRequest(context): ProviderRequest {
    return {
      method: 'GET',
      url: awinTransactionsUrl({
        publisherId: context.accountSid?.trim() || AWIN_PUBLISHER_ID,
        startDate: context.startDate,
        endDate: context.endDate,
        advertiserIds: context.programIds,
      }),
      credential: { kind: 'bearer', tokenEnv: AWIN_TOKEN_ENV },
    };
  },

  parsePulledConversions(ham: unknown): PulledConversion[] {
    // Awin transactions yanıtı düz bir dizidir, zarf yok.
    if (!Array.isArray(ham)) return [];
    return ham
      .map(awinTransactionToConversion)
      .filter((c): c is PulledConversion => c !== null);
  },

  // buildDeeplink BILEREK TANIMSIZ: ortak sablon akisi Awin'i zaten karsiliyor.
  // nextPageRequest de TANIMSIZ: Awin sayfalamaz, pencere bolerek daraltilir.
};
