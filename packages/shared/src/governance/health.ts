/**
 * AJAN SAĞLIĞI VE KARANTİNA.
 *
 * Bir ajanın "çalışıyor" olması, doğru çalıştığı anlamına gelmiyor.
 * Kötü performans gösteren bir ajanın üretimde sınırsız çalışmaya devam
 * etmesi, sistemin en pahalı sessiz hatası olurdu: her turda biraz daha
 * yanlış veri üretir ve kimse bakmaz.
 *
 * Merdiven TEK YÖNLÜ DEĞİL ama ASİMETRİK: düşüş tek turda olabilir,
 * çıkış kanıt ister. Bir ajanın kötü turdan sonra kendiliğinden "iyileşmiş"
 * sayılması, ölçümü anlamsız kılardı.
 *
 * GÖZLEM SAYISI EŞİĞİ
 * Üç çalıştırmanın ikisinin başarısız olması %66 hata oranıdır ama bir
 * şey söylemez. Oranlar yalnızca yeterli örnekte karar üretir.
 */

/** Bir ajanın yaşam döngüsü durumu. */
export type AjanDurumu = 'saglikli' | 'uyari' | 'kisitli' | 'karantina';

/** Merdivenin sırası -- karşılaştırma için. */
export const DURUM_SIRASI: Record<AjanDurumu, number> = {
  saglikli: 0,
  uyari: 1,
  kisitli: 2,
  karantina: 3,
};

/** Tek bir çalıştırmanın sonucu. */
export interface CalistirmaSonucu {
  basarili: boolean;
  /** Doğrulama katmanı bu çıktıyı reddetti mi. */
  dogrulamaReddi: boolean;
  /** Ajanın beyan ettiği güven (0-1). */
  guven: number;
  /** Sonuç gerçekten doğru çıktı mı. Ölçülemediyse null. */
  gercektenDogru: boolean | null;
  /** Kaç deneme aldı. */
  denemeler: number;
  sureMs: number;
  maliyetKurus: number;
}

export interface AjanMetrikleri {
  calistirma: number;
  basari: number;
  basarisiz: number;
  dogrulamaReddi: number;
  toplamDeneme: number;
  toplamSureMs: number;
  toplamMaliyetKurus: number;
  /** Sonucu ölçülebilmiş çalıştırmalar. */
  olculen: number;
  /** Bunlardan kaçı gerçekten doğruydu. */
  dogru: number;
  /** Ölçülen çalıştırmalarda beyan edilen güvenlerin toplamı. */
  guvenToplami: number;
}

export function bosMetrik(): AjanMetrikleri {
  return {
    calistirma: 0, basari: 0, basarisiz: 0, dogrulamaReddi: 0,
    toplamDeneme: 0, toplamSureMs: 0, toplamMaliyetKurus: 0,
    olculen: 0, dogru: 0, guvenToplami: 0,
  };
}

export function metrikEkle(m: AjanMetrikleri, s: CalistirmaSonucu): AjanMetrikleri {
  return {
    calistirma: m.calistirma + 1,
    basari: m.basari + (s.basarili ? 1 : 0),
    basarisiz: m.basarisiz + (s.basarili ? 0 : 1),
    dogrulamaReddi: m.dogrulamaReddi + (s.dogrulamaReddi ? 1 : 0),
    toplamDeneme: m.toplamDeneme + s.denemeler,
    toplamSureMs: m.toplamSureMs + s.sureMs,
    toplamMaliyetKurus: m.toplamMaliyetKurus + s.maliyetKurus,
    olculen: m.olculen + (s.gercektenDogru === null ? 0 : 1),
    dogru: m.dogru + (s.gercektenDogru === true ? 1 : 0),
    guvenToplami: m.guvenToplami + (s.gercektenDogru === null ? 0 : s.guven),
  };
}

export interface SaglikOzeti {
  basariOrani: number;
  hataOrani: number;
  dogrulamaReddiOrani: number;
  ortalamaDeneme: number;
  ortalamaSureMs: number;
  /** Ölçülebilen çalıştırmalarda gerçek isabet oranı. */
  isabetOrani: number | null;
  /**
   * GÜVEN SAPMASI: beyan edilen güven eksi gerçekleşen isabet.
   *
   * Pozitif değer "olduğundan emin görünüyor" demektir ve bir ajanda
   * aranabilecek en kötü özelliktir: çıktısı doğrulanmadan gerçek
   * sayılma riskini taşır.
   */
  guvenSapmasi: number | null;
}

export function ozetle(m: AjanMetrikleri): SaglikOzeti {
  const n = m.calistirma;
  const isabet = m.olculen > 0 ? m.dogru / m.olculen : null;
  const ortGuven = m.olculen > 0 ? m.guvenToplami / m.olculen : null;
  return {
    basariOrani: n === 0 ? 1 : m.basari / n,
    hataOrani: n === 0 ? 0 : m.basarisiz / n,
    dogrulamaReddiOrani: n === 0 ? 0 : m.dogrulamaReddi / n,
    ortalamaDeneme: n === 0 ? 0 : m.toplamDeneme / n,
    ortalamaSureMs: n === 0 ? 0 : m.toplamSureMs / n,
    isabetOrani: isabet,
    guvenSapmasi: isabet === null || ortGuven === null ? null : ortGuven - isabet,
  };
}

