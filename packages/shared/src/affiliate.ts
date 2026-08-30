/**
 * Affiliate link üretimi ve güvenli yönlendirme.
 *
 * GÜVENLİK: Bu modülün en kritik işi `assertSafeRedirect`'tir. `/git/:id`
 * benzeri bir yönlendirme uç noktası, hedef adres dışarıdan etkilenebiliyorsa
 * "açık yönlendirme" (open redirect) açığıdır: saldırgan
 * `ohaaaa.com/git/…` görünümlü bir linkle kullanıcıyı kimlik avı sitesine
 * taşır ve alan adımızın itibarını kullanır.
 *
 * Bu yüzden hedef adres DAİMA veritabanından gelir ve yayına çıkmadan önce
 * mağazanın izinli alan adlarıyla karşılaştırılır.
 */

import { randomBytes } from 'node:crypto';

/** Şablonda desteklenen yer tutucular. */
export const DEEPLINK_PLACEHOLDERS = [
  '{url}',
  '{url_encoded}',
  '{tracking_id}',
  '{subid}',
] as const;

export interface DeeplinkInput {
  /** merchants.deeplink_template */
  template: string;
  /** products.product_url — mağazadaki ürün sayfası */
  productUrl: string;
  /** merchants.tracking_id — yayıncı kimliğimiz */
  trackingId: string | null;
  /** Bu tıklama için üretilen izleme kimliği */
  subid: string;
  /**
   * İzin verilen hedef alan adları. Şablon bir ağ üzerinden gidiyorsa ağın
   * alan adı da buraya girer.
   */
  allowedHosts: string[];
}

export class AffiliateLinkError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_template'
      | 'invalid_product_url'
      | 'missing_tracking_id'
      | 'unsafe_redirect',
  ) {
    super(message);
    this.name = 'AffiliateLinkError';
  }
}

/**
 * Tıklama izleme kimliği üretir.
 *
 * 24 bayt (192 bit) → 32 karakter base64url. Tahmin edilemez olmalıdır:
 * subid tahmin edilebilirse üçüncü taraflar sahte dönüşüm bildirip
 * raporlarımızı kirletebilir.
 *
 * Biçim `clicks_subid_format` kısıtıyla uyumludur: [A-Za-z0-9_-]{16,64}
 */
