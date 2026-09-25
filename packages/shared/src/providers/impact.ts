/**
 * `impact` — Impact.com (eski adıyla Impact Radius) ortaklık ağı.
 *
 * ======================================================================
 * KAYNAK: RESMÎ YAYINCI (PARTNER) API DOKÜMANTASYONU
 * ======================================================================
 * Aşağıdaki her uç nokta, sınır ve alan adı 2026-09-25'te
 * `integrations.impact.com/partner-api-reference` üzerinden okundu.
 * Tahmin edilen tek bir alan adı yok; okunamayan bir şey varsa bu dosyada
 * da YOK.
 *
 * Buna rağmen `affiliate_networks.contract_verified` bu ağ için FALSE
 * kalıyor ve bu bilinçli: doküman okumak ile CANLI BİR HESAPLA doğrulamak
 * aynı şey değil. Kimlik bilgisi eklendiğinde ilk gerçek yanıt alınana
 * kadar bu ağ "doğrulanmadı" sayılır.
 *
 * ----------------------------------------------------------------------
 * DÖNÜŞÜM ÇEKİLİR (pull) -- AWIN'DEKİ AYNI GEREKÇE
 * ----------------------------------------------------------------------
 * Impact'te bir aksiyonun durumu `PENDING → APPROVED` ya da
 * `PENDING → REVERSED` olarak SONRADAN değişir. Tek seferlik bir bildirim
 * nihai durumu söyleyemez; bu yüzden `Actions` uç noktası periyodik olarak
 * YENİDEN okunur ve idempotentlik veritabanında
 * (`on conflict (merchant_id, network_order_id)`) soğurulur.
 *
 * Impact'in webhook'u vardır, ama imza şemasını canlı bir hesapla
 * doğrulamadan imzasız bir yazma yolu açmayız -- Awin için verilen kararın
 * aynısı. Bu yüzden postback ucu bu ağ için de KAPALI.
 *
 * ----------------------------------------------------------------------
 * DEEPLINK ŞABLONLA ÜRETİLİR, ÇAĞRIYLA DEĞİL
 * ----------------------------------------------------------------------
 * Impact'te `POST /Mediapartners/{sid}/Programs/{id}/TrackingLinks` her
 * çağrıda bir link üretir. Bu uç nokta tıklama anında KULLANILAMAZ: saatte
 * 1000 istek kotası var ve her tıklamaya bir dış çağrı eklemek
 * yönlendirmeye ağ gecikmesi bindirirdi.
 *
 * Doğru yol ağın zaten verdiği hazır linktir: `Campaigns` yanıtındaki
 * `TrackingLink`. O değer `merchant_network_links.deeplink_template`
 * sütununa yazılır ve ortak `buildAffiliateUrl` akışı `{subid}` ile
 * `{url_encoded}` yer tutucularını doldurur -- Awin'de bugün çalışan
 * mekanizmanın aynısı.
 *
 * Bu yüzden `buildDeeplink` burada da TANIMSIZ. Çalışan bir mekanizmayı
 * ikizlemek, iki kopyanın zamanla ayrışması demektir.
 */

import {
  ProviderError,
  type AffiliateProvider,
  type CatalogOffer,
  type ConversionStatus,
  type DiscoveredProgram,
  type NormalizedConversion,
  type PostbackContext,
  type ProviderRequest,
  type PulledConversion,
} from './types.js';

/** API kökü. Yalnızca HTTPS, port 443 (resmî doküman). */
export const IMPACT_API_BASE = 'https://api.impact.com';

/**
 * Hesap kimliği ve sırrın ortam değişkeni adları.
 *
 * DEĞERLER BURADA YOK, OLMAYACAK. Bu iki ad `ProviderRequest.credential`
 * içinde taşınır; çözümü çağıranın işidir. Impact HTTP Basic kullanır:
 * `Authorization: Basic base64(AccountSID:AuthToken)`.
 *
 * `IMPACT_ACCOUNT_SID` aynı zamanda ADRESİN parçasıdır
 * (`/Mediapartners/{sid}/...`), dolayısıyla çağıran onu iki yerde kullanır.
 */
