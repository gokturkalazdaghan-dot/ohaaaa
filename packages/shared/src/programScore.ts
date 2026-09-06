/**
 * Program puanlama motoru — saf, belirlenimci, ağdan bağımsız.
 *
 * ======================================================================
 * EN ÖNEMLİ KARAR: BİLİNMEYEN VERİ CEZALANDIRILMAZ
 * ======================================================================
 * Naif yaklaşım, eksik alanı 0 saymaktır. O zaman komisyonu %15 olan ama
 * EPC'sini yayınlamayan bir program, komisyonu %2 olan ama her alanı dolu
 * bir programın ALTINDA kalır. Sonuç: sistem, veriyi çok yayınlayan ağları
 * ödüllendirir -- iyi programları değil. Bu sessizdir ve sıralamaya bakan
 * kimse sebebini göremez.
 *
 * Bu yüzden bilinmeyen bileşen puana HİÇ GİRMEZ: ne pay ne paydada. Skor,
 * yalnızca BİLİNEN bileşenler üzerinden ağırlıklı ortalamadır.
 *
 *   skor = 100 × Σ(ağırlık × normalize) / Σ(bilinen bileşenlerin ağırlığı)
 *
 * Böylece tek bilinen alanı komisyon olan bir program, o komisyona göre
 * hak ettiği puanı alır; "veri yok" diye dibe düşmez.
 *
 * ======================================================================
 * GERÇEK 0 İLE NULL AYRI
 * ======================================================================
 * `commissionRate = 0` komisyonsuz bir programdır ve BİLİNEN bir gerçektir:
 * o bileşen 0 puan alır ve paydaya girer. `commissionRate = null` ise
 * "ağ yayınlamamış"tır: bileşen hiç hesaplanmaz. İkisini aynı kefeye
 * koymak, bilinmeyeni kötü ilan etmek olurdu.
 *
 * ======================================================================
 * HİÇBİR ŞEY BİLİNMİYORSA SKOR YOKTUR
 * ======================================================================
 * Payda 0 olduğunda 0/0 = NaN üretmek yerine `null` dönüyor. "Puanlanamadı"
 * ile "0 puan aldı" farklı şeylerdir ve şema da bunu ayırıyor
 * (`score` nullable).
 *
 * ======================================================================
 * BELİRLENİMCİ
 * ======================================================================
 * Saf fonksiyon: I/O yok, rastgelelik yok, `Date.now()` yok. Tazelik
 * bileşeni için gereken "şimdi" çağıran tarafından VERİLİR. Aynı girdi her
 * zaman aynı çıktıyı üretir; testler bunu açıkça kilitliyor.
 */

/** Puanlanan bileşenler. Ağırlıklar SABİT ve toplamı 100. */
export const SCORE_WEIGHTS = {
  commission: 25,
  epc: 20,
  feed: 15,
  cookie: 10,
  marketFit: 10,
  productCount: 7,
  aov: 5,
  capability: 5,
  freshness: 3,
} as const;

export type ScoreComponent = keyof typeof SCORE_WEIGHTS;

export const SCORE_COMPONENTS = Object.keys(SCORE_WEIGHTS) as ScoreComponent[];

/** Ağırlık toplamı 100 olmalı; olmazsa modül yüklenirken düşer. */
const TOPLAM_AGIRLIK = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
if (TOPLAM_AGIRLIK !== 100) {
  throw new Error(`Agirlik toplami 100 olmali, bulunan ${TOPLAM_AGIRLIK}.`);
}

/**
 * Normalizasyon tavanları — bir bileşenin "tam puan" aldığı değer.
 *
 * Açıkça sabit: puanların karşılaştırılabilir olması, tavanların turdan
 * tura değişmemesine bağlı. Değiştirilirse eski skorlar yeni skorlarla
 * kıyaslanamaz hâle gelir ve bu yüzden değişiklik bilinçli olmalı.
 */
export const SCORE_SCALES = {
  /** %20 ve üstü komisyon tam puan. */
  commissionFull: 0.2,
  /** 200 kuruş (2 birim) EPC tam puan. */
  epcCentsFull: 200,
  /** 20 000 kuruş (200 birim) AOV tam puan. */
  aovCentsFull: 20_000,
  /** 60 gün ve üstü çerez tam puan. */
  cookieDaysFull: 60,
  /** 100 000 ürün tam puan (logaritmik). */
  productCountFull: 100_000,
  /** 30 günden eski doğrulama sıfır tazelik. */
  freshnessDays: 30,
} as const;

