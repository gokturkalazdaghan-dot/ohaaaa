/**
 * Teklif sıralaması ve rozetleri — saf, belirlenimci, para birimi güvenli.
 *
 * ======================================================================
 * PARA BİRİMİ KARŞILAŞTIRMANIN İÇİNE GİREMEZ
 * ======================================================================
 * İki teklifin tutarını doğrudan kıyaslamak, ancak AYNI para biriminde
 * anlamlıdır. 1.200.000 HUF (~33 USD) ile 9.000 cent (90 USD)
 * kıyaslandığında sayı büyüklüğü HUF'u "pahalı" gösterir; oysa üçte biri
 * fiyatındadır. Bu, veritabanı tarafında Aşama 13'te düzeltildi -- burada
 * aynı kural arayüz tarafında zorlanıyor.
 *
 * ======================================================================
 * TEK ROZET YETMİYOR
 * ======================================================================
 * "En iyi teklif" tek bir etiketti ve toplam maliyete bakıyordu. Ama
 * kullanıcının sorusu her zaman "en ucuz hangisi" değil: bazen "en çabuk
 * hangisi", bazen "makul sürede en ucuz hangisi". Üçünü tek etikete
 * indirmek, ikisini gizlemek demek.
 *
 *   cheapest    kargo dâhil en düşük toplam
 *   fastest     en kısa teslimat
 *   best_value  makul sürede teslim edilenler arasında en ucuz
 *
 * `best_value` "en hızlının en fazla 2 gün gerisi" penceresiyle
 * tanımlanıyor: açık, belirlenimci ve açıklanabilir bir kural. Gizli bir
 * ağırlık formülü, kullanıcıya "neden bu?" sorusunu cevaplayamazdı.
 */

export type OfferBadge = 'cheapest' | 'fastest' | 'best_value';

/** Sıralama için gereken asgari alanlar. Tam `Offer` gerekmiyor. */
export interface RankableOffer {
  id: string;
  currency: string;
  totalCostCents: number;
  estimatedDeliveryDays: number;
  stock: number;
}

/** `best_value` penceresi: en hızlıdan en fazla bu kadar gün yavaş. */
export const BEST_VALUE_DELIVERY_SLACK_DAYS = 2;

export interface RankedCurrencyGroup<T extends RankableOffer> {
  currency: string;
  /** Toplam maliyete göre artan. */
  offers: T[];
  badges: Map<string, OfferBadge[]>;
}

/**
 * Teklifleri para birimine göre ayırır ve HER GRUBUN İÇİNDE sıralar.
 *
 * Gruplar, teklif sayısı çok olandan aza doğru; eşitlikte para birimi
 * koduna göre. Keyfi değil belirlenimci: aynı veri her zaman aynı sırayı
 * verir ve sayfa yenilendiğinde teklifler yer değiştirmez.
 */
export function rankOffersByCurrency<T extends RankableOffer>(
  offers: readonly T[],
): RankedCurrencyGroup<T>[] {
  const gruplar = new Map<string, T[]>();

  for (const offer of offers) {
    const mevcut = gruplar.get(offer.currency);
    if (mevcut) mevcut.push(offer);
    else gruplar.set(offer.currency, [offer]);
  }

  return [...gruplar.entries()]
    .map(([currency, liste]) => {
      const sirali = [...liste].sort(
        (a, b) =>
          a.totalCostCents - b.totalCostCents ||
          a.estimatedDeliveryDays - b.estimatedDeliveryDays ||
          a.id.localeCompare(b.id),
      );
      return { currency, offers: sirali, badges: rozetler(sirali) };
    })
    .sort((a, b) => b.offers.length - a.offers.length || a.currency.localeCompare(b.currency));
}

/**
 * Bir para birimi içindeki rozetler.
 *
 * STOKTA OLMAYAN TEKLİF ROZET ALMAZ: alınamayan bir fiyat, fiyat değildir
 * ve "en ucuz" diye öne çıkarmak kullanıcıyı boşuna tıklatır.
 */
function rozetler<T extends RankableOffer>(sirali: readonly T[]): Map<string, OfferBadge[]> {
  const map = new Map<string, OfferBadge[]>();
  const alinabilir = sirali.filter((o) => o.stock > 0);
  if (alinabilir.length === 0) return map;

  const ekle = (id: string, badge: OfferBadge) => {
    const mevcut = map.get(id);
    if (mevcut) mevcut.push(badge);
    else map.set(id, [badge]);
  };

  // `sirali` zaten toplam maliyete göre; ilk alınabilir olan en ucuzu.
  const enUcuz = alinabilir[0]!;
  ekle(enUcuz.id, 'cheapest');

  const enHizli = [...alinabilir].sort(
    (a, b) =>
      a.estimatedDeliveryDays - b.estimatedDeliveryDays ||
      a.totalCostCents - b.totalCostCents ||
      a.id.localeCompare(b.id),
  )[0]!;
  ekle(enHizli.id, 'fastest');

  /*
   * En iyi değer: en hızlının penceresi içinde teslim edilenler arasında en
   * ucuz. En ucuz zaten bu pencerede ise ayrı bir rozet EKLENMİYOR --
   * kullanıcıya aynı satır için iki farklı gerekçe göstermek, seçimi
   * kolaylaştırmaz, zorlaştırır.
   */
  const pencere = enHizli.estimatedDeliveryDays + BEST_VALUE_DELIVERY_SLACK_DAYS;
  const makulSurede = alinabilir.filter((o) => o.estimatedDeliveryDays <= pencere);

  if (makulSurede.length > 0) {
    const enIyiDeger = makulSurede[0]!;
    if (enIyiDeger.id !== enUcuz.id && enIyiDeger.id !== enHizli.id) {
      ekle(enIyiDeger.id, 'best_value');
    }
  }

  return map;
}
