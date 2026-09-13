/**
 * DEĞİŞTİRİLEMEZ DENETİM İZİ.
 *
 * Bir kararın sonradan incelenebilmesi, sistemin "kanıt → doğrulama →
 * bağımsız denetim" iddiasının tek somut karşılığı. İz tutulmazsa o iddia
 * kontrol edilemez bir söz olarak kalır.
 *
 * EKLE-YALNIZCA
 * Kayıt güncellenmez, silinmez. Yanlış bir kayıt DÜZELTİLMEZ, üzerine
 * düzeltme kaydı yazılır. Değiştirilebilen bir iz, iz değildir.
 *
 * ÜRETİMDEKİ KARŞILIĞI
 * `agent_decisions` tablosu bugün tam bu şekle sahip: `agent`, `model`,
 * `prompt_version`, `input_digest`, `decision`, `confidence`, `evidence`,
 * `expected_outcome`, `actual_outcome`, `measured_at`. Bu modül o şemayı
 * VARSAYAR ama ona bağlanmaz -- depo arayüzü sayesinde motor veritabanı
 * olmadan test edilebiliyor. Aynı ayrım `worker.ts`'te de yapılmıştı.
 *
 * GİRDİ ÖZETLENİR, YAZILMAZ
 * Ham girdi kişisel veri ya da secret taşıyabilir. İzde duran şey girdinin
 * KENDİSİ değil, değişip değişmediğini anlamaya yeten bir özet.
 */

import type { Kanit } from './verification.js';

/** Bir kararın yaşam döngüsündeki son hâli. */
export type IzDurumu =
  | 'yurutuldu'
  | 'dogrulandi'
  | 'dogrulama_reddi'
  | 'denetlendi'
  | 'denetim_reddi'
  | 'onay_bekliyor'
  | 'onaylandi'
  | 'reddedildi'
  | 'uygulandi'
  | 'geri_alindi';

export interface DenetimKaydi {
  taskId: string;
  agentId: string;
  at: number;
  /** Kullanılan araçlar. İzin ihlali sonradan burada aranır. */
  araclar: readonly string[];
  /** Ne yapıldı -- insan tarafından okunabilir. */
  eylem: string;
  /** Girdinin ÖZETİ. Ham girdi asla. */
  girdiOzeti: string;
  /** Çıktının özeti ya da referansı. */
  ciktiOzeti: string;
  guven: number;
  kanitlar: readonly Kanit[];
  dogrulayan: string | null;
  denetleyen: string | null;
  onaylayan: string | null;
  durum: IzDurumu;
  /** Model kullanıldıysa hangisi. */
  model?: string;
  maliyetKurus?: number;
}

/** İzde asla görünmemesi gereken alan adları. */
const YASAKLI_ANAHTARLAR = [
  'password', 'parola', 'secret', 'token', 'api_key', 'apikey', 'authorization',
  'cookie', 'session', 'email', 'eposta', 'phone', 'telefon', 'tckn', 'iban',
  'card', 'kart', 'cvv', 'address', 'adres',
];

/**
 * Bir metinde hassas alan adı geçiyor mu?
 *
 * Kaba ama bilinçli: değer bazlı tespit (kredi kartı deseni vb.) yanlış
 * negatif üretir ve tam olarak kaçırdığı durumda zarar verir. Alan adı
 * eşleşmesi fazla yakalar -- ve fazla yakalamak, az yakalamaktan iyidir.
 */
export function hassasIceriyor(metin: string): boolean {
  const k = metin.toLowerCase();
  return YASAKLI_ANAHTARLAR.some((y) => k.includes(y));
}

export type IzHatasi = 'hassas_veri' | 'kanit_yok' | 'gorev_kimligi_yok';

/** Kayıt yazılabilir mi? Fail-closed: şüpheli kayıt yazılmaz. */
export function izKontrol(k: DenetimKaydi): IzHatasi[] {
  const h: IzHatasi[] = [];
  if (!k.taskId.trim()) h.push('gorev_kimligi_yok');
  if (hassasIceriyor(k.girdiOzeti) || hassasIceriyor(k.ciktiOzeti) ||
      k.kanitlar.some((x) => hassasIceriyor(x.gozlem) || hassasIceriyor(x.kaynak))) {
    h.push('hassas_veri');
  }
  /*
   * Uygulanmış bir karar kanıtsız olamaz. Yürütülmüş ama henüz
   * doğrulanmamış bir adımda kanıt eksikliği normaldir.
   */
  if (k.durum === 'uygulandi' && k.kanitlar.length === 0) h.push('kanit_yok');
  return h;
}

/** Denetim izinin yazma yüzeyi. Gerçek uygulaması `agent_decisions`'a yazar. */
export interface DenetimDeposu {
  yaz(kayit: DenetimKaydi): Promise<void>;
  gorevIzi(taskId: string): Promise<readonly DenetimKaydi[]>;
}

/**
 * Bellekte tutulan ekle-yalnızca iz.
 *
 * Testler ve yerel çalışma için. Üretimde `DenetimDeposu`'nun Supabase
 * uygulaması kullanılacak; şema zaten yerinde olduğu için göç gerekmiyor.
 */
export class BellekteDenetimDeposu implements DenetimDeposu {
  private readonly kayitlar: DenetimKaydi[] = [];

  async yaz(kayit: DenetimKaydi): Promise<void> {
    const hatalar = izKontrol(kayit);
    if (hatalar.length > 0) {
      throw new Error(`Denetim kaydı reddedildi: ${hatalar.join(', ')}`);
    }
    /* Donduruluyor: yazıldıktan sonra değiştirilebilen bir kayıt iz değil. */
    this.kayitlar.push(Object.freeze({ ...kayit }));
  }

  async gorevIzi(taskId: string): Promise<readonly DenetimKaydi[]> {
    return this.kayitlar.filter((k) => k.taskId === taskId);
  }

  get tumu(): readonly DenetimKaydi[] {
    return this.kayitlar;
  }
}

/**
 * Bir görevin izi tam mı?
 *
 * "Uygulandı" durumuna gelmiş ama doğrulayanı ya da denetleyeni olmayan
 * bir görev, zincirin atlandığı anlamına gelir. Bu fonksiyon Auditor'ın
 * geriye dönük taramasının temeli.
 */
export function zincirTam(iz: readonly DenetimKaydi[]): boolean {
  const uygulanan = iz.filter((k) => k.durum === 'uygulandi');
  if (uygulanan.length === 0) return true;
  return uygulanan.every(
    (k) => k.dogrulayan !== null && k.denetleyen !== null &&
           k.dogrulayan !== k.agentId && k.denetleyen !== k.agentId,
  );
}
