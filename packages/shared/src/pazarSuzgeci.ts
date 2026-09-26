/**
 * PAZAR SÜZGECİNİN AÇILIP AÇILMAYACAĞI KARARI.
 *
 * NEDEN BU DOSYA VAR
 * Karar tek satırlık görünüyor ama yanlış verildiğinde sitenin ana sayfasını
 * boşaltıyor -- ve bu, kodu okuyarak fark edilmez.
 *
 * ÖLÇÜLEN DURUM (canlı, 26 Eylül 2026): katalogda altı pazarın ürünü var
 * (UK 24.683, AT 11.003, IE 2.473, PL 1.006, US 99, IT 2 grup). Varsayılan
 * pazar olan TR ise SIFIR ürün taşıyor. Yani "istenen pazarı her zaman
 * süz" kuralı, öneksiz adresi -- ziyaretçilerin çoğunun gördüğü sayfayı --
 * tamamen boşaltırdı.
 *
 * Doğru kural: pazarın KATALOGDA ürünü varsa süz, yoksa süzme. Süzmemek
 * "her şeyi göster" demek, yani bu değişiklikten önceki davranış; bir
 * gerileme değil, olduğu yerde bırakma.
 *
 * `catalog.ts` içinde yazılabilirdi ama o dosya `server-only` ve
 * veritabanına bağlı; kural o hâlde test edilemezdi. Burada saf bir
 * fonksiyon olarak duruyor ve testi, "TR boş katalog görmez" garantisini
 * çalıştırılabilir biçimde sabitliyor.
 */

/**
 * İSTENEN pazarı UYGULANACAK süzgece çevirir.
 *
 * @param istenen  Ziyaretçinin pazarı (`/de-at` → 'AT'). Yoksa süzgeç yok.
 * @param katalogPazarlari Katalogda gerçekten ürünü olan pazar kodları.
 * @returns Süzülecek pazar kodu, ya da süzgeç uygulanmayacaksa `undefined`.
 */
export function uygulanacakPazar(
  istenen: string | null | undefined,
  katalogPazarlari: readonly string[],
): string | undefined {
  if (!istenen) return undefined;

  /*
   * Kod karşılaştırması BÜYÜK HARFE indirgenerek yapılıyor. Adres öneki
   * küçük harf (`/de-at`), veritabanı ise büyük harf ('AT') tutuyor;
   * çağıran tarafların her birinin bunu ayrı ayrı hatırlaması gereken bir
   * ayrıntı olsaydı, biri unuttuğunda o sayfa sessizce süzülmeden kalırdı.
   */
  const kod = istenen.trim().toUpperCase();
  if (kod.length === 0) return undefined;

  /*
   * LİSTE BOŞSA SÜZÜLMEZ. Boş liste iki şey demek olabilir: katalog
   * gerçekten boş, ya da liste OKUNAMADI. İkisini burada ayırt edemeyiz ve
   * ayırt edemediğimizde güvenli taraf süzmemektir -- geçici bir okuma
   * hatası yüzünden bütün katalogu gizlemek, gösterebileceğimiz ürünleri
   * de gizlemek olurdu.
   */
  if (katalogPazarlari.length === 0) return undefined;

  return katalogPazarlari.some((p) => p.trim().toUpperCase() === kod) ? kod : undefined;
}