export function generateSubId(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Yönlendirme (deeplink) adresini üretir.
 *
 * Kodlama kuralı: `{url}` ham, `{url_encoded}` yüzde-kodlanmış eklenir.
 * Şablon hedefi bir sorgu parametresi olarak taşıyorsa `{url_encoded}`
 * kullanılmalıdır; aksi halde hedefteki `&` işaretleri ağın kendi
 * parametrelerini bozar ve tıklama kaybolur.
 */
export function buildAffiliateUrl(input: DeeplinkInput): string {
  const { template, productUrl, trackingId, subid, allowedHosts } = input;

  if (!template || template.trim() === '') {
    throw new AffiliateLinkError(
      'Mağazanın yönlendirme şablonu tanımlı değil.',
      'invalid_template',
    );
  }

  if (!template.includes('{url}') && !template.includes('{url_encoded}')) {
    throw new AffiliateLinkError(
      'Şablon {url} veya {url_encoded} içermeli; aksi halde ürün sayfasına gidilemez.',
      'invalid_template',
    );
  }

  if (template.includes('{tracking_id}') && !trackingId) {
    // Takipsiz link üretmek, trafiği bedavaya vermek demektir.
    throw new AffiliateLinkError(
      'Şablon tracking_id istiyor ama mağazada tanımlı değil.',
      'missing_tracking_id',
    );
  }

  const target = parseHttpUrl(productUrl);
  if (!target) {
    throw new AffiliateLinkError(
      `Geçersiz ürün adresi: ${productUrl}`,
      'invalid_product_url',
    );
  }

  const built = template
    .replaceAll('{url_encoded}', encodeURIComponent(target.toString()))
    .replaceAll('{url}', target.toString())
    .replaceAll('{tracking_id}', trackingId ?? '')
    .replaceAll('{subid}', subid);

  const finalUrl = parseHttpUrl(built);
  if (!finalUrl) {
    throw new AffiliateLinkError(
      'Şablon geçerli bir adres üretmedi.',
      'invalid_template',
    );
  }

  assertSafeRedirect(finalUrl, allowedHosts);

  return finalUrl.toString();
}

/**
 * Hedefin izinli alan adlarından birine ait olduğunu doğrular.
 *
 * `example.com` girildiyse `www.example.com` ve `shop.example.com` da kabul
 * edilir; ancak `example.com.saldirgan.net` KABUL EDİLMEZ — bu, alan adı
 * eşleştirmesinde en sık yapılan hatadır (`endsWith` ile kontrol etmek
 * tam olarak bu açığı üretir).
 */
export function assertSafeRedirect(url: URL, allowedHosts: string[]): void {
  if (allowedHosts.length === 0) {
    throw new AffiliateLinkError(
      'İzinli alan adı listesi boş; yönlendirme reddedildi.',
      'unsafe_redirect',
    );
  }

  const host = url.hostname.toLowerCase();

  const allowed = allowedHosts.some((candidate) => {
    const base = normalizeHost(candidate);
    if (!base) return false;
    return host === base || host.endsWith(`.${base}`);
  });

  if (!allowed) {
    throw new AffiliateLinkError(
      `Yönlendirme hedefi izinli değil: ${host}`,
      'unsafe_redirect',
    );
  }
}

/**
 * Bir mağaza için izinli alan adı listesini çıkarır.
 * Ana sayfa alan adı ve şablonun kendi alan adı (ağ üzerinden gidiliyorsa)
 * otomatik olarak izinlidir.
 */
export function allowedHostsForMerchant(merchant: {
  homepageUrl: string;
  deeplinkTemplate: string | null;
  extraHosts?: string[];
}): string[] {
  const hosts = new Set<string>();

  const homepage = parseHttpUrl(merchant.homepageUrl);
  if (homepage) hosts.add(homepage.hostname.toLowerCase());

  if (merchant.deeplinkTemplate) {
    // Şablonun kendi ana gövdesi (yer tutucular çıkarılmış hâli) bir ağ
    // adresi olabilir; onu da izinli sayarız.
    const skeleton = merchant.deeplinkTemplate
      .replaceAll('{url_encoded}', 'x')
      .replaceAll('{url}', 'https://x.invalid/')
      .replaceAll('{tracking_id}', 'x')
      .replaceAll('{subid}', 'x');

    const templateUrl = parseHttpUrl(skeleton);
    if (templateUrl && templateUrl.hostname !== 'x.invalid') {
      hosts.add(templateUrl.hostname.toLowerCase());
    }
  }

  for (const extra of merchant.extraHosts ?? []) {
    const normalized = normalizeHost(extra);
    if (normalized) hosts.add(normalized);
  }

  return [...hosts];
}

/**
 * Beklenen komisyon (kuruş).
 *
 * Aşağı yuvarlanır — sistemin geri kalanıyla aynı kural. Bu bir TAHMİNDİR:
 * gerçek komisyon ağın onayından sonra `conversions.commission_cents`
 * alanından okunur. Panelde ikisi ayrı gösterilmelidir, aksi halde
 * gerçekleşmemiş gelir gerçekmiş gibi görünür.
 */
export function estimateCommission(
  priceCents: number,
  offerRate: number | null | undefined,
  merchantDefaultRate: number,
): number {
  const rate = offerRate ?? merchantDefaultRate;
  return Math.floor(priceCents * rate);
}

/** http/https dışındaki şemaları reddeder (javascript:, data: …). */
function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

function normalizeHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') return null;

  // Kullanıcı tam adres girmiş olabilir.
  if (trimmed.includes('://')) {
    const parsed = parseHttpUrl(trimmed);
    return parsed ? parsed.hostname : null;
  }

  return trimmed.replace(/^www\./, '');
}
