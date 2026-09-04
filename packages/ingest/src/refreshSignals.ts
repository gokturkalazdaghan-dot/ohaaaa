import {
  computeRefreshPlan,
  effectiveIntervalMinutes,
  schedulingPolicyFor,
  type RefreshPlan,
  type RefreshSignals,
  type SourceHealthState,
} from '@ohaaaa/shared';

import type { IngestSummary } from './types.js';

/**
 * Alım sonucundan yenileme sinyalleri.
 *
 * BU DOSYANIN TAMAMI BİR EŞLEME. Yeni bir politika icat etmiyor;
 * `computeRefreshPlan`'ın beklediği sinyalleri gerçek alım sonucundan
 * türetiyor. Eşik ya da ağırlık burada yok -- olsaydı iki ayrı politika
 * olurdu ve hangisinin geçerli olduğu belirsizleşirdi.
 *
 * ELİMDE OLMAYAN SİNYALİ UYDURMUYORUM
 * `RefreshSignals` altı sinyal bekliyor. Alım sonucundan gerçekten
 * türetilebilen tek şey DEĞİŞİM ORANI. Trafik, dönüşüm, gelir ve fırsat
 * skoru için veri YOK (clicks = 0, conversions = 0) ve bunlara tahmini
 * değer vermek, ölçmediğimiz bir şeyi ölçmüş gibi göstermek olurdu.
 *
 * Bunun ölçülebilir sonucu şu: trafik verisi olmadan hiçbir kaynak
 * VERY_HOT ya da HOT olamıyor, en fazla ACTIVE oluyor. Bu bir eksiklik
 * DEĞİL, doğru davranış: bir feed'in her turda değişmesi tek başına onu
 * 2 dakikada bir yoklamayı haklı çıkarmaz -- kimsenin bakmadığı bir
 * ürünün bayat olması kimseyi yanıltmaz. VERY_HOT, birinin gerçekten
 * baktığına dair kanıt ister.
 */

/**
 * Alım özetinden değişim oranı.
 *
 * (NEW + CHANGED) / görülen. Bu, feed'in KENDİ oynaklığının doğrudan
 * ölçüsü ve delta sayaçları sayesinde artık gerçek bir sayı.
 *
 * Fiyat ve stok oynaklığı AYRI AYRI türetilemiyor: parmak izi tek bir
 * özet, hangi alanın değiştiğini söylemiyor. Bu yüzden aynı oran her
 * ikisine de veriliyor ve bu durum burada açıkça yazılı -- ileride
 * alan bazlı fark gerekirse `last_price_change_at` /
 * `last_stock_change_at` damgaları zaten mevcut.
 */
export function changeRate(summary: IngestSummary): number {
  if (summary.itemsSeen <= 0) return 0;
  const degisen = summary.itemsNew + summary.itemsChanged;
  return Math.min(1, degisen / summary.itemsSeen);
}

/** `sources.last_status` benzeri durumdan sağlık durumu. */
export function healthFromSummary(summary: IngestSummary): SourceHealthState {
  if (summary.status === 'failed') return 'basarisiz';

  /*
   * KISMİ GÖRÜNTÜ "YAVAŞ" SAYILIR, "SAĞLIKLI" DEĞİL.
   *
   * Kırpılmış ya da büyük ölçüde elenen bir turda değişim oranı
   * güvenilmez: eksik kalemler "değişmedi" gibi görünür. Sağlıklı
   * saymak, eksik bir ölçüme dayanarak yoklamayı seyrekleştirmek
   * olurdu -- yani arızayı ödüllendirmek.
   */
  if (!summary.snapshotComplete || summary.status === 'partial') return 'yavas';

  return 'saglikli';
}

export interface RefreshPlanResult {
  plan: RefreshPlan;
  /** Sağlık politikası uygulandıktan sonraki gerçek aralık. */
  effectiveIntervalMinutes: number;
  nextRefreshAt: Date;
  signals: RefreshSignals;
}

/**
 * Alım sonucundan bir sonraki yoklama zamanı.
 *
 * İKİ KATMAN ÜST ÜSTE:
 *   1. `computeRefreshPlan` — sinyallere göre ideal aralık
 *   2. `schedulingPolicyFor` — kaynak sağlığına göre geri çekilme
 *
 * İkincisi olmadan, çöken bir kaynak "hiçbir şey değişmedi" sinyali
 * ürettiği için COLD'a düşer ve 12 saat beklerdi -- yanlış sebeple doğru
 * sonuç. Sağlık katmanı bunu açık bir karara çeviriyor.
 */
export function planNextRefresh(
  summary: IngestSummary,
  now: Date = new Date(),
): RefreshPlanResult {
  const oran = changeRate(summary);
  const health = healthFromSummary(summary);

  const signals: RefreshSignals = {
    priceVolatility: oran,
    stockVolatility: oran,
    // Aşağıdakiler için VERİ YOK. Sıfır burada "ölçmedik" demek ve
    // tahmini bir değer koymak ölçmediğimizi ölçmüş gibi göstermek olurdu.
    traffic: 0,
    conversionRate: 0,
    opportunityScore: null,
    revenueValue: 0,
    health,
  };

  const plan = computeRefreshPlan(signals, now);
  const policy = schedulingPolicyFor(health);
  const gercekAralik = effectiveIntervalMinutes(plan.intervalMinutes, policy);

  return {
    plan,
    effectiveIntervalMinutes: gercekAralik,
    nextRefreshAt: new Date(now.getTime() + gercekAralik * 60_000),
    signals,
  };
}
