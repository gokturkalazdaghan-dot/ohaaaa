/**
 * Listeleme toplamı için TAVANLI SAYIM.
 *
 * NEDEN VAR
 * PostgREST'in `count: 'exact'` sayımı, eşleşen BÜTÜN satırları saydırır.
 * Üretimde ölçüldü: 24 satırlık bir sayfa için ~32.000 satır taranıyordu ve
 * bu, bir saat içinde 169 adet HEAD 500'ün doğrudan kaynağıydı.
 *
 * TASARIM KARARI: yaklaşık değere DÜŞÜLMÜYOR.
 * Tavanın altında sayı hâlâ KESİN. Yalnızca tavanın üstünde "şu kadardan
 * fazla" deniyor ve bayrak kaldırılıyor. Planlayıcı tahmini (`planned`)
 * kullanmak daha ucuz olurdu ama kullanıcıya kesinmiş gibi görünen YANLIŞ
 * bir sayı gösterirdi -- 12 ürünlük bir kategoriye "yaklaşık 40" demek,
 * sayıyı hiç göstermemekten kötüdür.
 */

/** Varsayılan tavan. 24'lük sayfalarda ~42 sayfa eder. */
export const SAYIM_TAVANI = 1000;

export interface TavanliSayim {
  /** Gösterilecek sayı. Tavana dayandıysa tavanın kendisi. */
  toplam: number;
  /** true ise `toplam` bir ALT SINIRDIR, kesin değer değil. */
  tavanaDayandi: boolean;
}

/**
 * Sayım sorgusunun okuması gereken aralık.
 *
 * Üst sınır DAHİL olduğu için tavan+1 kayıt gelir. Fazladan tek kayıt,
 * "tavandan fazlası var mı" sorusunu ek sorgu olmadan yanıtlar.
 */
export function sayimAraligi(tavan: number = SAYIM_TAVANI): {
  baslangic: number;
  bitis: number;
} {
  const t = gecerliTavan(tavan);
  return { baslangic: 0, bitis: t };
}

/** Dönen satır sayısından tavanlı sonucu türetir. */
export function tavanliSayim(
  donenSatir: number,
  tavan: number = SAYIM_TAVANI,
): TavanliSayim {
  const t = gecerliTavan(tavan);
  /* Negatif ya da kesirli girdi anlamsız: sıfıra çekilir, uydurma yapılmaz. */
  const n = Number.isFinite(donenSatir) ? Math.max(0, Math.floor(donenSatir)) : 0;
  if (n > t) return { toplam: t, tavanaDayandi: true };
  return { toplam: n, tavanaDayandi: false };
}

/**
 * Sayıyı kullanıcıya yazarken kesinlik iddiasını doğru tutar.
 *
 * Biçimlendirme (binlik ayırıcı, yerel ayar) ÇAĞIRANA ait; burada yalnızca
 * "bundan fazla" işareti ekleniyor.
 */
export function toplamMetni(bicimlenmisSayi: string, tavanaDayandi: boolean): string {
  return tavanaDayandi ? `${bicimlenmisSayi}+` : bicimlenmisSayi;
}

function gecerliTavan(tavan: number): number {
  /* Tavan en az 1 olmalı: 0 tavan her sayımı "tavana dayandı" yapardı. */
  if (!Number.isFinite(tavan)) return SAYIM_TAVANI;
  return Math.max(1, Math.floor(tavan));
}
