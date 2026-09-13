/**
 * MALİYET YÖNETİCİSİ.
 *
 * KURAL: her görevi modele göndermek yasak.
 *
 * Bu bir öğüt değil, kapının kendisi. Ajan modele gitmek istediğinde
 * önce burada durdurulur ve daha ucuz basamakların denenip denenmediği
 * sorulur. "Denedim" demek yetmez -- hangi basamağın neden yetmediği
 * yazılmak zorunda.
 *
 * Basamaklar ucuzdan pahalıya:
 *   deterministik → sorgu → önbellek → mevcut veri → küçük model → büyük model
 */

/** Bir görevin çözülebileceği basamaklar. */
export const BASAMAKLAR = [
  'deterministik',
  'sorgu',
  'onbellek',
  'mevcut_veri',
  'kucuk_model',
  'buyuk_model',
] as const;

export type Basamak = (typeof BASAMAKLAR)[number];

/** Basamağın ucuzdan pahalıya sırası. */
export function basamakSirasi(b: Basamak): number {
  return BASAMAKLAR.indexOf(b);
}

/** Model gerektiren basamaklar. */
export function modelBasamagi(b: Basamak): boolean {
  return b === 'kucuk_model' || b === 'buyuk_model';
}

export interface BasamakDenemesi {
  basamak: Basamak;
  /** Bu basamak neden yetmedi. Boş metin geçersiz. */
  neden: string;
}

export interface ModelTalebi {
  agentId: string;
  hedefBasamak: Basamak;
  /** Daha ucuz basamaklarda neler denendi. */
  denenenler: readonly BasamakDenemesi[];
  /** Bu çağrının tahmini bedeli (kuruş). */
  tahminiKurus: number;
}

export interface Butce {
  /** Tek görev için üst sınır (kuruş). */
  gorevTavaniKurus: number;
  /** Bu pencerede toplam üst sınır (kuruş). */
  pencereTavaniKurus: number;
}

export type RetKodu =
  | 'ucuz_basamak_atlandi'
  | 'gerekce_yok'
  | 'gorev_tavani'
  | 'pencere_tavani';

export type MaliyetKarari =
  | { izin: true; kalanKurus: number }
  | { izin: false; kod: RetKodu; aciklama: string };

/**
 * Harcamayı pencere boyunca takip eden sayaç.
 *
 * Sayaç sıfırlanmaz, PENCERE değiştirilir: sıfırlama, ne kadar
 * harcandığını geriye dönük görünmez kılardı.
 */
export class MaliyetYoneticisi {
  private harcanan = 0;

  constructor(private readonly butce: Butce) {}

  get harcananKurus(): number {
    return this.harcanan;
  }

  get kalanKurus(): number {
    return Math.max(0, this.butce.pencereTavaniKurus - this.harcanan);
  }

  /**
   * Bir model çağrısına izin verilir mi?
   *
   * Model gerektirmeyen basamaklar hiç sorulmadan geçer -- deterministik
   * bir hesabın bütçe kapısında beklemesi anlamsız olurdu.
   */
  degerlendir(talep: ModelTalebi): MaliyetKarari {
    if (!modelBasamagi(talep.hedefBasamak)) {
      return { izin: true, kalanKurus: this.kalanKurus };
    }

    /*
     * DAHA UCUZ HER BASAMAK DENENMİŞ OLMALI.
     *
     * Yalnızca "denendi" işareti değil, GEREKÇE de aranıyor. Gerekçesiz
     * bir deneme kaydı, kapıyı geçmek için doldurulan bir kutudur ve
     * kapıyı işlevsiz kılar.
     */
    const hedef = basamakSirasi(talep.hedefBasamak);
    const denenmis = new Map(talep.denenenler.map((d) => [d.basamak, d.neden]));

    for (const b of BASAMAKLAR) {
      if (basamakSirasi(b) >= hedef) break;
      if (!denenmis.has(b)) {
        return {
          izin: false,
          kod: 'ucuz_basamak_atlandi',
          aciklama: `${b} basamağı denenmeden ${talep.hedefBasamak} istendi`,
        };
      }
      if (!(denenmis.get(b) ?? '').trim()) {
        return {
          izin: false,
          kod: 'gerekce_yok',
          aciklama: `${b} basamağının neden yetmediği yazılmamış`,
        };
      }
    }

    if (talep.tahminiKurus > this.butce.gorevTavaniKurus) {
      return {
        izin: false,
        kod: 'gorev_tavani',
        aciklama: `${talep.tahminiKurus} kuruş, görev tavanı ${this.butce.gorevTavaniKurus} kuruşu aşıyor`,
      };
    }

    if (this.harcanan + talep.tahminiKurus > this.butce.pencereTavaniKurus) {
      return {
        izin: false,
        kod: 'pencere_tavani',
        aciklama: `kalan bütçe ${this.kalanKurus} kuruş, talep ${talep.tahminiKurus} kuruş`,
      };
    }

    return { izin: true, kalanKurus: this.kalanKurus - talep.tahminiKurus };
  }

  /**
   * Gerçekleşen harcamayı işler.
   *
   * Tahmin DEĞİL gerçekleşen yazılıyor: ikisi ayrıştığında bütçe
   * tahminin peşinden gitseydi, sürekli düşük tahmin veren bir ajan
   * tavanı sessizce delerdi.
   */
  harca(gerceklesenKurus: number): void {
    if (gerceklesenKurus < 0) throw new Error('Harcama negatif olamaz');
    this.harcanan += gerceklesenKurus;
  }

  /** Bütçe aşıldı mı? Kill switch bu sinyali okur. */
  get asildi(): boolean {
    return this.harcanan > this.butce.pencereTavaniKurus;
  }
}
