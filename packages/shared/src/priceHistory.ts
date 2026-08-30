/**
 * Fiyat geçmişi yorumlama.
 *
 * Bir fiyat karşılaştırma sitesinin asıl işi fiyatı göstermek değil, fiyatın
 * ANLAMINI göstermektir. "%16 indirim" etiketi satıcının beyanıdır; bizim
 * katkımız o beyanı gözlemlediğimiz geçmişle karşılaştırmaktır.
 *
 * MEVZUAT ZEMİNİ
 * Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği, indirimli satışta
 * referans fiyatın indirimden önceki son 30 gün içindeki EN DÜŞÜK fiyat
 * olmasını arar. Satıcı daha yüksek bir fiyatı referans gösteriyorsa indirim
 * olduğundan büyük görünür.
 *
 * DİKKAT — SUÇLAMA DEĞİL, GÖZLEM
 * Yeterli gözlemimiz yoksa hüküm vermeyiz. Üç günlük veriyle "bu indirim
 * sahte" demek, satıcıya haksızlık ve bizim için itibar riskidir. Bu yüzden
 * yetersiz veride `null` döner ve arayüz sessiz kalır.
 */

/** Bir günün, gruptaki tüm tekliflerdeki en düşük fiyatı. */
export interface PricePoint {
  /** ISO tarih (YYYY-MM-DD). */
  day: string;
  minPriceCents: number;
}

export interface PriceSummary {
  /** Yorum yapmaya yetecek gözlem var mı? */
  available: boolean;
  /** Gözlem yapılan gün sayısı. */
  observedDays: number;
  lowestCents: number;
  highestCents: number;
  averageCents: number;
  currentCents: number;
  /** Şu anki fiyat, gözlenen en düşükle aynı mı? */
  isAtLowest: boolean;
  /** Şu anki fiyat en düşüğün yüzde kaç üstünde (tam sayı). */
  aboveLowestPercent: number;
}

/** İndirim iddiasının geçmişle tutarlılığı. */
export type DiscountVerdict =
  | { kind: 'insufficient-data' }
  | { kind: 'consistent'; referenceCents: number; lowest30Cents: number }
  | { kind: 'overstated'; referenceCents: number; lowest30Cents: number; realPercent: number };

/** Yorum için gereken en az gözlem günü. Altında hüküm verilmez. */
export const MIN_OBSERVED_DAYS = 7;

export function summarizePriceHistory(
  points: readonly PricePoint[],
  currentCents: number,
): PriceSummary {
  if (points.length === 0) {
    return {
      available: false,
      observedDays: 0,
      lowestCents: currentCents,
      highestCents: currentCents,
      averageCents: currentCents,
      currentCents,
      isAtLowest: true,
      aboveLowestPercent: 0,
    };
  }

  const prices = points.map((p) => p.minPriceCents);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  // Ortalama kuruşta tam sayı kalmalı: yarım kuruş diye bir şey yok.
  const average = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

  return {
    available: points.length >= MIN_OBSERVED_DAYS,
    observedDays: points.length,
    lowestCents: lowest,
    highestCents: highest,
    averageCents: average,
    currentCents,
    isAtLowest: currentCents <= lowest,
    aboveLowestPercent:
      lowest > 0 ? Math.round(((currentCents - lowest) / lowest) * 100) : 0,
  };
}

/**
 * Satıcının indirim iddiasını son 30 günün en düşüğüyle karşılaştırır.
 *
 * @param referenceCents Satıcının "eski fiyat" olarak gösterdiği tutar.
 * @param points         Gözlenen günlük en düşük fiyatlar.
 * @param today          Bugünün tarihi (test edilebilirlik için).
 */
export function assessDiscountClaim(
  referenceCents: number | null,
  points: readonly PricePoint[],
  today: Date = new Date(),
): DiscountVerdict {
  if (referenceCents === null || referenceCents <= 0) {
    return { kind: 'insufficient-data' };
  }

  /*
   * "Son 30 gün" BUGÜN DAHİL 30 gündür: today-29 .. today.
   *
   * İlk yazılışta 30 çıkarılıyordu ve pencere 31 gün oluyordu; tam 30 gün
   * önceki bir gözlem içeri sızıyordu. Bu, ucuz bir eski günün pencereye
   * girip satıcının indirim iddiasını haksız yere "abartılmış" göstermesine
   * yol açardı. Birim testi yakaladı.
   */
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - 29);
  const cutoffDay = cutoff.toISOString().slice(0, 10);

  const window = points.filter((p) => p.day >= cutoffDay);
  if (window.length < MIN_OBSERVED_DAYS) {
    return { kind: 'insufficient-data' };
  }

  const lowest30 = Math.min(...window.map((p) => p.minPriceCents));

  // Referans, gözlenen en düşükten yüksekse indirim olduğundan büyük görünür.
  // Eşitlik ve altı sorun değil: satıcı kendi aleyhine bir referans seçmiş
  // olabilir, bu bizim itiraz edeceğimiz bir şey değil.
  if (referenceCents <= lowest30) {
    return { kind: 'consistent', referenceCents, lowest30Cents: lowest30 };
  }

  const current = window[window.length - 1]!.minPriceCents;
  const realPercent =
    lowest30 > 0 ? Math.round(((lowest30 - current) / lowest30) * 100) : 0;

  return { kind: 'overstated', referenceCents, lowest30Cents: lowest30, realPercent };
}
