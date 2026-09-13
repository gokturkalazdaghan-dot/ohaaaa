/**
 * ÇELİŞKİ ÇÖZÜMÜ.
 *
 * İki ajan farklı sonuç verdiğinde rastgele birini seçmek, yanlış cevabı
 * %50 olasılıkla doğru ilan etmektir. Daha kötüsü: hangisinin seçildiği
 * kayda geçmez ve hata bir daha bulunamaz.
 *
 * Burada sıra şu: KAYNAK GÜCÜ → KANIT TAZELİĞİ → GÜVEN. Üçü de ayırt
 * edemiyorsa sonuç `belirsiz` olur.
 *
 * `belirsiz` bir başarısızlık değil, DOĞRU CEVAPTIR. Sistemin bilmediğini
 * söylemesi, bilmediğini bilerek bir sayı uydurmasından iyidir.
 */

import type { Kanit } from './verification.js';

/**
 * Kaynak güvenilirlik sırası -- büyük olan güçlü.
 *
 * Sıralamanın mantığı: doğrudan mağazadan gelen veri, bizim türettiğimiz
 * veriden güçlüdür; türetilmiş veri, modelin tahmininden güçlüdür.
 */
export const KAYNAK_GUCU = {
  /** Mağazanın kendi beslemesi ya da API'si. */
  merchant_feed: 40,
  /** Bizim doğrudan ölçümümüz (HTTP isteği, sayfa okuması). */
  olcum: 35,
  /** Veritabanındaki kayıt. */
  veritabani: 30,
  /** Bizim hesapladığımız türev değer. */
  turetilmis: 20,
  /** Dil modeli çıkarımı. */
  model: 10,
} as const;

export type KaynakTuru = keyof typeof KAYNAK_GUCU;

export interface Iddia<T = unknown> {
  agentId: string;
  deger: T;
  kaynak: KaynakTuru;
  guven: number;
  kanitlar: readonly Kanit[];
}

export type CozumKodu =
  | 'tek_iddia'
  | 'uzlasma'
  | 'kaynak_gucu'
  | 'kanit_tazeligi'
  | 'guven_farki';

export type Cozum<T> =
  | { durum: 'cozuldu'; deger: T; kazanan: string; kod: CozumKodu }
  | { durum: 'belirsiz'; sebep: string; adaylar: readonly string[] };

/** İki güveni "aynı" saymak için tolerans. Altındaki fark ayırt etmez. */
const GUVEN_TOLERANSI = 0.15;

function enTazeKanit(i: Iddia): number {
  let en = -Infinity;
  for (const k of i.kanitlar) if (k.at > en) en = k.at;
  return en;
}

/**
 * Çelişkiyi çözer ya da açıkça `belirsiz` der.
 *
 * `esitMi` çağıran tarafından verilir: iki fiyatın eşitliği ile iki
 * kategori adının eşitliği aynı şey değil ve bu modül değerlerin ne
 * olduğunu bilmek zorunda kalmamalı.
 */
export function cozumle<T>(
  iddialar: readonly Iddia<T>[],
  esitMi: (a: T, b: T) => boolean = Object.is,
): Cozum<T> {
  if (iddialar.length === 0) {
    return { durum: 'belirsiz', sebep: 'hiç iddia yok', adaylar: [] };
  }
  if (iddialar.length === 1) {
    const tek = iddialar[0]!;
    return { durum: 'cozuldu', deger: tek.deger, kazanan: tek.agentId, kod: 'tek_iddia' };
  }

  /* Hepsi aynı şeyi söylüyorsa çelişki yoktur -- ayrıştırmaya gerek yok. */
  const ilk = iddialar[0]!;
  if (iddialar.every((i) => esitMi(i.deger, ilk.deger))) {
    return { durum: 'cozuldu', deger: ilk.deger, kazanan: ilk.agentId, kod: 'uzlasma' };
  }

  const adaylar = iddialar.map((i) => i.agentId);

  // 1) Kaynak gücü.
  const enGuclu = Math.max(...iddialar.map((i) => KAYNAK_GUCU[i.kaynak]));
  const gucluOlanlar = iddialar.filter((i) => KAYNAK_GUCU[i.kaynak] === enGuclu);
  if (gucluOlanlar.length === 1) {
    const k = gucluOlanlar[0]!;
    return { durum: 'cozuldu', deger: k.deger, kazanan: k.agentId, kod: 'kaynak_gucu' };
  }

  // 2) Kanıt tazeliği -- aynı güçteki kaynaklar arasında.
  const tazeler = gucluOlanlar.map((i) => ({ i, t: enTazeKanit(i) }));
  const enTaze = Math.max(...tazeler.map((x) => x.t));
  if (Number.isFinite(enTaze)) {
    const tazeOlanlar = tazeler.filter((x) => x.t === enTaze);
    if (tazeOlanlar.length === 1) {
      const k = tazeOlanlar[0]!.i;
      return { durum: 'cozuldu', deger: k.deger, kazanan: k.agentId, kod: 'kanit_tazeligi' };
    }
  }

  // 3) Güven -- yalnızca fark anlamlıysa.
  const siralı = [...gucluOlanlar].sort((a, b) => b.guven - a.guven);
  const en = siralı[0]!;
  const ikinci = siralı[1]!;
  if (en.guven - ikinci.guven >= GUVEN_TOLERANSI) {
    return { durum: 'cozuldu', deger: en.deger, kazanan: en.agentId, kod: 'guven_farki' };
  }

  /*
   * Üç ölçüt de ayırt edemedi. Burada bir seçim yapmak, kanıtı olmayan
   * bir karar üretmek olurdu.
   */
  return {
    durum: 'belirsiz',
    sebep: 'kaynak gücü, kanıt tazeliği ve güven farkı ayırt etmedi',
    adaylar,
  };
}
