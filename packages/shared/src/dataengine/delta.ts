import { createHash } from 'node:crypto';

/**
 * Delta tespiti — neyin GERÇEKTEN değiştiği.
 *
 * ÇÖZÜLEN PROBLEM
 * Alım hattı her çalışmada tüm teklifleri upsert ediyor. Feed'de 50.000
 * ürün varsa ve hiçbiri değişmediyse bile 50.000 yazma, 50.000 tetikleyici
 * ve 50.000 yeniden indeksleme yapılıyor. Maliyet bir yana, asıl zarar
 * gürültü: gerçekten değişen üç fiyat, değişmeyen 49.997'nin arasında
 * kayboluyor ve "neyi yeniden hesaplamalıyım" sorusu cevapsız kalıyor.
 *
 * ÇÖZÜM: KANONİK PARMAK İZİ
 * Her teklif, DEĞİŞİMİ ANLAMLI olan alanlarından kararlı bir özet üretir.
 * Özet aynıysa teklif değişmemiştir -- alanların sırası, feed'in
 * biçimlendirmesi ya da tarama zamanı ne olursa olsun.
 */

/** Parmak izine giren alanlar. Buraya eklenen her alan bir "değişim" tanımıdır. */
export interface FingerprintInput {
  externalId: string;
  market: string;
  merchantId: string;
  title: string;
  priceCents: number;
  currency: string;
  /**
   * Stok DURUMU, adedi değil.
   *
   * 12'den 11'e düşmek kullanıcı için hiçbir şey değiştirmez ve her stok
   * hareketini "değişim" saymak, kuyruğu anlamsız işle doldururdu.
   * Değişim, satın alınabilirliğin değişmesidir.
   */
  inStock: boolean;
  productUrl: string;
  shippingFeeCents: number;
  /** Kategori/marka gibi sıralamayı etkileyen nitelikler. */
  attributes?: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Alan ayırıcısı: birim ayırıcı (U+001F).
 *
 * Görünür bir ayırıcı (`|` gibi) alan içeriğinde geçebilir ve iki farklı
 * alan bölünmesi aynı dizeyi üretebilirdi -- yani iki farklı teklif aynı
 * parmak izini alırdı. Bu karakter metin alanlarında bulunmaz.
 */
const AYIRICI = '';

/**
 * Kararlı kanonik parmak izi.
 *
 * NELER GİRMEZ ve neden:
 *   • zaman damgaları  — her taramada değişir, hiçbir şey söylemez
 *   • tarama/çalışma kimliği — aynı sebeple
 *   • satıcının üstü çizili fiyatı — bizim ölçümümüz değil, iddiası
 *   • görsel URL'lerindeki CDN parametreleri — aynı görsel, farklı adres
 *
 * Bunlar girseydi HER tarama "değişti" derdi ve delta tespiti anlamını
 * tamamen kaybederdi -- yani hiç yapmamış gibi olurduk.
 */
export function canonicalFingerprint(input: FingerprintInput): string {
  /*
   * Anahtarlar SIRALANIR. `Object.entries` alanları ekleme sırasına göre
   * verir; iki farklı adaptör aynı veriyi farklı sırayla üretirse
   * özetler ayrışır ve her şey "değişmiş" görünür.
   */
  const nitelikler = Object.entries(input.attributes ?? {})
    .filter(([, v]) => v !== null && v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${String(v)}`);

  const parcalar = [
    input.externalId,
    input.market,
    input.merchantId,
    // Başlıktaki fazladan boşluk anlamlı bir değişim değil.
    input.title.trim().replace(/\s+/g, ' '),
    String(input.priceCents),
    input.currency,
    input.inStock ? '1' : '0',
    input.productUrl.trim(),
    String(input.shippingFeeCents),
    ...nitelikler,
  ];

  return createHash('sha256').update(parcalar.join(AYIRICI)).digest('hex');
}

export type DeltaClass = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'DELETED';

export interface DeltaEntry {
  externalId: string;
  classification: DeltaClass;
  fingerprint: string | null;
  previousFingerprint: string | null;
}

export interface DeltaResult {
  entries: DeltaEntry[];
  counts: Record<DeltaClass, number>;
  /** DELETED üretildi mi? Kısmi senkronda üretilmez. */
  deletionsEvaluated: boolean;
}

export interface ClassifyOptions {
  /** Bilinen durum: dış kimlik → önceki parmak izi. */
  previous: ReadonlyMap<string, string>;
  /** Bu turda kaynaktan gelen kayıtlar. */
  current: readonly FingerprintInput[];
  /**
   * Anlık görüntü TAM MI?
   *
   * KRİTİK: yalnızca `true` iken silme değerlendirilir.
   *
   * Bir feed yarım indiğinde (ağ koptu, sayfalama bitmedi, kaynak 503
   * verdi) eksik kayıtlar "kaynakta yok" gibi görünür. Kısmi bir turda
   * silme üretmek, kataloğun yarısını bir ağ hatası yüzünden yok etmek
   * demektir. Bu, alım hattının en pahalı arızasıdır ve mevcut
   * `markStale` de aynı sebeple SİLMEK yerine stoksuz işaretliyor.
   */
  snapshotComplete: boolean;
}

/** Kaynaktan geleni bilinen durumla karşılaştırır. */
export function classifyDelta(options: ClassifyOptions): DeltaResult {
  const { previous, current, snapshotComplete } = options;

  const entries: DeltaEntry[] = [];
  const gorulen = new Set<string>();

  for (const kayit of current) {
    const parmakIzi = canonicalFingerprint(kayit);
    const onceki = previous.get(kayit.externalId) ?? null;
    gorulen.add(kayit.externalId);

    entries.push({
      externalId: kayit.externalId,
      classification:
        onceki === null ? 'NEW' : onceki === parmakIzi ? 'UNCHANGED' : 'CHANGED',
      fingerprint: parmakIzi,
      previousFingerprint: onceki,
    });
  }

  if (snapshotComplete) {
    for (const [externalId, onceki] of previous) {
      if (gorulen.has(externalId)) continue;
      entries.push({
        externalId,
        classification: 'DELETED',
        fingerprint: null,
        previousFingerprint: onceki,
      });
    }
  }

  const counts: Record<DeltaClass, number> = {
    NEW: 0,
    CHANGED: 0,
    UNCHANGED: 0,
    DELETED: 0,
  };
  for (const e of entries) counts[e.classification] += 1;

  return { entries, counts, deletionsEvaluated: snapshotComplete };
}

/**
 * Yazılması gereken kayıtlar.
 *
 * UNCHANGED olanlar KASITLI olarak dışarıda: değişmeyen bir satırı
 * yeniden yazmak, `updated_at` damgasını ilerletir ve "bu ürün değişti"
 * diyen sahte bir sinyal üretir. Aşağı akıştaki her şey (yeniden
 * indeksleme, önbellek geçersizleştirme, uyarlanabilir yoklama) o
 * sinyale bakıyor.
 */
export function needsWrite(result: DeltaResult): DeltaEntry[] {
  return result.entries.filter(
    (e) => e.classification === 'NEW' || e.classification === 'CHANGED',
  );
}
