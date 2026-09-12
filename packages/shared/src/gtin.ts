/**
 * Kanonik (14 haneye doldurulmuş) GTIN'i GÖSTERİM biçimine çevirir.
 *
 * NEDEN GEREKLİ
 * Besleme her GTIN'i `padStart(14, '0')` ile saklıyor (gerekçesi
 * `packages/ingest/src/normalize.ts` içinde: eşleştirme ancak tek biçim
 * üzerinden anlamlı). Ama ürünün üzerinde yazan ve perakendecilerin
 * indekslediği kod o dolgulu hâli değil, kendi asıl uzunluğudur. Google'a
 * yapılandırılmış veride verilen kodun gerçek biçim olması eşleşme
 * şansını artırır.
 *
 * DOLGU NASIL GERİ ALINIR
 * Sıfırları körlemesine kırpmak YANLIŞ olurdu: bir EAN-13 pekâlâ sıfırla
 * başlayabilir (UPC-A'nın EAN-13 gösterimi tam olarak öyledir) ve o sıfır
 * anlamlıdır. Bu yüzden yalnızca GEÇERLİ GTIN uzunluklarına inilir --
 * 8, 12, 13, 14 -- ve yalnızca kırpılacak kısım tamamen sıfırsa:
 *
 *   000000XXXXXXXX  -> GTIN-8   (ilk 6 hane sıfır)
 *   00XXXXXXXXXXXX  -> GTIN-12  (ilk 2 hane sıfır)
 *   0XXXXXXXXXXXXX  -> GTIN-13  (ilk hane sıfır)
 *   XXXXXXXXXXXXXX  -> GTIN-14
 *
 * Üretimde ölçüldü: 25.484 grubun hepsi 14 hane; sıfırsız uzunlukları
 * 13 (16.541), 12 (5.929), 11 (2.955), 14 (55) ve 9 (4). Son ikisi tam
 * olarak yukarıdaki kuralın koruduğu durumlar -- 11 ve 9 GEÇERLİ GTIN
 * uzunlukları değildir, dolayısıyla onlar GTIN-12'ye iner ve baştaki
 * anlamlı sıfır KORUNUR.
 *
 * KONTROL BASAMAĞI BURADA DOĞRULANMAZ. Besleme her GTIN'i saklamadan önce
 * GS1 kontrol basamağıyla doğruluyor (`normalizeGtin`); ikinci bir kopya
 * zamanla ayrışır. Buraya gelen değer geçerlidir ya da hiç gelmez.
 */

/** GS1'in tanıdığı GTIN uzunlukları, kısadan uzuna. */
const GECERLI_UZUNLUKLAR = [8, 12, 13, 14] as const;

export function gtinDisplayForm(canonical: string | null | undefined): string | null {
  if (!canonical) return null;

  const digits = canonical.trim();
  if (!/^\d{8,14}$/.test(digits)) return null;

  for (const uzunluk of GECERLI_UZUNLUKLAR) {
    if (uzunluk > digits.length) continue;

    const kirpilacak = digits.length - uzunluk;
    // Kırpılacak kısım tamamen sıfırsa o uzunluk güvenli.
    if (digits.slice(0, kirpilacak) === '0'.repeat(kirpilacak)) {
      return digits.slice(kirpilacak);
    }
  }

  return digits;
}