export const IMPACT_SID_ENV = 'IMPACT_ACCOUNT_SID';
export const IMPACT_TOKEN_ENV = 'IMPACT_AUTH_TOKEN';

/**
 * Kota: saatte 1000 istek (genel uç noktalar), ürün aramada 3000.
 * Dakikalık sınır yayınlanmıyor -- `null`, "sınırsız" değil "bilinmiyor".
 */
export const IMPACT_RATE_LIMIT_PER_HOUR = 1_000;

/** Sayfa başına en fazla kayıt (varsayılan da 1000). */
export const IMPACT_MAX_PAGE_SIZE = 1_000;

/**
 * Katalog kalemlerinde sayfalamayla ulaşılabilecek TAVAN.
 *
 * Resmî doküman: 20.000'i aşan sayfa isteği 400 döner. Bu sayı FAZ 2'nin
 * doğrudan sınırı: bir katalogun tamamı 20.000'den büyükse sayfalamayla
 * sonuna gidilemez, daraltıcı sorgu gerekir.
 */
export const IMPACT_MAX_PAGED_RESULTS = 20_000;

/**
 * `Actions` uç noktasında `StartDate`/`EndDate` aralığı en fazla 45 gün
 * (resmî sınır). Daha genişini istemek hata döndürür.
 */
export const IMPACT_MAX_RANGE_DAYS = 45;

/**
 * Impact `State` → bizim `conversion_status`.
 *
 * DİKKAT: Impact "REVERSED" der, bizim enum "rejected". Aynı şey; adlar
 * ayrıştığı için eşleme AÇIKÇA yazılı. `paid` bu alanda gelmez -- ödeme
 * bilgisi ayrı (faturalar/ödeme) uç noktalarındadır, o yüzden buradan asla
 * `paid` çıkmaz.
 */
const DURUM_ESLEMESI: Record<string, ConversionStatus> = {
  pending: 'pending',
  approved: 'approved',
  reversed: 'rejected',
};

/**
 * Impact yanıtlarında sayılar METİN olarak gelir (`"Amount": "49.99"`).
 * Kuruşa çevirirken ÖNCE YUVARLANIR: `49.99 * 100` ikilik tabanda
 * 4998.999999999999 verir ve `Math.trunc` her dönüşümde bir kuruş yerdi.
 */
function kurusaCevir(deger: unknown): number | null {
  const sayi =
    typeof deger === 'number'
      ? deger
      : typeof deger === 'string' && deger.trim() !== ''
        ? Number(deger.trim())
        : Number.NaN;

  if (!Number.isFinite(sayi) || sayi < 0) return null;
  return Math.round(sayi * 100);
}

function paraBirimi(deger: unknown): string | null {
  if (typeof deger !== 'string') return null;
  const kod = deger.trim().toUpperCase();
  // `conversions.currency` char(3); üç harf dışındaki her şey veri hatası.
  return /^[A-Z]{3}$/.test(kod) ? kod : null;
}

function metin(deger: unknown): string | null {
  if (typeof deger !== 'string') return null;
  const t = deger.trim();
  return t === '' ? null : t;
}

/**
 * Impact tarihleri ISO-8601 gelir ama saat dilimi eki taşımayabilir
 * (`2026-09-25T10:30:00`). Ek yoksa UTC varsayılır ve `Z` EKLENİR: aksi
 * halde `new Date()` bunu çalıştıran makinenin yerel saatinde okur ve
 * dönüşüm saatleri sunucunun bulunduğu yere göre kayar.
 */
