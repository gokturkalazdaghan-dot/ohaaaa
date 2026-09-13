/**
 * ÜÇ KATMAN: Worker → Validator → Auditor.
 *
 * TEMEL KURAL
 * Hiçbir ajan kendi doğrulayıcısı olamaz. Bu tek cümle mimarinin
 * tamamının dayandığı yer ve burada TİP DÜZEYİNDE değil ÇALIŞMA ANINDA
 * zorlanıyor -- çünkü kimliği taşıyan şey veri, tip değil.
 *
 * Katmanların farkı "ne kadar dikkatli baktığı" değil, NEYE baktığı:
 *
 *   Worker    işi yapar ve kanıt üretir.
 *   Validator çıktının teknik doğruluğunu ölçer: testi çalıştırır,
 *             planı okur, sayıyı yeniden hesaplar.
 *   Auditor   KARARIN kendisini denetler: kanıt yeterli mi, zincir
 *             düzgün mü, güven gerçekleşmeyle uyumlu mu.
 *
 * Auditor'ın işi Validator'ı tekrar etmek değil. Validator "sayı doğru
 * mu" sorar; Auditor "bu sayıya bakarak bu kararı vermek doğru mu" sorar.
 */

/** Bir iddianın dayandığı somut kayıt. */
export interface Kanit {
  /** Nereden geldiği: tablo, uç nokta, komut çıktısı, ölçüm. */
  kaynak: string;
  /** Ne gördüğü. Boş metin kanıt sayılmaz. */
  gozlem: string;
  /** Ne zaman gözlendiği. Bayat kanıt Auditor tarafından reddedilebilir. */
  at: number;
}

/** Bir işin sonucun etkisi -- denetimin sıkılığını bu belirler. */
export type Etki = 'dusuk' | 'orta' | 'yuksek';

export interface IsCiktisi<T = unknown> {
  agentId: string;
  cikti: T;
  /** Ajanın kendi sonucuna güveni (0-1). */
  guven: number;
  kanitlar: readonly Kanit[];
  etki: Etki;
}

export type DogrulamaKodu =
  | 'kanit_yok'
  | 'bayat_kanit'
  | 'kendi_kendini_dogrulama'
  | 'guven_etkiye_gore_dusuk'
  | 'teknik_kontrol_basarisiz'
  | 'zincir_eksik';

export interface Red {
  kod: DogrulamaKodu;
  aciklama: string;
}

export type Karar = { gecti: true } | { gecti: false; redler: readonly Red[] };

/** Yüksek etkili bir karar için aranan en düşük güven. */
const GUVEN_ESIGI: Record<Etki, number> = {
  dusuk: 0,
  orta: 0.5,
  yuksek: 0.75,
};

/** Kanıtın bayat sayıldığı süre (ms). Fiyat iddiaları için kritik. */
export const KANIT_TAZELIK_MS = 24 * 60 * 60 * 1000;

/**
 * VALIDATOR — teknik doğruluk.
 *
 * `teknikKontrol` çağıran tarafından verilir: testi çalıştıran, planı
 * okuyan, sayıyı yeniden hesaplayan gerçek iş. Bu fonksiyon o sonucu
 * kanıt ve güven kurallarıyla birleştirir.
 */
export function dogrula(
  is: IsCiktisi,
  validatorId: string,
  teknikKontrol: { gecti: boolean; aciklama?: string },
  simdi = Date.now(),
): Karar {
  const redler: Red[] = [];

  if (validatorId === is.agentId) {
    redler.push({
      kod: 'kendi_kendini_dogrulama',
      aciklama: `${is.agentId} kendi çıktısını doğrulayamaz`,
    });
  }

  const gecerliKanit = is.kanitlar.filter((k) => k.kaynak.trim() && k.gozlem.trim());
  if (gecerliKanit.length === 0) {
    redler.push({ kod: 'kanit_yok', aciklama: 'çıktı hiçbir kayda dayanmıyor' });
  } else if (is.etki !== 'dusuk') {
    /* Düşük etkili işlerde tazelik aranmıyor: bir öneri sıralamasının
       dünkü veriye dayanması kabul edilebilir, bir fiyat iddiasının
       dayanması değil. */
    const taze = gecerliKanit.some((k) => simdi - k.at <= KANIT_TAZELIK_MS);
    if (!taze) {
      redler.push({
        kod: 'bayat_kanit',
        aciklama: `tüm kanıtlar ${KANIT_TAZELIK_MS} ms'den eski`,
      });
    }
  }

  if (is.guven < GUVEN_ESIGI[is.etki]) {
    redler.push({
      kod: 'guven_etkiye_gore_dusuk',
      aciklama: `${is.etki} etkili iş için güven ${is.guven}, eşik ${GUVEN_ESIGI[is.etki]}`,
    });
  }

  if (!teknikKontrol.gecti) {
    redler.push({
      kod: 'teknik_kontrol_basarisiz',
      aciklama: teknikKontrol.aciklama ?? 'teknik kontrol geçmedi',
    });
  }

  return redler.length === 0 ? { gecti: true } : { gecti: false, redler };
}

export interface DogrulamaKaydi {
  validatorId: string;
  karar: Karar;
  at: number;
}

/**
 * AUDITOR — zincirin kendisini denetler.
 *
 * Validator'ın çalıştığını varsaymaz: çalışıp çalışmadığını, kim
 * tarafından çalıştırıldığını ve sonucun kabul edilebilir olup
 * olmadığını ayrıca sorar. Zincirdeki bir halkanın atlanması burada
 * yakalanır -- "doğrulandı" denip doğrulanmamış olması en sessiz
 * başarısızlık biçimi.
 */
export function denetle(
  is: IsCiktisi,
  dogrulamalar: readonly DogrulamaKaydi[],
  auditorId: string,
): Karar {
  const redler: Red[] = [];

  if (auditorId === is.agentId) {
    redler.push({
      kod: 'kendi_kendini_dogrulama',
      aciklama: `${is.agentId} kendi işini denetleyemez`,
    });
  }

  if (dogrulamalar.length === 0) {
    redler.push({ kod: 'zincir_eksik', aciklama: 'hiç doğrulama kaydı yok' });
  }

  for (const d of dogrulamalar) {
    if (d.validatorId === is.agentId) {
      redler.push({
        kod: 'kendi_kendini_dogrulama',
        aciklama: `doğrulama ${is.agentId} tarafından yapılmış`,
      });
    }
    if (d.validatorId === auditorId) {
      /* Auditor kendi doğrulamasını denetlerse bağımsızlık kalmaz. */
      redler.push({
        kod: 'kendi_kendini_dogrulama',
        aciklama: `denetçi ${auditorId} aynı zamanda doğrulayıcı`,
      });
    }
    if (!d.karar.gecti) {
      for (const r of d.karar.redler) redler.push(r);
    }
  }

  return redler.length === 0 ? { gecti: true } : { gecti: false, redler };
}

/**
 * Bir çıktı üretime geçebilir mi?
 *
 * FAIL-CLOSED: kararsızlık geçiş değil, ret üretir. Bu fonksiyon
 * yalnızca her iki katman da açıkça geçtiğinde `true` döner.
 */
export function uretimeGecebilir(
  validatorKarari: Karar,
  auditorKarari: Karar,
): boolean {
  return validatorKarari.gecti && auditorKarari.gecti;
}