export interface ScoreInput {
  commissionRate: number | null;
  epcCents: number | null;
  aovCents: number | null;
  cookieWindowDays: number | null;
  feedAvailable: boolean | null;
  productCount: number | null;
  marketCode: string | null;
  countryCode: string | null;
  deeplinkSupported: boolean | null;
  applicationSupported: boolean | null;
  /** ISO-8601. Tazelik bileşeni için. */
  lastVerifiedAt: string | null;
}

export interface ScoreOptions {
  /** Tazeliğin ölçüleceği an. Belirlenimcilik için ZORUNLU. */
  now: Date;
  /**
   * Hedef pazarlarımız. Verilirse `marketCode` bu kümede mi diye bakılır;
   * verilmezse pazarın BİLİNİYOR olması yeterli sayılır.
   */
  targetMarkets?: readonly string[];
}

export interface ScoreContribution {
  component: ScoreComponent;
  /** Ham girdi; bilinmiyorsa null. */
  raw: number | boolean | string | null;
  /** 0-1 arası normalize değer; bilinmiyorsa null. */
  normalized: number | null;
  weight: number;
  /** weight × normalized; bilinmiyorsa 0 (paya da paydaya da girmez). */
  contribution: number;
  /** Bileşen hesaba katıldı mı. */
  applicable: boolean;
}

export interface ScoreResult {
  /** 0-100, iki ondalık. Hiçbir bileşen bilinmiyorsa null. */
  score: number | null;
  breakdown: ScoreContribution[];
  /** Hesaba katılan ağırlıkların toplamı. */
  applicableWeight: number;
  /** Σ(weight × normalized). `score` bundan türetilir. */
  earnedWeight: number;
}

export class ScoreError extends Error {
  constructor(
    message: string,
    readonly component: ScoreComponent | null,
  ) {
    super(message);
    this.name = 'ScoreError';
  }
}

/**
 * Sonlu sayı kapısı — KAPALI BAŞARISIZ.
 *
 * NaN ya da Infinity bir bileşene sızarsa toplam da NaN olur ve `score`
 * sessizce anlamsızlaşır; veritabanı kısıtı da NaN'ı yakalayamaz
 * (NaN >= 0 yanlıştır ama numeric NaN farklı davranır). Bu yüzden
 * hesaplamadan ÖNCE reddediliyor: bozuk skor üretmektense skor
 * ÜRETMEMEK yeğdir.
 */
function sonluOlmali(
  value: number | null,
  component: ScoreComponent,
  alan: string,
): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ScoreError(
      `${alan} sonlu bir sayi olmali; bulunan: ${String(value)}`,
      component,
    );
  }
  return value;
}