function utcIsoYap(deger: unknown): string | null {
  const ham = metin(deger);
  if (ham === null) return null;

  const normalize = /(Z|[+-]\d{2}:?\d{2})$/.test(ham) ? ham : `${ham.replace(' ', 'T')}Z`;
  const t = new Date(normalize);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/**
 * Impact `SubId1` ↔ Ohaaaa `subid`.
 *
 * Tıklama anında `subId1` olarak gönderdiğimiz değer aksiyon raporunda
 * geri gelir. Bizim tarafta bu `clicks.subid`'dir.
 *
 * Biçimi tutmayan değer `null` döner: atıfsız bir dönüşüm, YANLIŞ
 * atfedilmiş bir dönüşümden iyidir.
 */
export function impactSubId1ToSubid(deger: unknown): string | null {
  const ham = metin(deger);
  if (ham === null) return null;

  // `clicks_subid_format` kısıtı: [A-Za-z0-9_-]{16,64}
  return /^[A-Za-z0-9_-]{16,64}$/.test(ham) ? ham : null;
}

// ---------------------------------------------------------------------------
// ADRES KURUCULAR
// ---------------------------------------------------------------------------

function mediaPartnerUrl(sid: string, yol: string): URL {
  /*
   * `sid` adrese giriyor. Biçimi denetleniyor çünkü doğrulanmamış bir
   * değer yol ayırıcısı (`/`, `..`) taşırsa istek başka bir kaynağa
   * gidebilir -- kendi kimliğimizle.
   */
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) {
    throw new ProviderError(
      'Impact hesap kimligi bicimsiz; adres kurulmadi.',
      'invalid_payload',
    );
  }
  return new URL(`/Mediapartners/${sid}/${yol}`, IMPACT_API_BASE);
}

function sayfala(url: URL, page?: number, pageSize?: number): URL {
  if (page !== undefined) url.searchParams.set('Page', String(page));
  if (pageSize !== undefined) {
    // Tavanı aşan istek ağda hataya düşer; burada kırpmak sessiz değil,
    // sınır zaten sabit olarak ilan edilmiş durumda.
    url.searchParams.set('PageSize', String(Math.min(pageSize, IMPACT_MAX_PAGE_SIZE)));
  }
  return url;
}

/** `GET /Mediapartners/{sid}/Campaigns` — katıldığımız programlar. */
export function impactCampaignsUrl(secenek: {
  accountSid: string;
  page?: number;
  pageSize?: number;
  /** `'Active'` ya da `'Expired'`. Verilmezse ağ hepsini döner. */
  insertionOrderStatus?: 'Active' | 'Expired';
}): string {
  const url = mediaPartnerUrl(secenek.accountSid, 'Campaigns');
  if (secenek.insertionOrderStatus) {
    url.searchParams.set('InsertionOrderStatus', secenek.insertionOrderStatus);
  }
  return sayfala(url, secenek.page, secenek.pageSize).toString();
}

/** `GET /Mediapartners/{sid}/Catalogs` — programın ürün katalogları. */
export function impactCatalogsUrl(secenek: {
  accountSid: string;
  /** Impact'te program kimliği `CampaignId`. */
  campaignId?: string;
  page?: number;
  pageSize?: number;
}): string {
  const url = mediaPartnerUrl(secenek.accountSid, 'Catalogs');
  if (secenek.campaignId) url.searchParams.set('CampaignId', secenek.campaignId);
  return sayfala(url, secenek.page, secenek.pageSize).toString();
}

/** `GET /Mediapartners/{sid}/Catalogs/{catalogId}/Items` — katalog kalemleri. */
export function impactCatalogItemsUrl(secenek: {
  accountSid: string;
  catalogId: string;
  page?: number;
  pageSize?: number;
}): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(secenek.catalogId)) {
    throw new ProviderError('Impact katalog kimligi bicimsiz.', 'invalid_payload');
  }
  const url = mediaPartnerUrl(
    secenek.accountSid,
    `Catalogs/${secenek.catalogId}/Items`,
  );
  return sayfala(url, secenek.page, secenek.pageSize).toString();
}

