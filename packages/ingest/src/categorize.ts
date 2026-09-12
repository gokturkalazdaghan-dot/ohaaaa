/**
 * Feed kategorisini KATALOG taksonomisine oturtur.
 *
 * PROBLEM (üretimde ölçüldü)
 * --------------------------
 * BTO feed'i 35.767 ürünün TAMAMI için tek bir kategori değeri gönderiyor:
 * `merchant_category = "computers"`. Katalog slug'ları ise Türkçe
 * (`bilgisayar`, `elektronik`, `telefon`, `kulaklik`, ...). Hiçbiri
 * eşleşmediği için alım şunu yazıyordu:
 *
 *   items_unclassified: 35767 / items_seen: 35767
 *   unknown_category_slugs: ["computers"]
 *
 * Sonuç: ürünler veritabanında VAR ama `/kategori/*` sayfalarında YOK.
 * `search_products` filtresi `product_groups.category_id` üzerinden
 * çalışıyor ve o sütun 34.721 grubun hepsinde null.
 *
 * PAZARYERLERİ BUNU NASIL ÇÖZÜYOR
 * -------------------------------
 * Trendyol, Hepsiburada ve Amazon üç katman kullanıyor:
 *
 *   1. Satıcının kategorisini kendi ağacına EŞLE (mapping)
 *   2. Eşleme kaba kalırsa ürün ADINDAN kural tabanlı sınıflandır
 *   3. Hiçbir şey tutmazsa GARANTİLİ bir kovaya düşür -- Amazon'un
 *      catch-all browse node'ları, Trendyol'un zorunlu kategori seçimi
 *
 * Üçüncü katman olmadan ürün görünmez olur; bizde tam olarak o oldu.
 *
 * BU DOSYA O ÜÇ KATMANI UYGULUYOR
 * -------------------------------
 * SIRA: (0) feed zaten katalog slug'ı mı, (1) ürün adı kuralları,
 * (2) feed kategorisi eşlemesi, (3) null.
 *
 * 1. katman 2.'den önce gelir ve bu bilinçli: ürün adı, feed
 * kategorisinden DAHA bilgilendirici. Bu feed'in kategorisi tek değer taşıyor, yani başlık
 * dışında ayırt edici hiçbir sinyal yok. "Logitech Zone Wireless Headset"
 * ile "Logitech MX Master Mouse" aynı `computers` değerini taşıyor ama
 * biri kulaklık biri bilgisayar çevre birimi.
 *
 * NEDEN YENİ KATEGORİ AÇILMIYOR
 * Taksonomi ürün kararıdır, feed kararı değil. Bu modül YALNIZCA mevcut
 * slug'lardan birini döndürür; `resolveCategoryIds` de yalnızca etkin
 * kategorileri çözer. Feed'in uydurduğu bir ad katalogda kategori açamaz.
 */

/**
 * Feed kategorisi -> katalog slug'ı.
 *
 * Anahtarlar KÜÇÜK HARF ve sadeleştirilmiş hâlde tutulur; arama da öyle
 * yapılır, böylece "Computers", "COMPUTERS" ve "computers" aynı yere düşer.
 *
 * Liste bilinçli olarak KISA: yalnızca gerçekten görülen değerler var.
 * Görülmeyen bir değer için kural yazmak, doğrulanmamış bir varsayımı
 * koda gömmek olurdu. Yeni bir feed geldiğinde `unknown_category_slugs`
 * uyarısı hangi değerin eklenmesi gerektiğini söyler.
 */
const FEED_KATEGORI_ESLEMESI: ReadonlyMap<string, string> = new Map([
  // BTO feed'inde ÖLÇÜLEN tek değer.
  ['computers', 'bilgisayar'],
  // Aynı ailenin yaygın yazımları -- Awin satıcıları arasında değişir.
  ['computing', 'bilgisayar'],
  ['computer', 'bilgisayar'],
  ['it', 'bilgisayar'],
  ['electronics', 'elektronik'],
  ['electronic', 'elektronik'],
  ['audio', 'kulaklik'],
  ['headphones', 'kulaklik'],
  ['phones', 'telefon'],
  ['mobile', 'telefon'],
  ['home', 'ev-yasam'],
  ['garden', 'ev-yasam'],
  ['beauty', 'kozmetik'],
  ['cosmetics', 'kozmetik'],
  ['fashion', 'moda'],
  ['clothing', 'moda'],
  ['sports', 'spor-outdoor'],
  ['outdoor', 'spor-outdoor'],
  ['grocery', 'supermarket'],
]);

