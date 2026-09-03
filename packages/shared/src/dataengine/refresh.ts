/**
 * Uyarlanabilir yenileme politikası.
 *
 * ÇÖZÜLEN PROBLEM
 * Bugün her kaynak aynı sıklıkta yokolanıyor: `schedule_cron` varsayılanı
 * 6 saat. Bu, fiyatı günde beş kez değişen bir elektronik ürünü de yılda
 * bir değişen bir yedek parçayı da aynı muameleye tabi tutuyor. Sonuç iki
 * taraflı zarar: sıcak ürünlerde bayat fiyat, soğuk ürünlerde boşa giden
 * istek.
 *
 * NEDEN DETERMİNİSTİK
 * Aynı girdi HER ZAMAN aynı planı üretir. Rastgelelik olsaydı aynı ürün
 * iki çalıştırmada farklı sınıfa düşer, "neden şimdi kontrol edildi"
 * sorusu cevaplanamaz ve hata ayıklama imkânsız hâle gelirdi. Jitter
 * gerekiyorsa PLANLAMADA değil, işin kuyruktan alınmasında uygulanır --
 * orada zaten var (`fail_job`).
 *
 * NEDEN "ÖĞRENİYOR" DEMİYORUM
 * Bu bir kural tablosu; model değil. Gerçek sonuç verisi biriktiğinde
 * ağırlıklar ölçümden türetilebilir. Bugün ölçüm yok, dolayısıyla
 * öğrenme de yok -- ve olduğunu söylemek yanlış olurdu.
 */

export const FRESHNESS_CLASSES = [
  'VERY_HOT',
  'HOT',
  'ACTIVE',
  'NORMAL',
  'COLD',
] as const;

export type FreshnessClass = (typeof FRESHNESS_CLASSES)[number];

/** Sınıf başına yenileme aralığı (dakika). İç hedef; garanti değil. */
export const REFRESH_WINDOWS: Record<FreshnessClass, { min: number; max: number }> = {
  VERY_HOT: { min: 1, max: 5 },
  HOT: { min: 5, max: 15 },
  ACTIVE: { min: 15, max: 30 },
  NORMAL: { min: 60, max: 360 },
  COLD: { min: 360, max: 1440 },
};

/** Kaynak sağlığı — `source_health()` enum'unun kod tarafındaki karşılığı. */
export type SourceHealthState =
  | 'saglikli'
  | 'yavas'
  | 'bayat'
  | 'basarisiz'
  | 'hic_calismadi';

export interface RefreshSignals {
  /**
   * Fiyat oynaklığı (0–1): son pencerede kaç kontrolde bir değişti.
   *
   * Değişim/kontrol oranı, `last_price_change_at` ve `price_checked_at`
   * damgalarından türetilir -- ikisi de bu yüzden ayrı tutuluyor.
   */
  priceVolatility: number;
  /** Stok durumu oynaklığı (0–1). */
  stockVolatility: number;
  /** Son pencerede aldığı görüntülenme, normalize (0–1). */
  traffic: number;
  /** Dönüşüm oranı (0–1). */
  conversionRate: number;
  /** Ohaaaa Skor (0–100) ya da ölçülemediyse null. */
  opportunityScore: number | null;
  /** Beklenen komisyon değeri, normalize (0–1). */
  revenueValue: number;
  health: SourceHealthState;
  /** Devre kesici açık mı? */
  breakerOpen?: boolean;
}

export interface RefreshPlan {
  freshnessClass: FreshnessClass;
  intervalMinutes: number;
  nextRefreshAt: Date;
  priority: 'kritik' | 'yuksek' | 'normal' | 'dusuk';
  /** Kararın hangi sinyallerden çıktığı — hata ayıklama için. */
  reasons: string[];
}