/**
 * `GET /Mediapartners/{sid}/Actions` — dönüşümler.
 *
 * `ActionDateStart`/`ActionDateEnd` seçildi, `StartDate`/`EndDate` DEĞİL.
 * İkisi farklı soru sorar: ikincisi "bu aralıkta GÜNCELLENEN" satırları
 * döner, birincisi "bu aralıkta GERÇEKLEŞEN"leri. Biz "bu pencerede ne
 * oldu" diye sorduğumuz için olay tarihini kullanıyoruz -- Awin'de
 * `dateType=transaction` seçilmesiyle aynı gerekçe.
 *
 * Tarih vermemek ağın varsayılanına (son 7 gün) düşerdi; o sessiz bir
 * daralma olurdu, bu yüzden iki uç da zorunlu.
 */
export function impactActionsUrl(secenek: {
  accountSid: string;
  startDate: Date;
  endDate: Date;
  campaignId?: string;
  page?: number;
  pageSize?: number;
}): string {
  const bicim = (t: Date) => t.toISOString().slice(0, 19) + 'Z';

  const url = mediaPartnerUrl(secenek.accountSid, 'Actions');
  url.searchParams.set('ActionDateStart', bicim(secenek.startDate));
  url.searchParams.set('ActionDateEnd', bicim(secenek.endDate));
  if (secenek.campaignId) url.searchParams.set('CampaignId', secenek.campaignId);
  return sayfala(url, secenek.page, secenek.pageSize).toString();
}

// ---------------------------------------------------------------------------
// SAYFALAMA
// ---------------------------------------------------------------------------

/**
 * Yanıtın kendi söylediği sonraki sayfa adresi (`@nextpageuri`).
 *
 * SAYFA NUMARASI ARTIRILMIYOR. Impact zarfı son sayfada `@nextpageuri`
 * VERMEZ; sayacı kendimiz artırsaydık son sayfadan sonra boş bir istek
 * daha atar, saatlik kotadan yerdik. Ağın kendi bildirimi tek doğru kaynak.
 *
 * Dönen değer göreli bir yol (`/Mediapartners/...`) olabilir; kök ile
 * birleştiriliyor ve BAŞKA BİR HOST'A çıkması engelleniyor -- yanıt dış
 * veridir, adres olarak kullanılıyorsa doğrulanması şart.
 */
export function impactSonrakiSayfaUrl(ham: unknown): string | null {
  if (typeof ham !== 'object' || ham === null) return null;

  const sonraki = (ham as Record<string, unknown>)['@nextpageuri'];
  const yol = metin(sonraki);
  if (yol === null) return null;

  let url: URL;
  try {
    url = new URL(yol, IMPACT_API_BASE);
  } catch {
    return null;
  }

  return url.origin === IMPACT_API_BASE ? url.toString() : null;
}

// ---------------------------------------------------------------------------
// ÇÖZÜMLEYİCİLER
// ---------------------------------------------------------------------------

/** Zarfın içindeki listeyi çıkarır; Impact tek kalemi de dizi dışında verebilir. */
function liste(ham: unknown, anahtar: string): unknown[] {
  if (typeof ham !== 'object' || ham === null) return [];
  const deger = (ham as Record<string, unknown>)[anahtar];
  if (Array.isArray(deger)) return deger;
  // Tek kalem geldiğinde ağ onu diziye sarmaz; sarmalamak çağıranı
  // "bazen dizi bazen nesne" dalından kurtarır.
  return deger === undefined || deger === null ? [] : [deger];
}

/**
 * Bir `Campaigns` satırını ortak modele çevirir.
 *
 * ÇEVRİLEMEYENİ ATAR, UYDURMAZ: kimliksiz ya da adsız bir program
 * onboarding'e giremez; yarım kayıt açmak, sonradan hangi reklamverene ait
 * olduğu bilinmeyen bir mağaza satırı bırakırdı.
 */
