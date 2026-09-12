/**
 * Vitrin basamaklarının sıralaması.
 *
 * NEDEN AYRI BİR MODÜL
 * Sıralama kuralı bir ARAYÜZ kararı değil, bir ürün kararıdır: "hangi beş
 * ürün öne çıkar" sorusunun cevabı. Bileşenin içine gömülürse test edilemez
 * ve her tasarım değişikliğinde sessizce bozulur. Burada saf bir fonksiyon
 * olarak duruyor ve testi var.
 *
 * SKOR UYDURULMAZ
 * `score` alanı GERÇEK Ohaaaa skorudur (`ohaaaa_score` veritabanı
 * fonksiyonu). Ölçülemediğinde `null` gelir ve burada ikinci bir formülle
 * doldurulmaz. Bunun pratik sonucu şudur: skoru olan ürün yoksa sıralama
 * ölçülen başka bir ölçüte düşer ve arayüz bunu SÖYLER -- sıfır ölçümle
 * "en yüksek puanlı ürünler" yazmak, ölçmediğimizi ölçmüş gibi göstermek
 * olurdu.
 */

/** Bir basamakta yer alabilecek aday. */
export interface ShowcaseCandidate {
  /** Ürün adresi -- eşitlik bozucu olarak da kullanılır (kararlılık). */
  slug: string;
  /** GERÇEK Ohaaaa skoru; ölçülemediyse null. */
  score: number | null;
  /** Kaç teklifle karşılaştırılabiliyor. */
  offerCount: number;
  /** Kargo dahil en düşük toplam; bilinmiyorsa null. */
  totalCostCents: number | null;
}

/**
 * Skoru olmayan adaylar arasındaki sıra.
 *
 * ÖLÇÜLEN İKİ ŞEY: kaç teklifle karşılaştırılabildiği (bir karşılaştırma
 * sitesinde asıl değer bu) ve kargo dahil toplam maliyet. Üçüncü ölçüt
 * `slug`: iki ürün her iki ölçütte de eşitse sıra rastgele kalmasın diye.
 * Kararlılık şart -- her ISR yenilemesinde vitrin karışmamalı.
 */
function yedekSira(a: ShowcaseCandidate, b: ShowcaseCandidate): number {
  if (a.offerCount !== b.offerCount) return b.offerCount - a.offerCount;

  const at = a.totalCostCents;
  const bt = b.totalCostCents;
  // Fiyatı bilinmeyen SONA gider: bilinmeyeni "ucuz" saymak yanlış olurdu.
  if (at === null && bt !== null) return 1;
  if (bt === null && at !== null) return -1;
  if (at !== null && bt !== null && at !== bt) return at - bt;

  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * Adayları sıralar ve ilk `limit` tanesini döndürür.
 *
 * SKORLULAR ÖNDE. Skoru ölçülebilen bir ürün, ölçülemeyen bir üründen daha
 * fazla şey biliyoruz demektir; onu öne almak bilgiyi kullanmaktır. Skoru
 * olanlar kendi aralarında skora göre, olmayanlar `yedekSira` ile dizilir.
 */
export function rankShowcase<T extends ShowcaseCandidate>(
  candidates: readonly T[],
  limit: number,
): T[] {
  if (limit <= 0) return [];

  const sirali = [...candidates].sort((a, b) => {
    const aPuanli = a.score !== null;
    const bPuanli = b.score !== null;

    if (aPuanli && bPuanli) {
      if (a.score !== b.score) return (b.score as number) - (a.score as number);
      return yedekSira(a, b);
    }
    if (aPuanli !== bPuanli) return aPuanli ? -1 : 1;
    return yedekSira(a, b);
  });

  return sirali.slice(0, limit);
}

/**
 * Listedeki kaç ürünün GERÇEKTEN ölçülmüş bir skoru var.
 *
 * Parametre `ShowcaseCandidate` değil, yalnızca `score` taşıyan herhangi bir
 * kayıt: arayüz sıralamayı yaptıktan sonra elindeki nesnede sıralama alanları
 * (teklif sayısı, toplam maliyet) artık bulunmuyor ve onları taşımak zorunda
 * bırakmak, gösterilmeyen alanları sırf tip uysun diye sürüklemek olurdu.
 */
export function scoredCount(items: readonly { score: number | null }[]): number {
  return items.filter((item) => item.score !== null).length;
}