/**
 * Ürün adı kuralları -- EN ÖZELDEN EN GENELE.
 *
 * Sıra doğruluğun kendisidir, üslup değil. "USB Headset" hem `usb` hem
 * `headset` içerir; kulaklık kuralı önce gelmezse bilgisayar çevre birimi
 * sayılırdı. Aynı şekilde "Phone Case with USB-C Cable" telefon
 * aksesuarıdır, kablo değil.
 *
 * Kalıplar kelime sınırıyla (`\b`) yazılıyor: `ram` kuralının "Panoramic"
 * içinde eşleşmesi gerçek bir hata olurdu ve sessizce yanlış kategori
 * üretirdi.
 */
const BASLIK_KURALLARI: ReadonlyArray<{ slug: string; kalip: RegExp }> = [
  {
    slug: 'kulaklik',
    kalip:
      /\b(headset|headsets|headphone|headphones|earphone|earphones|earbud|earbuds|kulaklik|kulaklık)\b/i,
  },
  {
    slug: 'telefon',
    kalip:
      /\b(phone case|phone cover|phone holder|smartphone|mobile phone|iphone|galaxy s\d|screen protector|telefon)\b/i,
  },
  {
    slug: 'bilgisayar',
    kalip:
      /\b(keyboard|keyboards|mouse|mice|monitor|monitors|laptop|laptops|notebook|ssd|hdd|ram|memory module|toner|drum unit|cartridge|printer|printers|scanner|webcam|docking station|usb|hub|kvm|router|switch|nas|klavye|fare|dizustu|dizüstü|bilgisayar)\b/i,
  },
  {
    slug: 'ev-yasam',
    kalip: /\b(desk|chair|lamp|shelf|shelving|cabinet|masa|sandalye|lamba|raf)\b/i,
  },
];

/**
 * Katalog slug'larının kümesi -- eşleme tablosunun DEĞERLERİNDEN türetilir.
 *
 * Ayrı bir liste yazmak iki kaynağın zamanla ayrışması demekti: tabloya
 * yeni bir hedef eklenip listeye eklenmezse o slug sessizce geçersiz
 * sayılırdı. Türetmek bu ayrışmayı imkânsız kılıyor.
 */
const KATALOG_SLUGLARI: ReadonlySet<string> = new Set(FEED_KATEGORI_ESLEMESI.values());

/**
 * Feed'in kategori metnini katalog slug bicimine indirger.
 *
 * "Ev & Yaşam" -> "ev-yasam", "Elektronik" -> "elektronik".
 * `categories.slug` citext oldugu icin buyuk/kucuk harf zaten onemsiz;
 * burada aksan ve noktalama da normalize edilir.
 *
 * BULANIK (fuzzy) ESLESME YOK. Yalnizca tam eslesme kabul edilir:
 * "telefon-aksesuar" degeri "telefon" kategorisine DUSMEZ. Bir urunu
 * yanlis kategoriye koymak, hic koymamaktan zararlidir -- kullanici yanlis
 * vitrinde yanlis urunu gorur ve karsilastirma vaadimiz coker.
 */
