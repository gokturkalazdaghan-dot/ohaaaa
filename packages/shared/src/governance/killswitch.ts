/**
 * KILL SWITCH — sistem geneli acil durdurma.
 *
 * NEDEN AJANIN İÇİNDE DEĞİL
 * Her ajanın kendi "durmalı mıyım" kontrolünü yazması, bir tanesinin
 * unutmasına bakar. Kapı tek yerde ve ajanın DIŞINDA: ajan çalışmaya
 * başlamadan önce sorulur, ajan bunu atlayamaz.
 *
 * FAIL-CLOSED
 * Güvenli moda geçiş otomatik, çıkış İNSAN ELİYLE. Tersi olsaydı --
 * "sinyal geçti, kendiliğinden aç" -- sistemi durduran olayın hâlâ
 * sürüp sürmediğini kimse bakmadan karar verilmiş olurdu.
 */

import type { ToolName } from '../orchestrator/types.js';
import { guvenliModdaIzinli } from './tools.js';

/** Güvenli moda geçiren olaylar. Hepsi ölçülebilir, hiçbiri sezgi değil. */
export type DurdurmaSebebi =
  | 'yaygin_ajan_hatasi'
  | 'veri_bozulmasi'
  | 'guvenlik_olayi'
  | 'maliyet_asimi'
  | 'beklenmeyen_toplu_degisiklik'
  | 'tekrarlayan_dogrulama_hatasi'
  | 'elle';

export interface DurdurmaKaydi {
  sebep: DurdurmaSebebi;
  at: number;
  /** Kararı neyin tetiklediği. Boş bırakmak "kanıtım yok" demektir. */
  kanit: string;
}

export interface SistemSaglikSinyali {
  /** Son turdaki ajan çalıştırma sayısı. */
  calistirma: number;
  /** Bunlardan kaçı başarısız oldu. */
  basarisiz: number;
  /** Bunlardan kaçı doğrulamadan geri döndü. */
  dogrulamaReddi: number;
  /** Bu turda harcanan para (kuruş). */
  harcamaKurus: number;
  /** Bu tura tanınan üst sınır (kuruş). */
  butceKurus: number;
  /** Tek turda yazılan satır sayısı. */
  yazilanSatir: number;
  /** Normal kabul edilen üst sınır. */
  yazmaTavani: number;
  /** Bütünlük kontrolü geçti mi. */
  butunlukTamam: boolean;
  /** Güvenlik olayı bildirildi mi. */
  guvenlikOlayi: boolean;
}

/** Yaygın hata eşiği: bir turdaki çalıştırmaların yarısı. */
const YAYGIN_HATA_ORANI = 0.5;
/** Anlamlı bir oran için gereken en az çalıştırma sayısı. */
const EN_AZ_ORNEK = 4;

/**
 * Sinyallere bakıp durulmalı mı, karar verir.
 *
 * Saf fonksiyon: durum tutmaz, yan etkisi yok. Böylece her eşik gerçek
 * sayılarla test edilebiliyor.
 */
export function durdurmaKarari(s: SistemSaglikSinyali): DurdurmaSebebi | null {
  if (s.guvenlikOlayi) return 'guvenlik_olayi';
  if (!s.butunlukTamam) return 'veri_bozulmasi';
  if (s.butceKurus > 0 && s.harcamaKurus > s.butceKurus) return 'maliyet_asimi';
  if (s.yazmaTavani > 0 && s.yazilanSatir > s.yazmaTavani) {
    return 'beklenmeyen_toplu_degisiklik';
  }

  /*
   * Oranlar yalnızca yeterli örnekte anlamlı. İki çalıştırmanın biri
   * başarısız olduğunda sistemi durdurmak, gürültüyü olay sanmak olurdu.
   */
  if (s.calistirma >= EN_AZ_ORNEK) {
    if (s.basarisiz / s.calistirma >= YAYGIN_HATA_ORANI) return 'yaygin_ajan_hatasi';
    if (s.dogrulamaReddi / s.calistirma >= YAYGIN_HATA_ORANI) {
      return 'tekrarlayan_dogrulama_hatasi';
    }
  }
  return null;
}

/**
 * Sistem genelinde tek anahtar.
 *
 * Süreç ömrü boyunca bellekte yaşar. Kalıcı olması gerektiğinde
 * `DenetimDeposu` üzerinden yazılır -- ama kapının kendisi burada,
 * çünkü bir olay anında veritabanına ulaşamamak kapıyı açık bırakmamalı.
 */
export class KillSwitch {
  private kayit: DurdurmaKaydi | null = null;

  /** Güvenli modda mıyız? */
  get guvenliMod(): boolean {
    return this.kayit !== null;
  }

  /** Aktif durdurma kaydı. */
  get durum(): DurdurmaKaydi | null {
    return this.kayit;
  }

  /**
   * Güvenli moda geç.
   *
   * Zaten güvenli moddaysak İLK sebep korunur: olayın kök nedeni ilk
   * tetikleyendir, sonrakiler onun sonucudur.
   */
  durdur(sebep: DurdurmaSebebi, kanit: string, at = Date.now()): DurdurmaKaydi {
    if (!this.kayit) this.kayit = { sebep, kanit, at };
    return this.kayit;
  }

  /** Sinyalleri değerlendirir; gerekiyorsa durdurur. */
  degerlendir(s: SistemSaglikSinyali, at = Date.now()): DurdurmaKaydi | null {
    const sebep = durdurmaKarari(s);
    if (sebep) return this.durdur(sebep, JSON.stringify(s), at);
    return null;
  }

  /**
   * Güvenli moddan çık. YALNIZCA insan.
   *
   * `onaylayan` zorunlu ve boş olamaz: kimin sorumluluk aldığı denetim
   * izine yazılmadan sistem yeniden açılamaz.
   */
  serbestBirak(onaylayan: string): void {
    if (!onaylayan.trim()) {
      throw new Error('Güvenli moddan çıkış için onaylayan kimlik zorunlu');
    }
    this.kayit = null;
  }

  /** Bu araç şu an kullanılabilir mi? */
  aracIzinli(tool: ToolName): boolean {
    return this.guvenliMod ? guvenliModdaIzinli(tool) : true;
  }
}