export function impactCampaignToProgram(ham: unknown): DiscoveredProgram | null {
  if (typeof ham !== 'object' || ham === null) return null;
  const c = ham as Record<string, unknown>;

  const networkProgramId = metin(c.CampaignId);
  if (networkProgramId === null) return null;

  const merchantName = metin(c.CampaignName) ?? metin(c.AdvertiserName);
  if (merchantName === null) return null;

  /*
   * `ShippingRegions` ISO ülke kodları dizisi. Tek bölge dizi dışında
   * gelebiliyor; `liste` onu da sarmalıyor. Biçimsiz kod ATILIR --
   * `countries` tablosuna yazılamayacak bir değeri taşımanın anlamı yok.
   */
  const countryCodes = liste(c, 'ShippingRegions')
    .map((b) => metin(b)?.toUpperCase() ?? '')
    .filter((b) => /^[A-Z]{2}$/.test(b));

  const deeplinkHam = c.AllowsDeeplinking;
  const deeplinkSupported =
    typeof deeplinkHam === 'boolean'
      ? deeplinkHam
      : typeof deeplinkHam === 'string'
        ? deeplinkHam.trim().toLowerCase() === 'true'
        : null;

  return {
    networkProgramId,
    merchantName,
    homepageUrl: metin(c.AdvertiserUrl) ?? metin(c.CampaignUrl),
    countryCodes: [...new Set(countryCodes)],
    status: metin(c.ContractStatus),
    deeplinkSupported,
    trackingLink: metin(c.TrackingLink),
  };
}

/** `Campaigns` yanıtı → program listesi. Çevrilemeyen satırlar düşer. */
export function impactParseCampaigns(ham: unknown): DiscoveredProgram[] {
  return liste(ham, 'Campaigns')
    .map(impactCampaignToProgram)
    .filter((p): p is DiscoveredProgram => p !== null);
}

/**
 * Bir katalog kalemini ortak modele çevirir.
 *
 * FİYATSIZ KALEM DÜŞER. Bir fiyat karşılaştırma ürününde fiyatı olmayan
 * teklif gösterilemez; `null` fiyatı sıfır sayıp "bedava" gibi listelemek
 * ise doğrudan yanlış bilgi olurdu.
 */
export function impactCatalogItemToOffer(ham: unknown): CatalogOffer | null {
  if (typeof ham !== 'object' || ham === null) return null;
  const i = ham as Record<string, unknown>;

  const externalId = metin(i.CatalogItemId) ?? metin(i.Id);
  if (externalId === null) return null;

  const title = metin(i.Name);
  if (title === null) return null;

  const priceCents = kurusaCevir(i.CurrentPrice);
  if (priceCents === null) return null;

  const currency = paraBirimi(i.Currency);
  if (currency === null) return null;

  /*
   * `OriginalPrice` yalnızca GERÇEKTEN yüksekse üstü çizili fiyat olur.
   * Eşit ya da düşük bir değeri taşımak, olmayan bir indirim gösterirdi.
   */
  const orijinal = kurusaCevir(i.OriginalPrice);
  const compareAtPriceCents =
    orijinal !== null && orijinal > priceCents ? orijinal : null;

  const stok = metin(i.StockAvailability)?.toLowerCase() ?? null;
  const inStock =
    stok === null
      ? null
      : ['instock', 'in stock', 'in_stock', 'available', 'true', 'yes'].includes(stok)
        ? true
        : ['outofstock', 'out of stock', 'out_of_stock', 'unavailable', 'false', 'no'].includes(
              stok,
            )
          ? false
          : // Tanınmayan bir stok sözcüğü "var" SAYILMAZ: satılmayan bir
            // ürüne tıklatmak kullanıcıyı boşa yorar, komisyon da getirmez.
            null;

  return {
    externalId,
    title,
    description: metin(i.Description),
    brand: metin(i.Manufacturer),
    gtin: metin(i.Gtin),
    mpn: metin(i.Mpn),
    priceCents,
    compareAtPriceCents,
    currency,
    inStock,
    imageUrl: metin(i.ImageUrl),
    productUrl: metin(i.Url),
    category: metin(i.Category),
  };
}

