/**
 * Sınırlı eşzamanlılıkla haritalama.
 *
 * NEDEN GEREKİYOR
 * `Promise.all(liste.map(fn))` bütün istekleri AYNI ANDA açar. Küçük bir
 * veritabanı örneğinde bu, isteklerin birbirini yavaşlatmasına ve belli bir
 * eşiğin üstünde topluca düşmesine yol açıyor.
 *
 * ÖLÇÜLDÜ (üretim, `product_groups` 400 satırlık okuma):
 *   eşzamanlı 1 → 1,43 - 6,31 sn   başarılı
 *   eşzamanlı 2 → 1,68 - 2,54 sn   başarılı, bozulma yok
 *   eşzamanlı 4 → HEPSİ başarısız, yanıt yok
 *
 * Yani sorun sıra değil, AYNI ANDA açılan istek sayısı. Bu yardımcı,
 * çağrıları sırayla değil ama SINIRLI sayıda tutarak yapıyor: tamamen
 * ardışığa düşmeden tavanın altında kalıyor.
 *
 * SONUÇ SIRASI KORUNUR: dönen dizi, girdinin sırasındadır. Çağıran taraf
 * eşleştirme için indekse güvenebilir.
 */
export async function eszamanliHaritala<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  /*
   * Sınır en az 1 olmalı. 0, negatif ya da NaN bir değer hiç işçi
   * başlatmaz; çağrı hata vermeden BOŞ sonuç döndürürdü -- testin
   * yakaladığı gerçek bir hata. `Number.isFinite` NaN'ı da kapsıyor.
   */
  const istenen = Number.isFinite(limit) ? Math.floor(limit) : 1;
  const tavan = Math.max(1, Math.min(istenen, items.length));

  const sonuc = new Array<R>(items.length);
  let siradaki = 0;

  async function isci(): Promise<void> {
    for (;;) {
      const i = siradaki++;
      if (i >= items.length) return;
      sonuc[i] = await fn(items[i]!, i);
    }
  }

  /*
   * Hata OLDUĞU GİBİ yukarı çıkar. Yutmak, çağıranın bir sonucun eksik
   * olduğunu fark etmesini engellerdi; kısmi tolerans gerekiyorsa onu
   * çağıran taraf `fn` içinde kendi kurallarıyla kurar.
   */
  await Promise.all(Array.from({ length: tavan }, () => isci()));

  return sonuc;
}
