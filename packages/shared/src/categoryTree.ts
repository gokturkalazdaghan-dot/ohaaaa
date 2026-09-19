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
/**
 * İkincil yerleşim: `parentId` → o üst kategori altında AYRICA gösterilecek
 * kategori kimlikleri.
 *
 * Kanonik taksonomide bazı kavramlar iki ayrı Seviye-1 altında aranıyor
 * ("Saat" hem Moda'da hem Takı'da). İkinci bir kategori satırı açmak, aynı
 * kavramın ürünlerini iki kimliğe bölerdi; bu yüzden kategori tek evinde
 * kalıyor ve yalnızca menüde ikinci bir yerde daha görünüyor.
 */
export type SecondaryPlacements = ReadonlyMap<string, readonly string[]>;

export function buildCategoryTree<T extends CategoryLike>(
  categories: readonly T[],
  ownCounts: ReadonlyMap<string, number>,
  secondaryPlacements?: SecondaryPlacements,
): CategoryNode<T>[] {
  const kimlikler = new Set(categories.map((c) => c.id));
  const kategoriKimlige = new Map(categories.map((c) => [c.id, c]));

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
    /*
     * TOPLAM YALNIZCA KENDİ DALINDAN HESAPLANIR.
     *
     * İkincil yerleşimler bilerek bu toplamın DIŞINDA: "Saat" hem Moda hem
     * Takı altında görünüyor ama ürünleri tek bir yerde duruyor. İkisine de
     * eklemek aynı ürünleri iki kez saymak ve kullanıcıya gerçek olmayan bir
     * sayı göstermek olurdu.
     *
     * Aynı sebeple boş bir üst kategori ikincil yerleşimle DİRİLMEZ: kendi
     * dalı boşsa menüden düşer. Yoksa ürünü olmayan bir sayfaya giden yol
     * açardık.
     */
    if (toplam === 0) continue;

    const ekCocuklar = (secondaryPlacements?.get(ust.id) ?? [])
      .map((kimlik) => kategoriKimlige.get(kimlik))
      .filter((c): c is T => c !== undefined)
      // Zaten birincil çocuksa iki kez listeleme.
      .filter((c) => !doluCocuklar.some((d) => d.category.id === c.id))
      .map((c) => ({ category: c, groupCount: ownCounts.get(c.id) ?? 0 }))
      .filter((c) => c.groupCount > 0);

    dugumler.push({
      category: ust,
      groupCount: toplam,
      children: [...doluCocuklar, ...ekCocuklar],
    });
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
