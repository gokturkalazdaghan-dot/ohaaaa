/**
 * AJAN HAFIZASI.
 *
 * HER ŞEY HAFIZAYA YAZILMAZ. Sınırsız hafıza, ajanın eski ve yanlış bir
 * çıkarımı sonsuza kadar taşıması demektir; ayrıca büyüdükçe her çağrının
 * bağlamını şişirir ve maliyeti sessizce artırır.
 *
 * Yazılabilecek şeyin ölçütü tek: DOĞRULANMIŞ ve YENİDEN KULLANILABİLİR
 * olması. Bir ajanın "sanırım" dediği şey hafızaya girmez.
 */

/** Hafıza kategorileri. Her birinin farklı ömrü ve doğrulama eşiği var. */
export type HafizaTuru =
  /** Süren bir görevin ara durumu. Görev bitince düşer. */
  | 'gorev_durumu'
  /** Daha önce verilmiş kararlar -- tutarlılık için. */
  | 'onceki_kararlar'
  /** Doğrulanmış gerçekler. En uzun ömürlü kategori. */
  | 'dogrulanmis_gercek'
  | 'magaza_bilgisi'
  | 'urun_bilgisi'
  | 'pazar_bilgisi'
  /** Sistemin kendisi hakkında bilinenler (şema, sınırlar, araçlar). */
  | 'sistem_bilgisi'
  /** Geçmiş başarısızlıklar -- aynı hataya iki kez düşmemek için. */
  | 'hata_gecmisi';

export interface HafizaKaydi<T = unknown> {
  tur: HafizaTuru;
  anahtar: string;
  deger: T;
  /** Bu kaydın dayandığı kanıt referansı. Boş olamaz. */
  kaynak: string;
  /** Kaydın doğrulanmış olup olmadığı. */
  dogrulandi: boolean;
  yazildi: number;
}

/** Kategori başına ömür (ms). Süresi dolan kayıt okunmaz. */
export const OMURLER: Record<HafizaTuru, number> = {
  gorev_durumu: 60 * 60 * 1000,
  onceki_kararlar: 30 * 24 * 60 * 60 * 1000,
  dogrulanmis_gercek: 90 * 24 * 60 * 60 * 1000,
  magaza_bilgisi: 30 * 24 * 60 * 60 * 1000,
  urun_bilgisi: 7 * 24 * 60 * 60 * 1000,
  pazar_bilgisi: 30 * 24 * 60 * 60 * 1000,
  sistem_bilgisi: 90 * 24 * 60 * 60 * 1000,
  hata_gecmisi: 180 * 24 * 60 * 60 * 1000,
};

/**
 * Doğrulama ZORUNLU olan kategoriler.
 *
 * `gorev_durumu` ve `hata_gecmisi` doğrulanmamış yazılabilir: ilki
 * geçici bir not, ikincisi zaten "bu işe yaramadı" kaydı. Diğerleri
 * ileride gerçek gibi okunacağı için doğrulanmadan giremez.
 */
const DOGRULAMA_ZORUNLU: ReadonlySet<HafizaTuru> = new Set<HafizaTuru>([
  'onceki_kararlar', 'dogrulanmis_gercek', 'magaza_bilgisi',
  'urun_bilgisi', 'pazar_bilgisi', 'sistem_bilgisi',
]);

export type HafizaHatasi = 'kaynak_yok' | 'dogrulanmamis' | 'hassas_veri';

/** Hafızaya asla yazılmaması gereken içerik. Denetim iziyle aynı liste. */
const YASAKLI = [
  'password', 'parola', 'secret', 'token', 'api_key', 'apikey', 'authorization',
  'cookie', 'session', 'email', 'eposta', 'phone', 'telefon', 'tckn', 'iban',
  'card', 'kart', 'cvv',
];

function hassas(x: unknown): boolean {
  const m = JSON.stringify(x ?? '').toLowerCase();
  return YASAKLI.some((y) => m.includes(y));
}

export function hafizaKontrol(k: HafizaKaydi): HafizaHatasi[] {
  const h: HafizaHatasi[] = [];
  if (!k.kaynak.trim()) h.push('kaynak_yok');
  if (DOGRULAMA_ZORUNLU.has(k.tur) && !k.dogrulandi) h.push('dogrulanmamis');
  if (hassas(k.deger) || hassas(k.anahtar)) h.push('hassas_veri');
  return h;
}

/**
 * Kalıcı hafıza yüzeyi.
 *
 * Okuma süre kontrolü YAPAR: süresi dolmuş kayıt silinmese bile
 * okunmaz. Silme ayrı bir bakım işi; okuma yolunun ona bağlı olması,
 * bakım aksadığında bayat veriyi gerçek diye döndürmek demek olurdu.
 */
export class Hafiza {
  private readonly kayitlar = new Map<string, HafizaKaydi>();

  private static anahtar(tur: HafizaTuru, anahtar: string): string {
    return `${tur}::${anahtar}`;
  }

  yaz(k: HafizaKaydi): void {
    const h = hafizaKontrol(k);
    if (h.length > 0) throw new Error(`Hafıza kaydı reddedildi: ${h.join(', ')}`);
    this.kayitlar.set(Hafiza.anahtar(k.tur, k.anahtar), k);
  }

  oku<T>(tur: HafizaTuru, anahtar: string, simdi = Date.now()): T | null {
    const k = this.kayitlar.get(Hafiza.anahtar(tur, anahtar));
    if (!k) return null;
    if (simdi - k.yazildi > OMURLER[tur]) return null;
    return k.deger as T;
  }

  /** Süresi dolmuş kayıtları temizler; kaç tane silindiğini döndürür. */
  budama(simdi = Date.now()): number {
    let n = 0;
    for (const [anahtar, k] of this.kayitlar) {
      if (simdi - k.yazildi > OMURLER[k.tur]) { this.kayitlar.delete(anahtar); n++; }
    }
    return n;
  }

  get boyut(): number {
    return this.kayitlar.size;
  }
}
