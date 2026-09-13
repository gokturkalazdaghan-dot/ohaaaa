/**
 * İNSAN ONAY KAPISI.
 *
 * Amaç insanı sistemden çıkarmak değil, insan müdahalesini GERÇEKTEN
 * gereken yere indirmek. O yüzden burada iki şey var: hangi işlerin onay
 * istediğini belirleyen kural, ve onay isteğinin nasıl paketleneceği.
 *
 * PAKET ÖNEMLİ. Bağlamsız bir "onaylıyor musunuz?" sorusu, insanı ya
 * körlemesine onaylamaya ya da her şeyi bloke etmeye iter. Bir onay
 * isteği kendi başına okunabilir olmak zorunda: ne yapılacak, neye
 * dayanıyor, ters giderse nasıl geri alınır.
 */

import type { ToolName } from '../orchestrator/types.js';
import { onayGerektirir } from './tools.js';
import type { Kanit } from './verification.js';

/** Onay isteyen işlem sınıfları. Phase 0 görev haritasından türetildi. */
export type OnayKonusu =
  | 'sema_degisikligi'
  | 'uretim_dagitimi'
  | 'ortaklik_basvurusu'
  | 'finansal_mutabakat'
  | 'yasal_metin'
  | 'yikici_islem'
  | 'secret_veya_faturalama'
  | 'pazar_acilisi';

/** Onaydan asla muaf olmayan konular -- ölçüm ne derse desin. */
const DAIMA_ONAY: ReadonlySet<OnayKonusu> = new Set([
  'yikici_islem',
  'secret_veya_faturalama',
]);

export interface OnayIstegi {
  id: string;
  konu: OnayKonusu;
  agentId: string;
  /** Bir insanın tek bakışta anlayacağı özet. */
  ozet: string;
  /** Tam olarak ne uygulanacak: SQL, diff, metin. */
  islem: string;
  kanitlar: readonly Kanit[];
  /** Ters giderse ne yapılacak. Boş bırakılamaz. */
  geriAlma: string;
  /** Doğrulama ve denetim katmanları geçti mi. */
  dogrulandi: boolean;
  denetlendi: boolean;
  olusturuldu: number;
}

export type EksikAlan =
  | 'ozet_yok'
  | 'islem_yok'
  | 'kanit_yok'
  | 'geri_alma_yok'
  | 'dogrulanmadi'
  | 'denetlenmedi';

/**
 * Onay isteği insana SUNULABİLİR mi?
 *
 * Eksik paketli bir istek reddedilir -- insana gitmez. Sebep: yarım bir
 * istek, onaylayanın eksik bilgiyle karar vermesi demektir ve kapının
 * varlık sebebini ortadan kaldırır.
 */
export function eksikler(i: OnayIstegi): EksikAlan[] {
  const e: EksikAlan[] = [];
  if (!i.ozet.trim()) e.push('ozet_yok');
  if (!i.islem.trim()) e.push('islem_yok');
  if (i.kanitlar.filter((k) => k.kaynak.trim() && k.gozlem.trim()).length === 0) {
    e.push('kanit_yok');
  }
  if (!i.geriAlma.trim()) e.push('geri_alma_yok');
  if (!i.dogrulandi) e.push('dogrulanmadi');
  if (!i.denetlendi) e.push('denetlenmedi');
  return e;
}

export function sunulabilir(i: OnayIstegi): boolean {
  return eksikler(i).length === 0;
}

/**
 * Bir iş onay gerektiriyor mu?
 *
 * İki kaynaktan gelir: KONU (şema değişikliği her zaman onay ister) ve
 * ARAÇ (yetki sınıfı araç taşıyan ajan onay ister). İkisinden biri
 * yeterli; ikisi de yoksa iş otomatik akar.
 */
export function onayGerekiyorMu(
  konu: OnayKonusu | null,
  tools: Iterable<ToolName>,
): boolean {
  if (konu !== null) return true;
  return onayGerektirir(tools);
}

/** Bu konu ölçüm ne derse desin onaydan muaf tutulamaz. */
export function muafiyetVerilemez(konu: OnayKonusu): boolean {
  return DAIMA_ONAY.has(konu);
}

export type OnayDurumu = 'bekliyor' | 'onaylandi' | 'reddedildi' | 'suresi_doldu';

export interface OnayKarari {
  durum: OnayDurumu;
  /** Kararı veren insan. Onay ve ret için zorunlu. */
  karar_veren?: string;
  gerekce?: string;
  at: number;
}

/** Bekleyen istek bu süre sonunda düşer. Sonsuz bekleyen istek, sessiz blokajdır. */
export const ISTEK_OMRU_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bekleyen onay kuyruğu.
 *
 * Kalıcılık burada YOK ve bu bilinçli: kuyruk `jobs` tablosu üzerinden
 * kalıcılaşacak, ama karar mantığı veritabanı olmadan test edilebilir
 * kalmalı. Aynı ayrım `worker.ts`'te de yapılmıştı.
 */
export class OnayKuyrugu {
  private readonly bekleyen = new Map<string, OnayIstegi>();
  private readonly kararlar = new Map<string, OnayKarari>();

  /** İsteği kuyruğa alır. Eksik paketli istek KABUL EDİLMEZ. */
  sun(i: OnayIstegi): void {
    const e = eksikler(i);
    if (e.length > 0) {
      throw new Error(`Onay isteği eksik: ${e.join(', ')}`);
    }
    if (this.bekleyen.has(i.id) || this.kararlar.has(i.id)) {
      throw new Error(`Onay isteği kimliği zaten var: ${i.id}`);
    }
    this.bekleyen.set(i.id, i);
  }

  get bekleyenler(): OnayIstegi[] {
    return [...this.bekleyen.values()];
  }

  durum(id: string, simdi = Date.now()): OnayDurumu {
    const karar = this.kararlar.get(id);
    if (karar) return karar.durum;
    const istek = this.bekleyen.get(id);
    if (!istek) return 'reddedildi';
    return simdi - istek.olusturuldu > ISTEK_OMRU_MS ? 'suresi_doldu' : 'bekliyor';
  }

  /** İnsan kararını işler. Kimlik zorunlu. */
  karar(
    id: string, durum: 'onaylandi' | 'reddedildi', karar_veren: string,
    gerekce = '', simdi = Date.now(),
  ): OnayKarari {
    if (!karar_veren.trim()) throw new Error('Karar veren kimlik zorunlu');
    const istek = this.bekleyen.get(id);
    if (!istek) throw new Error(`Bekleyen onay isteği yok: ${id}`);
    if (simdi - istek.olusturuldu > ISTEK_OMRU_MS) {
      /* Süresi dolmuş istek onaylanamaz: dayandığı kanıt artık taze değil. */
      throw new Error(`Onay isteğinin süresi doldu: ${id}`);
    }
    this.bekleyen.delete(id);
    const k: OnayKarari = { durum, karar_veren, gerekce, at: simdi };
    this.kararlar.set(id, k);
    return k;
  }

  /** İşlem uygulanabilir mi? Yalnızca açık onay yeterlidir. */
  uygulanabilir(id: string, simdi = Date.now()): boolean {
    return this.durum(id, simdi) === 'onaylandi';
  }
}