/** Sinyalleri 0–1 aralığına kırpar; bozuk girdi planı çökertmemeli. */
function kirp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Yenileme planı üretir.
 *
 * SAĞLIKSIZ KAYNAK DAHA SIK YOKLANMAZ.
 *
 * Bu, sezgiye aykırı ama kritik: veri bayatladığı için "daha çok
 * deneyelim" demek, çöken bir kaynağa yüklenmek ve toparlanmasını
 * geciktirmektir. Kaynak sağlıksızken sıklık DÜŞÜRÜLÜR; devre kesici
 * zaten isteği engelliyorsa iş üretmenin hiçbir faydası yok.
 */
export function computeRefreshPlan(
  signals: RefreshSignals,
  now: Date = new Date(),
): RefreshPlan {
  const reasons: string[] = [];

  const fiyat = kirp(signals.priceVolatility);
  const stok = kirp(signals.stockVolatility);
  const trafik = kirp(signals.traffic);
  const donusum = kirp(signals.conversionRate);
  const gelir = kirp(signals.revenueValue);

  /*
   * Ağırlıklar ÖLÇÜMDEN değil, karardan geliyor ve bu açıkça yazılı.
   * Oynaklık en ağır çünkü yenilemenin sebebi odur: değişmeyen bir şeyi
   * sık kontrol etmenin faydası yok. Trafik ikinci: kimsenin bakmadığı
   * bir ürünün bayat olması kimseyi yanıltmaz.
   */
  let puan = fiyat * 0.35 + stok * 0.2 + trafik * 0.2 + donusum * 0.1 + gelir * 0.15;

  if (fiyat >= 0.5) reasons.push('yuksek_fiyat_oynakligi');
  if (stok >= 0.5) reasons.push('yuksek_stok_oynakligi');
  if (trafik >= 0.5) reasons.push('yuksek_trafik');

  // Ölçülemeyen skor puanı DEĞİŞTİRMEZ. Bilinmeyeni sıfır saymak, skoru
  // düşük bir fırsat gibi davranmak olurdu.
  if (signals.opportunityScore !== null) {
    const skor = kirp(signals.opportunityScore / 100);
    puan = puan * 0.85 + skor * 0.15;
    if (skor >= 0.8) reasons.push('yuksek_firsat_skoru');
  } else {
    reasons.push('firsat_skoru_olculmedi');
  }

  const saglikli = signals.health === 'saglikli';
  const devreAcik = signals.breakerOpen === true;

  if (!saglikli || devreAcik) {
    /*
     * Sağlıksız kaynak en soğuk sınıfa düşer ve düşük önceliğe alınır.
     * Not: bu bir CEZA değil, koruma -- kaynak toparlandığında sinyaller
     * yine yükselecek ve sınıf kendiliğinden geri çıkacak.
     */
    reasons.push(devreAcik ? 'devre_kesici_acik' : `kaynak_${signals.health}`);
    return plan('COLD', 'dusuk', now, reasons);
  }

  if (puan >= 0.8) return plan('VERY_HOT', 'kritik', now, reasons);
  if (puan >= 0.6) return plan('HOT', 'yuksek', now, reasons);
  if (puan >= 0.4) return plan('ACTIVE', 'yuksek', now, reasons);
  if (puan >= 0.15) return plan('NORMAL', 'normal', now, reasons);

  reasons.push('dusuk_sinyal');
  return plan('COLD', 'dusuk', now, reasons);
}

function plan(
  freshnessClass: FreshnessClass,
  priority: RefreshPlan['priority'],
  now: Date,
  reasons: string[],
): RefreshPlan {
  const pencere = REFRESH_WINDOWS[freshnessClass];

  /*
   * Aralık pencerenin ORTASI.
   *
   * Alt sınır seçmek her sınıfı bir üstü gibi davrandırır ve sınıfların
   * anlamını siler; üst sınır ise sınıf yükselmesinin faydasını yok
   * eder. Orta nokta deterministik ve sınıflar arasında boşluk bırakır.
   */
  const intervalMinutes = Math.round((pencere.min + pencere.max) / 2);

  return {
    freshnessClass,
    intervalMinutes,
    nextRefreshAt: new Date(now.getTime() + intervalMinutes * 60_000),
    priority,
    reasons,
  };
}