/** `Items` yanıtı → teklif listesi. Çevrilemeyen kalemler düşer. */
export function impactParseCatalogItems(ham: unknown): CatalogOffer[] {
  return liste(ham, 'Items')
    .map(impactCatalogItemToOffer)
    .filter((o): o is CatalogOffer => o !== null);
}

/**
 * Bir `Actions` satırını ortak modele çevirir.
 *
 * Awin'deki kuralın aynısı: eksik tutar, tanınmayan durum ya da okunamayan
 * tarih → `null`. Yanlış bir komisyon kaydı, hiç kayıt olmamasından
 * kötüdür; mutabakat gerçek sanılan bir sayının üstüne kurulur ve fark
 * aylar sonra çıkar.
 */
export function impactActionToConversion(ham: unknown): PulledConversion | null {
  if (typeof ham !== 'object' || ham === null) return null;
  const a = ham as Record<string, unknown>;

  const orderId = metin(a.Id);
  if (orderId === null) return null;

  const networkMerchantId = metin(a.CampaignId);
  if (networkMerchantId === null) return null;

  const durumHam = metin(a.State)?.toLowerCase() ?? '';
  const status = DURUM_ESLEMESI[durumHam];
  /*
   * TANINMAYAN DURUM SESSİZCE `pending` SAYILMAZ. Impact sözlüğüne yeni
   * bir değer eklerse, gerçekte iptal edilmiş bir satırı gelir gibi
   * göstermek olurdu.
   */
  if (status === undefined) return null;

  const orderTotalCents = kurusaCevir(a.Amount);
  const commissionCents = kurusaCevir(a.Payout);
  if (orderTotalCents === null || commissionCents === null) return null;

  const currency = paraBirimi(a.Currency);
  if (currency === null) return null;

  const occurredAt = utcIsoYap(a.EventDate);
  if (occurredAt === null) return null;

  return {
    orderId,
    networkMerchantId,
    subid: impactSubId1ToSubid(a.SubId1),
    status,
    orderTotalCents,
    commissionCents,
    currency,
    occurredAt,
    // `ReferringDate` = kazanan tıklamanın zamanı; atıf penceresi denetimi
    // için Awin'deki `clickDate` ile aynı rolde.
    clickedAt: utcIsoYap(a.ReferringDate),
  };
}

/** `Actions` yanıtı → dönüşüm listesi. Çevrilemeyen satırlar düşer. */
export function impactParseActions(ham: unknown): PulledConversion[] {
  return liste(ham, 'Actions')
    .map(impactActionToConversion)
    .filter((c): c is PulledConversion => c !== null);
}

// ---------------------------------------------------------------------------
// SAĞLAYICI
// ---------------------------------------------------------------------------

/**
 * Postback yolunun neden kapalı olduğunu anlatan tek metin — hata
 * mesajında ve panelde aynısı görünür.
 */
const POSTBACK_KAPALI =
  'Impact donusumleri Actions API ile CEKILIR (pull), bildirimle alinmaz. ' +
  'Webhook imza semasi canli bir hesapla dogrulanmadigi icin imzasiz bir ' +
  'yazma yolu acilmadi.';

/**
 * `ProviderRequest` kurucusu.
 *
 * Kimlik bilgisi DEĞER olarak değil AD olarak taşınır; bu paket hiçbir
 * koşulda sır tutmaz. `Accept` açıkça JSON: Impact varsayılanı XML'dir ve
 * başlık unutulursa çözümleyiciler sessizce boş liste döndürürdü.
 */
function istek(url: string): ProviderRequest {
  return {
    method: 'GET',
    url,
    credential: {
      kind: 'basic',
      usernameEnv: IMPACT_SID_ENV,
      passwordEnv: IMPACT_TOKEN_ENV,
    },
    accept: 'application/json',
  };
}

/**
 * Hesap kimliği adresin parçası olduğu için çağıran onu vermek zorunda.
 * Sağlayıcı sırrı okumaz; yalnızca kimliği adrese yerleştirir.
 */
