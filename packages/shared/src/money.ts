/**
 * Para birimi yardımcıları.
 *
 * TEMEL KURAL: Tutarlar sistemin HER katmanında tam sayı "minor unit"
 * (kuruş) olarak taşınır. Float aritmetiği finansal hesapta yuvarlama
 * hatası üretir (0.1 + 0.2 !== 0.3), bu yüzden hiçbir yerde ondalıklı
 * sayı ile tutar taşınmaz — yalnızca gösterim anında biçimlendirilir.
 */

/** Desteklenen para birimleri. */
export const SUPPORTED_CURRENCIES = ['TRY', 'USD', 'EUR'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const CURRENCY_LOCALES: Record<Currency, string> = {
  TRY: 'tr-TR',
  USD: 'en-US',
  EUR: 'de-DE',
};

/**
 * Kuruş cinsinden tutarı yerelleştirilmiş metne çevirir.
 * @example formatMoney(5499900) // "54.999,00 ₺"
 */
export function formatMoney(cents: number, currency: Currency = 'TRY'): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency], {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Kısaltılmış gösterim — analitik kartları ve grafik eksenleri için.
 * @example formatMoneyCompact(125_400_000) // "1,3 Mn ₺"
 */
export function formatMoneyCompact(cents: number, currency: Currency = 'TRY'): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency], {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

/**
 * Kullanıcı girdisini ("1.299,90" / "1299.90" / "1299") kuruşa çevirir.
 * Türkçe (1.299,90) ve İngilizce (1,299.90) ayırıcıların ikisini de kabul eder.
 *
 * @returns kuruş cinsinden tam sayı, geçersiz girdide null
 */
export function parseMoneyToCents(input: string): number | null {
  const trimmed = input.trim().replace(/[^\d.,-]/g, '');
  if (trimmed === '' || trimmed === '-') return null;

  const lastComma = trimmed.lastIndexOf(',');
  const lastDot = trimmed.lastIndexOf('.');

  // Ondalık ayırıcı, en SONDA gelen ayırıcıdır; diğeri binlik ayırıcıdır.
  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = trimmed;
  } else if (lastComma > lastDot) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = trimmed.replace(/,/g, '');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  // Yuvarlama: 0.5 kuruş yukarı. Float kalıntısını (12.345 * 100 = 1234.4999)
  // temizlemek için önce sabit hassasiyete indirilir.
  return Math.round(Number(value.toFixed(2)) * 100);
}

/**
 * Komisyon tutarı. Veritabanındaki create_order() ile BİREBİR aynı kuralı
 * uygular: aşağı yuvarlama (floor) — yani yuvarlama farkı taşeron lehinedir.
 * İki hesap ayrışırsa panelde gösterilen hakediş, gerçek ödemeyle uyuşmaz.
 */
export function calculateCommission(lineTotalCents: number, commissionRate: number): number {
  return Math.floor(lineTotalCents * commissionRate);
}

/** İndirim yüzdesi (tam sayı). İndirim yoksa null. */
export function discountPercent(
  priceCents: number,
  compareAtPriceCents: number | null | undefined,
): number | null {
  if (!compareAtPriceCents || compareAtPriceCents <= priceCents) return null;
  return Math.round(((compareAtPriceCents - priceCents) / compareAtPriceCents) * 100);
}
