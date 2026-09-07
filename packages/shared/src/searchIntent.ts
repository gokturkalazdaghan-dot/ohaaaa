/**
 * Doğal dil aramanın SÖZLEŞMESİ.
 *
 * Kullanıcı "5 bin liraya kadar iyi bir oyuncu kulaklığı bul" yazar; bu
 * dosya o cümlenin dönüşeceği YAPIYI tanımlar. Şema paylaşılan pakette çünkü
 * hem web hem ileride mobil aynı sözleşmeyi kullanmalı ve ikisi ayrışırsa
 * modelin çıktısı bir tarafta geçerli, diğerinde geçersiz olur.
 *
 * GÜVENLİK: BU ŞEMA BİR SINIRDIR
 * Model çıktısı doğrudan `search_products` RPC'sinin TİPLİ parametrelerine
 * gider; hiçbir yerde SQL metnine yapıştırılmaz. Yani başarılı bir prompt
 * injection bile en fazla "yanlış filtre" üretebilir -- sorgu çalıştıramaz.
 * Şemadaki her alanın dar tutulması (enum, üst sınır, uzunluk) bu sınırın
 * kendisidir.
 */

import { z } from 'zod';

/** Arama sonuç sıralaması -- veritabanındaki `p_sort` ile birebir. */
export const SEARCH_SORTS = ['relevance', 'price_asc', 'price_desc', 'offers'] as const;

export const searchIntentSchema = z.object({
  /*
   * Aranacak ÜRÜN TERİMİ: cümlenin fiyat/şehir/niyet kısımları ayıklanmış
   * hâli. "5 bin liraya kadar oyuncu kulaklığı" -> "oyuncu kulaklığı".
   * Cümlenin tamamını arama terimi yapmak, tam metin aramasını "liraya",
   * "kadar", "bul" gibi kelimelerle boğar.
   */
  query: z.string().trim().max(120),

  /*
   * FİYAT SINIRLARI VE ONLARIN PARA BİRİMİ.
   *
   * Alanlar önceden `maxPriceTl` / `minPriceTl` adını taşıyordu ve ADIN
   * KENDİSİ hatanın kaynağıydı: "gaming headset under $200" yazan bir
   * kullanıcının 200'ü, hiçbir şey sorulmadan 200 TL'ye (~5,5 USD)
   * dönüşüyordu. Sonuç boş bir liste -- hata mesajı yok, `understood: true`,
   * özet satırında da "200 TL altı" yazıyor. Yanlış cevabın sessiz hâli.
   *
   * Sayı ile para birimi artık AYRILMAZ: `currency` null ise sayı hâlâ
   * anlamlıdır ama hangi paranın sayısı olduğunu ÇAĞIRAN belirler (pazarın
   * varsayılan para birimi). Uydurulmuş bir varsayılanı buraya gömmek,
   * aynı hatayı bir kat aşağı taşımak olurdu.
   */
  maxPrice: z.number().int().min(0).max(100_000_000).nullable(),
  minPrice: z.number().int().min(0).max(100_000_000).nullable(),

  /**
   * Kullanıcının AÇIKÇA söylediği para birimi ("$200", "200 euro", "200 TL").
   * Söylemediyse null -- tahmin edilmez.
   */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),

  /*
   * Marka adları. Serbest metin ama arama tarafında `lower()` ile
   * karşılaştırılıyor; tanınmayan marka sonucu daraltır, güvenlik sorunu
   * üretmez.
   */
  brands: z.array(z.string().trim().min(1).max(60)).max(5),

  /** "kargo bedava", "ücretsiz kargo" dendiyse. */
  freeShipping: z.boolean(),

  sort: z.enum(SEARCH_SORTS),

  /*
   * Modelin İSTEĞİ ANLAYIP ANLAMADIĞI.
   *
   * Bu alan olmadan model her cümleye bir filtre uydurmak zorunda kalır --
   * "merhaba" yazana da bir ürün araması yapar. `understood: false` geldiğinde
   * arayüz kullanıcının yazdığını olduğu gibi arar, uydurulmuş filtre
   * uygulamaz.
   */
  understood: z.boolean(),

  /*
   * Kullanıcıya gösterilecek tek cümlelik özet: "5.000 TL altı oyuncu
   * kulaklığı arıyorum". Ne anladığını GÖSTERMEK, sessizce yanlış filtre
   * uygulamaktan iyidir -- kullanıcı yanlışı görüp düzeltebilir.
   */
  summary: z.string().trim().max(160),
});

export type SearchIntent = z.infer<typeof searchIntentSchema>;

/**
 * Cümle doğal dil mi, yoksa düz bir ürün adı mı?
 *
 * NEDEN GEREKLİ: her arama için model çağırmak hem para hem gecikme. "iphone
 * 16" yazan birinin cümlesinde ayıklanacak bir şey yok; doğrudan aramak hem
 * daha hızlı hem bedava. Model yalnızca gerçekten cümle kurulduğunda devreye
 * girer.
 *
 * Ölçüt üç sinyalden biri: fiyat ifadesi, niyet fiili ya da yeterli uzunluk.
 */