function hesapKimligi(context: { accountSid?: string }): string {
  const sid = metin(context.accountSid);
  if (sid === null) {
    throw new ProviderError(
      `Impact hesap kimligi verilmedi. Cagiran ${IMPACT_SID_ENV} degerini ` +
        'ortamdan okuyup gecmeli.',
      'invalid_payload',
    );
  }
  return sid;
}

export const impactProvider: AffiliateProvider = {
  network: 'impact',
  displayName: 'Impact',
  conversionSource: 'pull',

  capabilities: {
    programs: 'api',
    catalog: 'api',
    deeplink: 'template',
    clicks: 'local',
    conversions: 'pull',
    commissions: 'in_conversion',
  },

  limits: {
    // Dakikalık sınır YAYINLANMIYOR. `null` "sınırsız" demek değil,
    // "bilinmiyor" demek; çağıran saatlik kotaya göre planlar.
    requestsPerMinute: null,
    requestsPerHour: IMPACT_RATE_LIMIT_PER_HOUR,
    maxRangeDays: IMPACT_MAX_RANGE_DAYS,
    maxPageSize: IMPACT_MAX_PAGE_SIZE,
    maxPagedResults: IMPACT_MAX_PAGED_RESULTS,
  },

  verifyPostback(_context: PostbackContext): never {
    throw new ProviderError(POSTBACK_KAPALI, 'verification_unavailable');
  },

  normalizePostback(_payload: unknown): NormalizedConversion {
    throw new ProviderError(POSTBACK_KAPALI, 'verification_unavailable');
  },

  programsRequest(context: {
    accountSid?: string;
    page?: number;
    pageSize?: number;
  }): ProviderRequest {
    return istek(
      impactCampaignsUrl({
        accountSid: hesapKimligi(context),
        page: context.page,
        pageSize: context.pageSize,
      }),
    );
  },

  parsePrograms: impactParseCampaigns,

  catalogsRequest(context: { accountSid?: string; programId?: string }): ProviderRequest {
    return istek(
      impactCatalogsUrl({
        accountSid: hesapKimligi(context),
        campaignId: context.programId,
      }),
    );
  },

  catalogItemsRequest(context: {
    accountSid?: string;
    catalogId: string;
    page?: number;
    pageSize?: number;
  }): ProviderRequest {
    return istek(
      impactCatalogItemsUrl({
        accountSid: hesapKimligi(context),
        catalogId: context.catalogId,
        page: context.page,
        pageSize: context.pageSize,
      }),
    );
  },

  parseCatalogItems: impactParseCatalogItems,

  conversionsRequest(context: {
    accountSid?: string;
    startDate: Date;
    endDate: Date;
    programIds?: readonly string[];
  }): ProviderRequest {
    /*
     * ÇOK PROGRAMLI SORGU YOK. Impact `CampaignId` alanı TEK değer alır;
     * virgülle ayırmak Awin'de çalışır, burada çalışmaz. Birden fazla
     * program istendiğinde hepsini kapsayan (filtresiz) tur atılır ve
     * ayıklama bizde yapılır -- yanlış bir filtre sessizce eksik dönüşüm
     * döndürürdü.
     */
    const tekProgram =
      context.programIds && context.programIds.length === 1
        ? context.programIds[0]
        : undefined;

    return istek(
      impactActionsUrl({
        accountSid: hesapKimligi(context),
        startDate: context.startDate,
        endDate: context.endDate,
        campaignId: tekProgram,
      }),
    );
  },

  parsePulledConversions: impactParseActions,

  nextPageRequest(ham: unknown, previous: ProviderRequest): ProviderRequest | null {
    const url = impactSonrakiSayfaUrl(ham);
    if (url === null) return null;
    // Kimlik ve `Accept` bir önceki istekten taşınır: sayfalar arasında
    // başlık değiştirmek, ikinci sayfanın XML dönmesi demek olurdu.
    return { ...previous, url };
  },

  // buildDeeplink BILEREK TANIMSIZ: ortak sablon akisi Impact'i de karsiliyor.
};