/** Oranların anlam kazandığı en az çalıştırma sayısı. */
export const EN_AZ_GOZLEM = 5;

export interface Esikler {
  uyariHataOrani: number;
  kisitliHataOrani: number;
  karantinaHataOrani: number;
  /** Doğrulama reddi bu oranı aşarsa doğrudan kısıtlıya iner. */
  kisitliDogrulamaReddi: number;
  /** Güven sapması bu değeri aşarsa ajan olduğundan emin görünüyor. */
  uyariGuvenSapmasi: number;
}

export const VARSAYILAN_ESIKLER: Esikler = {
  uyariHataOrani: 0.2,
  kisitliHataOrani: 0.35,
  karantinaHataOrani: 0.5,
  kisitliDogrulamaReddi: 0.3,
  uyariGuvenSapmasi: 0.25,
};

/**
 * Metriklerden hak edilen durumu hesaplar.
 *
 * Saf fonksiyon; mevcut durumu BİLMEZ. Merdivenin asimetrisi
 * `AjanSagligi.isle` içinde uygulanıyor -- burada yalnızca "bu sayılar
 * neyi hak ediyor" sorusu var.
 */
export function hakEdilenDurum(
  m: AjanMetrikleri,
  esik: Esikler = VARSAYILAN_ESIKLER,
): AjanDurumu {
  if (m.calistirma < EN_AZ_GOZLEM) return 'saglikli';
  const o = ozetle(m);

  if (o.hataOrani >= esik.karantinaHataOrani) return 'karantina';
  if (o.hataOrani >= esik.kisitliHataOrani) return 'kisitli';
  if (o.dogrulamaReddiOrani >= esik.kisitliDogrulamaReddi) return 'kisitli';
  if (o.hataOrani >= esik.uyariHataOrani) return 'uyari';
  if (o.guvenSapmasi !== null && o.guvenSapmasi >= esik.uyariGuvenSapmasi) return 'uyari';
  return 'saglikli';
}

/** Kısıtlı ve karantinadaki ajan yazma yapamaz. */
export function yazmaIzinli(durum: AjanDurumu): boolean {
  return durum === 'saglikli' || durum === 'uyari';
}

/** Karantinadaki ajan hiç yeni görev almaz. */
export function gorevAlabilir(durum: AjanDurumu): boolean {
  return durum !== 'karantina';
}

/** Uyarı ve üstü, her çıktının ek doğrulamaya girmesini gerektirir. */
export function ekDogrulamaGerekir(durum: AjanDurumu): boolean {
  return DURUM_SIRASI[durum] >= DURUM_SIRASI.uyari;
}

/**
 * Bir ajanın sağlık defteri.
 *
 * Düşüş otomatik, çıkış Auditor incelemesiyle. `iyilestir` bu yüzden
 * `denetleyen` istiyor: bir ajanın kendiliğinden sağlıklı sayılması
 * ölçümün kendisini geçersiz kılardı.
 */
export class AjanSagligi {
  private metrik = bosMetrik();
  private _durum: AjanDurumu = 'saglikli';

  constructor(
    readonly agentId: string,
    private readonly esik: Esikler = VARSAYILAN_ESIKLER,
  ) {}

  get durum(): AjanDurumu { return this._durum; }
  get metrikler(): AjanMetrikleri { return this.metrik; }
  get ozet(): SaglikOzeti { return ozetle(this.metrik); }

  /** Bir çalıştırmayı işler ve gerekiyorsa durumu DÜŞÜRÜR. */
  isle(s: CalistirmaSonucu): AjanDurumu {
    this.metrik = metrikEkle(this.metrik, s);
    const hak = hakEdilenDurum(this.metrik, this.esik);
    /* Yalnızca aşağı iner. Yukarı çıkış `iyilestir` üzerinden. */
    if (DURUM_SIRASI[hak] > DURUM_SIRASI[this._durum]) this._durum = hak;
    return this._durum;
  }

  /** Elle karantinaya al -- Auditor bulgusu üzerine. */
  karantinayaAl(): void { this._durum = 'karantina'; }

  /**
   * Durumu iyileştirir. Denetçi kimliği ZORUNLU.
   *
   * Metrikler sıfırlanır: ajan düzeltildiyse eski sayıları taşımak yeni
   * hâlini haksız yere cezalandırırdı. Eski metrikler denetim izinde
   * kalır, burada değil.
   */
  iyilestir(denetleyen: string, hedef: AjanDurumu = 'saglikli'): void {
    if (!denetleyen.trim()) {
      throw new Error('Durum iyileştirmesi için denetçi kimliği zorunlu');
    }
    this.metrik = bosMetrik();
    this._durum = hedef;
  }
}