export function looksLikeNaturalLanguage(raw: string): boolean {
  const value = raw.trim();
  if (value.length < 12) return false;

  const kelimeSayisi = value.split(/\s+/).length;

  /*
   * Fiyat sinyali. Para birimi Türkçede sayının HER İKİ YANINDA da yazılır:
   * "2.500 TL" ve "₺2.500" ikisi de yaygın. İlk yazışta yalnızca sonrasını
   * arıyordum ve "₺2.500 altı bluetooth hoparlör" doğal dil sayılmıyordu --
   * test yakaladı.
   */
  /*
   * Para birimleri YALNIZCA TÜRK LİRASI DEĞİL. Katalog US/CA programlarıyla
   * birlikte çok para birimli hâle geldi; "$200 gaming headset" yazan biri
   * bu kalıba takılmıyordu ve cümle doğal dil sayılmadığı için modele hiç
   * gitmiyordu -- yani hem fiyat hem para birimi ayıklanmadan, cümlenin
   * tamamı arama terimi oluyordu.
   */
  const fiyatKalibi =
    /((tl|₺|lira|usd|eur|gbp|dolar|euro|avro|sterlin|[$€£])\s*\d|\d[\d.,]*\s*(tl|₺|lira|usd|eur|gbp|dolar|euro|avro|sterlin|[$€£])|\bbin\b|\bmilyon\b)/i;

  /*
   * Niyet sinyali: kullanıcı bir şey İSTİYOR, terim yazmıyor. Ekli hâller de
   * listede ("altı", "altında"); Türkçede sınır bildiren kelime çekimlenir ve
   * yalnızca bir hâlini aramak yarısını kaçırır.
   */
  const niyetKalibi =
    /\b(bul|ara|istiyorum|lazım|lazim|arıyorum|ariyorum|öner|oner|tavsiye|alt[ıi]|alt[ıi]nda|üst[üu]|üst[üu]nde|ust[uü]|kadar|aras[ıi]|civar[ıi]|maks(imum)?|en ucuz|en iyi|uygun)\b/i;

  if (fiyatKalibi.test(value)) return true;
  if (niyetKalibi.test(value)) return true;
  return kelimeSayisi >= 5;
}

/**
 * Ana birimden alt birime (lira -> kuruş, dolar -> sent).
 *
 * Para her yerde alt birimde (tam sayı) taşınır; kayan noktalı tutarla
 * hesap yapmak, 0.1 + 0.2 problemini faturaya taşımak olurdu.
 *
 * ÇARPAN 100 ve bu depo genelinde böyle: `formatMoney` de `cents / 100`
 * yapıyor, veritabanı sütunları da `_cents`. Sıfır ondalıklı para birimleri
 * (JPY, KRW) bu varsayımı bozar -- ama düzeltmesi tek bir işlev değil, para
 * biriminin alt birim basamağını her yerde okumak demek; burada sessizce
 * ayrışan ikinci bir kural yaratmak, o işi zorlaştırırdı.
 */
export function majorToCents(major: number | null): number | null {
  if (major === null || !Number.isFinite(major) || major < 0) return null;
  return Math.round(major * 100);
}

/**
 * Niyeti paylaşılabilir bir arama adresine çevirir.
 *
 * AI'ın çıktısı doğrudan sonuç sayfası ÇİZMEZ; normal `/arama` adresine
 * yönlendirir. Sebebi: o adres zaten paylaşılabilir, geri tuşuyla uyumlu,
 * önbelleklenebilir ve mevcut filtre arayüzüyle çalışıyor. AI'a ayrı bir
 * sonuç yolu yazmak, aynı özelliği ikinci kez uygulamak olurdu -- ve iki
 * yoldan biri er geç diğerinden farklı sonuç verirdi.
 */
export function intentToSearchParams(intent: SearchIntent): URLSearchParams {
  const params = new URLSearchParams();

  if (intent.query) params.set('q', intent.query);
  if (intent.minPrice !== null) params.set('min', String(intent.minPrice));
  if (intent.maxPrice !== null) params.set('max', String(intent.maxPrice));

  /*
   * Para birimi adreste `pb` ile taşınır ve YALNIZCA model açıkça bir para
   * birimi duyduysa yazılır. Yazılmadığında arama sayfası pazarın kendi
   * para birimini kullanır; buraya bir varsayılan gömmek, "$200" ile "200"
   * arasındaki farkı tam da kaybettiğimiz yerde tekrar kaybetmek olurdu.
   */
  if (intent.currency !== null) params.set('pb', intent.currency);

  /*
   * Marka VİRGÜLLE taşınır ve kargo değeri 'bedava'dır.
   *
   * İlk yazışta `marka`yı tekrarlı parametre, kargoyu 'ucretsiz' yapmıştım --
   * ikisi de arama sayfasının okuduğu biçim DEĞİL. O hâliyle AI doğru filtreyi
   * bulup adrese yazıyor, sayfa da onu görmezden geliyordu: sessizce yanlış
   * sonuç. Biçim tek yerde tanımlı olmadığı için de derleyici yakalayamazdı;
   * bu yüzden aşağıdaki test adres biçimini sayfayla birlikte sabitliyor.
   */
  if (intent.brands.length > 0) params.set('marka', intent.brands.join(','));
  if (intent.freeShipping) params.set('kargo', 'bedava');
  if (intent.sort !== 'relevance') params.set('sirala', intent.sort);

  // Yönlendirmenin AI'dan geldiğini işaretler: sonuç sayfası "şunu anladım"
  // satırını buna bakarak gösterir ve aynı sorguyu tekrar modele sormaz.
  params.set('ai', '1');

  return params;
}
