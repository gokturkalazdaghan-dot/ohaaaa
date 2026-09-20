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
   * Bu kategoride görülebilecek grup sayısı: KENDİ + BÜTÜN ALT AĞACI.
   *
   * Toplama gerekli çünkü arama işlevi bir kategoriyi sorgularken alt
   * ağacının tamamını kapsıyor (`kategori_kapsami` özyinelemeli iniyor).
   * Yalnızca kendi sayısını göstermek "Elektronik: 0" gibi gerçekle çelişen
   * bir sayı üretirdi -- oysa o sayfa 34 binden fazla ürün gösteriyor.
   *
   * TOPLAM ÜÇ SEVİYEYİ KAPSAR. Taksonomi L1 > L2 > L3 olduğundan yalnızca
   * doğrudan çocukları toplamak, ürün kategorilerindeki (L3) ürünleri
   * saymadan bırakırdı: menüdeki sayı ile sayfadaki liste ayrışır ve
   * kullanıcı dolu bir kategoriyi boş sanıp hiç tıklamazdı.
   */
  groupCount: number;
  /** Alt kategoriler -- kendileri de birer düğüm, yani ağaç istenen
   * derinlikte gezilebilir. Boş dallar elenmiştir. */
  children: CategoryNode<T>[];
}

/**
 * Düz kategori listesini ağaca dizer ve BOŞ dalları eler.
 *
 * ELEME KURALI: kendi VE bütün alt ağacı sıfır olan kategori dışarıda kalır.
 * Çocuğunda ürün olan bir üst kategoriyi elemek, o ürünlere giden yolu
 * kapatmak olurdu.
 *
 * SIRA KORUNUR. Gelen dizi zaten `sort_order` ile sıralı; burada yeniden
 * sıralamak o niyeti ezerdi.
 *
 * ÖKSÜZ ÇOCUK ÜSTE ÇIKAR. `parentId` listede olmayan bir kategoriyi
 * gösteriyorsa (üst kategori pasifleştirilmiş olabilir) çocuk KAYBEDİLMEZ,
 * üst seviyeye alınır. Sessizce düşürmek, o kategorideki ürünleri
 * gezinilemez yapardı.
 *
 * DÖNGÜYE KARŞI KORUMALI. Veritabanı tarafı döngüyü zaten reddediyor ama bu
 * fonksiyon başka bir kaynaktan (demo küme, önbellek, test) beslenebilir:
 * ziyaret edilmiş kimlik ikinci kez açılmaz, yoksa sonsuz özyineleme
 * sunucuyu kilitlerdi.
 */
export type SecondaryPlacements = ReadonlyMap<string, readonly string[]>;

export function buildCategoryTree<T extends CategoryLike>(
  categories: readonly T[],
  ownCounts: ReadonlyMap<string, number>,
  secondaryPlacements?: SecondaryPlacements,
): CategoryNode<T>[] {
  const kimlikler = new Set(categories.map((c) => c.id));
  const kategoriKimlige = new Map(categories.map((c) => [c.id, c]));

  const cocuklar = new Map<string, T[]>();
  for (const c of categories) {
    if (c.parentId === null || !kimlikler.has(c.parentId)) continue;
    const liste = cocuklar.get(c.parentId);
    if (liste) liste.push(c);
    else cocuklar.set(c.parentId, [c]);
  }

  const ustSeviye = categories.filter(
    (c) => c.parentId === null || !kimlikler.has(c.parentId),
  );

  /**
   * Bir dalı düğüme çevirir; dal tamamen boşsa `null` döner.
   *
   * `yolda` aynı dalda açık olan kimlikleri tutar: bir döngü varsa ikinci
   * ziyaret engellenir ve dal orada kapanır.
   */
  const dugumKur = (kategori: T, yolda: ReadonlySet<string>): CategoryNode<T> | null => {
    if (yolda.has(kategori.id)) return null;
    const yeniYol = new Set(yolda).add(kategori.id);

    const kendi = ownCounts.get(kategori.id) ?? 0;

    const altDugumler = (cocuklar.get(kategori.id) ?? [])
      .map((c) => dugumKur(c, yeniYol))
      .filter((d): d is CategoryNode<T> => d !== null);

    /*
     * İKİNCİL YERLEŞİMLER SAYIYA KATILMAZ.
     *
     * "Saat" hem Moda hem Takı altında görünüyor ama ürünleri tek bir yerde
     * duruyor. İkisine de eklemek aynı ürünleri iki kez saymak ve kullanıcıya
     * gerçek olmayan bir sayı göstermek olurdu.
     *
     * Aynı sebeple boş bir üst kategori ikincil yerleşimle DİRİLMEZ: kendi
     * dalı boşsa menüden düşer. Yoksa ürünü olmayan bir sayfaya giden yol
     * açardık.
     */
    const toplam = kendi + altDugumler.reduce((s, d) => s + d.groupCount, 0);
    if (toplam === 0) return null;

    const ekDugumler = (secondaryPlacements?.get(kategori.id) ?? [])
      .map((kimlik) => kategoriKimlige.get(kimlik))
      .filter((c): c is T => c !== undefined)
      // Zaten birincil çocuksa iki kez listeleme.
      .filter((c) => !altDugumler.some((d) => d.category.id === c.id))
      .map((c) => dugumKur(c, yeniYol))
      .filter((d): d is CategoryNode<T> => d !== null);

    return {
      category: kategori,
      groupCount: toplam,
      children: [...altDugumler, ...ekDugumler],
    };
  };

  const bos: ReadonlySet<string> = new Set<string>();
  return ustSeviye
    .map((ust) => dugumKur(ust, bos))
    .filter((d): d is CategoryNode<T> => d !== null);
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