/** 0-1 aralığına kırpar. Tavanı aşan gerçek değerler tam puan alır. */
function birimAralik(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function scoreProgram(input: ScoreInput, options: ScoreOptions): ScoreResult {
  const { now, targetMarkets } = options;

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ScoreError('Gecerli bir "now" verilmeli.', null);
  }

  const normalized: Record<ScoreComponent, number | null> = {
    commission: null,
    epc: null,
    feed: null,
    cookie: null,
    marketFit: null,
    productCount: null,
    aov: null,
    capability: null,
    freshness: null,
  };

  const ham: Record<ScoreComponent, number | boolean | string | null> = {
    commission: input.commissionRate,
    epc: input.epcCents,
    feed: input.feedAvailable,
    cookie: input.cookieWindowDays,
    marketFit: input.marketCode ?? input.countryCode,
    productCount: input.productCount,
    aov: input.aovCents,
    capability: null,
    freshness: input.lastVerifiedAt,
  };

  // --- komisyon: 0 GEÇERLİ bir değer, null değil -------------------------
  const komisyon = sonluOlmali(input.commissionRate, 'commission', 'commissionRate');
  if (komisyon !== null) {
    if (komisyon < 0) throw new ScoreError('commissionRate negatif olamaz.', 'commission');
    normalized.commission = birimAralik(komisyon / SCORE_SCALES.commissionFull);
  }

  const epc = sonluOlmali(input.epcCents, 'epc', 'epcCents');
  if (epc !== null) {
    if (epc < 0) throw new ScoreError('epcCents negatif olamaz.', 'epc');
    normalized.epc = birimAralik(epc / SCORE_SCALES.epcCentsFull);
  }

  const aov = sonluOlmali(input.aovCents, 'aov', 'aovCents');
  if (aov !== null) {
    if (aov < 0) throw new ScoreError('aovCents negatif olamaz.', 'aov');
    normalized.aov = birimAralik(aov / SCORE_SCALES.aovCentsFull);
  }

  const cerez = sonluOlmali(input.cookieWindowDays, 'cookie', 'cookieWindowDays');
  if (cerez !== null) {
    if (cerez < 0) throw new ScoreError('cookieWindowDays negatif olamaz.', 'cookie');
    normalized.cookie = birimAralik(cerez / SCORE_SCALES.cookieDaysFull);
  }

  // --- feed: boolean, bilinmiyorsa null ---------------------------------
  if (input.feedAvailable !== null) {
    normalized.feed = input.feedAvailable ? 1 : 0;
  }

  // --- ürün sayısı: LOGARİTMİK ------------------------------------------
  // Doğrusal olsaydı 100 000 ürünlü tek bir program, 5 000 ürünlü bir
  // programı ezerdi; oysa katalog derinliğinin faydası doğrusal değil.
  const urun = sonluOlmali(input.productCount, 'productCount', 'productCount');
  if (urun !== null) {
    if (urun < 0) throw new ScoreError('productCount negatif olamaz.', 'productCount');
    normalized.productCount = birimAralik(
      Math.log10(urun + 1) / Math.log10(SCORE_SCALES.productCountFull + 1),
    );
  }

  // --- pazar uyumu -------------------------------------------------------
  if (input.marketCode !== null) {
    normalized.marketFit = targetMarkets
      ? targetMarkets.includes(input.marketCode)
        ? 1
        : 0
      : 1;
  } else if (input.countryCode !== null) {
    // Ülke biliniyor ama pazar eşlemesi yok: kısmi bilgi, tam puan değil.
    normalized.marketFit = 0.5;
  }

  // --- yetenekler: ikisi de bilinmiyorsa bileşen yok ---------------------
  if (input.deeplinkSupported !== null || input.applicationSupported !== null) {
    const deeplink = input.deeplinkSupported === true ? 1 : 0;
    const basvuru = input.applicationSupported === true ? 1 : 0;
    normalized.capability = deeplink * 0.6 + basvuru * 0.4;
    ham.capability = `deeplink=${String(input.deeplinkSupported)},application=${String(
      input.applicationSupported,
    )}`;
  }

  // --- tazelik: verinin ne kadar güvenilir olduğu ------------------------
  if (input.lastVerifiedAt !== null) {
    const t = Date.parse(input.lastVerifiedAt);
    if (!Number.isFinite(t)) {
      throw new ScoreError('lastVerifiedAt gecerli bir tarih olmali.', 'freshness');
    }
    const gunFarki = (now.getTime() - t) / 86_400_000;
    normalized.freshness = birimAralik(1 - gunFarki / SCORE_SCALES.freshnessDays);
  }

  // --- toplama ------------------------------------------------------------
  const breakdown: ScoreContribution[] = SCORE_COMPONENTS.map((component) => {
    const n = normalized[component];
    const weight = SCORE_WEIGHTS[component];
    const applicable = n !== null;

    return {
      component,
      raw: ham[component],
      normalized: n,
      weight,
      contribution: applicable ? weight * n : 0,
      applicable,
    };
  });

  const applicableWeight = breakdown
    .filter((b) => b.applicable)
    .reduce((s, b) => s + b.weight, 0);

  const earnedWeight = breakdown.reduce((s, b) => s + b.contribution, 0);

  // Hiçbir bileşen bilinmiyor: 0/0 yerine "puanlanamadı".
  if (applicableWeight === 0) {
    return { score: null, breakdown, applicableWeight: 0, earnedWeight: 0 };
  }

  const ham100 = (earnedWeight / applicableWeight) * 100;

  if (!Number.isFinite(ham100)) {
    throw new ScoreError('Skor sonlu bir sayi olmadi.', null);
  }

  // Kırpma son kapı: yukarıdaki her normalize zaten 0-1 ama tek bir
  // gelecekteki hata sıralamayı ele geçirmesin.
  const sinirli = Math.min(100, Math.max(0, ham100));

  return {
    score: Math.round(sinirli * 100) / 100,
    breakdown,
    applicableWeight,
    earnedWeight,
  };
}
