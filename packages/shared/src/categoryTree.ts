/**
 * Kategori ağacı: düz listeden gezinilebilir yapıya.
 *
 * NEDEN AYRI BİR MODÜL
 * "Hangi kategori menüde görünür" bir arayüz detayı gibi durur ama değildir:
 * boş bir kategoriyi menüye koymak, kullanıcıyı hiçbir ürün olmayan bir
 * sayfaya göndermek demektir. Kural veriye bakarak alınmalı ve test
 * edilebilmeli; bileşenin içine gömülünce ikisi de olmuyor.
 *
 * SAYILAR ÖLÇÜLEN DEĞERLERDİR. `ownCount` çağıran tarafın veritabanından
 * saydığı gerçek grup sayısıdır. Burada tahmin, yuvarlama ya da "yaklaşık"
 * bir şey üretilmez.
 */

/** Ağaca girebilecek en az bilgi. Çağıran taraf daha fazlasını taşıyabilir. */
export interface CategoryLike {
  id: string;
  parentId: string | null;
}

export interface CategoryNode<T extends CategoryLike> {
  category: T;
  /**
   * Bu kategoride görülebilecek grup sayısı: KENDİ + ÇOCUKLARI.
   *
   * Toplama gerekli çünkü arama işlevi üst kategoriyi sorgularken alt
   * kategorileri de kapsıyor (`search_products` içinde `parent_id`
   * alt sorgusu). Yalnızca kendi sayısını göstermek "Elektronik: 0" gibi
   * gerçekle çelişen bir sayı üretirdi -- oysa o sayfa 34 binden fazla
   * ürün gösteriyor.
   */
  groupCount: number;
  children: Array<{ category: T; groupCount: number }>;
}

/**
 * Düz kategori listesini ağaca dizer ve BOŞ dalları eler.
 *
 * ELEME KURALI: grup sayısı sıfır olan kategori dışarıda kalır. Üst kategori
 * ancak kendi VE bütün çocukları boşsa düşer -- çocuğunda ürün olan bir üst
 * kategoriyi elemek, o ürünlere giden yolu kapatmak olurdu.
 *
 * SIRA KORUNUR. Gelen dizi zaten `sort_order` ile sıralı; burada yeniden
 * sıralamak o niyeti ezerdi.
 *
 * ÖKSÜZ ÇOCUK ÜSTE ÇIKAR. `parentId` listede olmayan bir kategoriyi
 * gösteriyorsa (üst kategori pasifleştirilmiş olabilir) çocuk KAYBEDİLMEZ,
 * üst seviyeye alınır. Sessizce düşürmek, o kategorideki ürünleri
 * gezinilemez yapardı.
 */
export function buildCategoryTree<T extends CategoryLike>(
  categories: readonly T[],
  ownCounts: ReadonlyMap<string, number>,
): CategoryNode<T>[] {
  const kimlikler = new Set(categories.map((c) => c.id));

  const ustSeviye = categories.filter(
    (c) => c.parentId === null || !kimlikler.has(c.parentId),
  );

  const cocuklar = new Map<string, T[]>();
  for (const c of categories) {
    if (c.parentId === null || !kimlikler.has(c.parentId)) continue;
    const liste = cocuklar.get(c.parentId);
    if (liste) liste.push(c);
    else cocuklar.set(c.parentId, [c]);
  }

  const dugumler: CategoryNode<T>[] = [];

  for (const ust of ustSeviye) {
    const kendi = ownCounts.get(ust.id) ?? 0;

    const doluCocuklar = (cocuklar.get(ust.id) ?? [])
      .map((c) => ({ category: c, groupCount: ownCounts.get(c.id) ?? 0 }))
      .filter((c) => c.groupCount > 0);

    const toplam = kendi + doluCocuklar.reduce((s, c) => s + c.groupCount, 0);
    if (toplam === 0) continue;

    dugumler.push({ category: ust, groupCount: toplam, children: doluCocuklar });
  }

  return dugumler;
}

/**
 * Bir kategorinin kardeşleri (aynı üst kategoriyi paylaşanlar).
 *
 * "Diğer kategoriler" bağlantıları için: bir bilgisayar sayfasından telefona
 * ve kulaklığa gitmek anlamlı, kozmetiğe gitmek değil. Düz bir "hepsi"
 * listesi ikisini ayırt etmez.
 */
export function siblingsOf<T extends CategoryLike>(
  categories: readonly T[],
  category: CategoryLike,
): T[] {
  return categories.filter((c) => c.id !== category.id && c.parentId === category.parentId);
}