export function categorySlugKey(value: string | null | undefined): string | null {
  if (!value) return null;

  /*
   * TURKCE 'I' TUZAGI.
   *
   * JavaScript'te 'İ'.toLowerCase() 'i' + U+0307 (birlesen nokta) uretir --
   * tek karakter degil IKI karakter. Basit bir [ğüşıöç] haritasi bunu
   * yakalamaz ve 'ELEKTRONİK' degeri 'elektroni-k' olarak slug'lanip
   * katalogdaki 'elektronik' ile ESLESMEZ. Bu testle yakalandi; gercek bir
   * feed'de sessizce butun bir kategorinin siniflandirilamamasi demekti.
   *
   * Cozum: noktali/noktasiz I acikca ele alinir, kalan aksanlar NFD ile
   * ayristirilip birlesen isaretler atilir (ğ->g, ü->u, ş->s, ö->o, ç->c).
   */
  const slug = value
    .trim()
    .replace(/İ/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || null;
}

/**
 * Karsilastirma anahtari -- `categorySlugKey` ile AYNI fonksiyon.
 *
 * Ayri bir normallestirme yazmak gercek bir hataya yol acti: ilk hal
 * yalnizca kucuk harfe ceviriyordu, yani `Ev & Yasam` degeri `ev-yasam`
 * slug'ina donusmuyor ve gecerli bir katalog kategorisi taninmiyordu.
 */
function anahtar(deger: string): string {
  return categorySlugKey(deger) ?? '';
}

/**
 * Ürün için katalog kategori slug'ı bulur.
 *
 * @param feedKategori Feed'in kendi kategori değeri (ham).
 * @param baslik Ürün adı -- bu feed'de en bilgilendirici sinyal.
 * @returns Katalog slug'ı, ya da hiçbir katman tutmazsa `null`.
 *
 * `null` DÖNMESİ BİLİNÇLİ: burada uydurma bir genel varsayılan
 * (ör. her şeyi `elektronik` yapmak) taksonomiyi bozardı -- kozmetik bir
 * feed geldiğinde ürünleri yanlış kategoriye doldurmuş olurduk. Garantili
 * kova, feed'in KENDİ kategorisinin eşlenmesiyle sağlanıyor: BTO'da
 * `computers` -> `bilgisayar` tüm kataloğu kapsıyor.
 */
export function kategoriSlugBul(
  feedKategori: string | null | undefined,
  baslik: string | null | undefined,
): string | null {
  const ham = (feedKategori ?? '').trim();

  /*
   * 0. KATMAN: FEED ZATEN GEÇERLİ BİR KATALOG SLUG'I GÖNDERİYORSA AYNEN GEÇ.
   *
   * Bu katman anahtar kelime kurallarından ÖNCE gelir ve bu bilinçli: bir
   * kaynak katalog slug'ı yayacak şekilde yapılandırıldıysa bu, operatörün
   * ACIK kararıdır ve benim başlık sezgilerimden daha güvenilirdir.
   * `direct` sağlayıcısı tam olarak böyle çalışıyor.
   *
   * Bu katman olmadan gerçek bir regresyon oluşuyordu: `Elektronik`
   * gönderen bir feed `null` alıyordu, çünkü eşleme tablosunun ANAHTARLARI
   * İngilizce. Mevcut testler bunu yakaladı.
   */
  if (ham.length > 0 && KATALOG_SLUGLARI.has(anahtar(ham))) {
    return anahtar(ham);
  }

  // 1. KATMAN: ürün adı -- en özel sinyal.
  const ad = (baslik ?? '').trim();
  if (ad.length > 0) {
    for (const kural of BASLIK_KURALLARI) {
      if (kural.kalip.test(ad)) return kural.slug;
    }
  }

  // 2. KATMAN: feed kategorisi eşlemesi.
  if (ham.length > 0) {
    const dogrudan = FEED_KATEGORI_ESLEMESI.get(anahtar(ham));
    if (dogrudan) return dogrudan;

    /*
     * Feed kategorisi YOL olabilir: "Computers > Peripherals > Keyboards".
     * Awin satıcıları hem tek etiket hem yol gönderiyor. Yol geldiğinde
     * EN SPESİFİK parçadan başlanır: son parça en dar kategoridir.
     */
    const parcalar = ham
      .split(/[>\/|,]/)
      .map((p) => anahtar(p))
      .filter((p) => p.length > 0)
      .reverse();

    for (const parca of parcalar) {
      const eslesme = FEED_KATEGORI_ESLEMESI.get(parca);
      if (eslesme) return eslesme;
    }
  }

  // 3. KATMAN: eşleşme yok. Uydurmak yerine null -- çağıran taraf
  // `items_unclassified` olarak sayar ve uyarı hangi değerin eksik
  // olduğunu söyler.
  return null;
}
