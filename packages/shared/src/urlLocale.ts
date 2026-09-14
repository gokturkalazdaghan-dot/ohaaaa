/**
 * ADRESTE DİL VE PAZAR.
 *
 * NEDEN ADRESTE OLMAK ZORUNDA
 * Bugün dil ve pazar YALNIZCA istek başlıklarından çözülüyor
 * (`x-vercel-ip-country`, `accept-language`). Tek bir adres, isteği yapanın
 * IP'sine göre farklı dilde içerik döndürüyor. Bunun iki somut sonucu var:
 *
 *   1. Arama motoru tek bir konumdan tarar. Gördüğü tek varyantı indeksler;
 *      diğer pazarlar arama sonuçlarında HİÇ var olmaz.
 *   2. Kullanıcı gördüğü sayfanın bağlantısını paylaşamaz -- karşı taraf
 *      başka bir ülkeden açtığında başka bir sayfa görür.
 *
 * `hreflang` da bu olmadan anlamsızdır: her dil varyantının KENDİ adresi
 * olmalı ki birbirlerine işaret edebilsinler.
 *
 * BİÇİM: `/{dil}-{pazar}/...`  ör. `/en-gb/kategori/...`, `/ar-ae/urun/...`
 *
 * Dil ve pazar AYRI taşınıyor çünkü ayrı şeyler: Londra'daki Türkçe okuyan
 * ziyaretçi `tr-uk` ister -- Türkçe arayüz, sterlin fiyat. Tek bir kod
 * (`/uk/`) bunu ifade edemezdi.
 *
 * VARSAYILAN ÖNEKSİZ SUNULUR ve bu bilinçli: site bugün `/kategori/...`
 * adreslerinde canlı ve site haritası 34.500 ürün adresi yayımlıyor.
 * Hepsini bir anda `/tr-tr/...` altına taşımak, indekslenmiş her adresi
 * yönlendirmeye sokardı. Varsayılanın önekli hâli kanonik olarak öneksize
 * işaret eder; böylece iki adres tek içerik sayılır.
 */

/** Yol segmenti biçimi: iki harf dil, tire, 2–15 karakter pazar. */
const SEGMENT_DESENI = /^([a-z]{2})-([a-z][a-z0-9_]{1,15})$/;

export interface YolDili {
  /** Arayüz dili, küçük harf. */
  locale: string;
  /** Pazar kodu, BÜYÜK harf -- veritabanındaki hâliyle. */
  market: string;
}

/**
 * Yol segmentini dile ve pazara çevirir; tanınmayan biçimde `null`.
 *
 * BURADA ÜYELİK KONTROLÜ YAPILMAZ, yalnızca BİÇİM. Hangi pazarın gerçekten
 * var olduğunu katalog bilir; onun kopyasını burada tutmak, kaçınmaya
 * çalıştığımız ikinci doğruluk kaynağı olurdu.
 */
export function yolSegmentiniCoz(segment: string): YolDili | null {
  const eslesme = SEGMENT_DESENI.exec(segment.trim().toLowerCase());
  if (!eslesme) return null;
  return { locale: eslesme[1]!, market: eslesme[2]!.toUpperCase() };
}

/** Dil ve pazardan yol segmenti üretir. */
export function yolSegmentiYaz(locale: string, market: string): string {
  return `${locale.toLowerCase()}-${market.toLowerCase()}`;
}

export interface AyristirilmisYol {
  /** Adreste dil segmenti varsa bu; yoksa `null`. */
  segment: YolDili | null;
  /** Segment çıkarıldıktan sonra kalan yol. Her zaman `/` ile başlar. */
  kalan: string;
}

/**
 * Yolun başındaki dil segmentini ayırır.
 *
 * Segment YOKSA yol olduğu gibi döner -- bu, varsayılan pazarın öneksiz
 * sunulmasının doğrudan sonucu ve bir hata değil.
 */
export function yoluAyristir(pathname: string): AyristirilmisYol {
  const temiz = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const parcalar = temiz.split('/');
  const ilk = parcalar[1] ?? '';

  const segment = yolSegmentiniCoz(ilk);
  if (!segment) return { segment: null, kalan: temiz };

  const kalan = `/${parcalar.slice(2).join('/')}`;
  return { segment, kalan: kalan === '/' ? '/' : kalan.replace(/\/+$/, '') || '/' };
}

/**
 * Dil ve pazar için tam adres yolu.
 *
 * Varsayılan ikili ÖNEKSİZ döner; böylece bugünkü adresler değişmez.
 */
export function yolKur(
  kalan: string,
  locale: string,
  market: string,
  varsayilan: YolDili,
): string {
  const temiz = kalan.startsWith('/') ? kalan : `/${kalan}`;

  if (
    locale.toLowerCase() === varsayilan.locale.toLowerCase() &&
    market.toUpperCase() === varsayilan.market.toUpperCase()
  ) {
    return temiz;
  }

  const onek = `/${yolSegmentiYaz(locale, market)}`;
  return temiz === '/' ? onek : `${onek}${temiz}`;
}

/**
 * `hreflang` niteliğinin değeri — BCP-47.
 *
 * Pazar kodu ÜLKE kodu DEĞİLDİR: Britanya'nın pazarı `UK`, ülke kodu `GB`.
 * `hreflang` bir ÜLKE bekler, o yüzden çağıran taraf ülkeyi geçirmek
 * zorunda. Pazar kodunu ülke sanıp yazmak, arama motoruna var olmayan bir
 * bölge bildirmek olurdu.
 */
export function hreflangEtiketi(locale: string, countryCode: string): string {
  return `${locale.toLowerCase()}-${countryCode.toUpperCase()}`;
}

export interface DilAlternatifi {
  /** `hreflang` değeri: `tr-TR`, `en-GB`, `ar-AE`… */
  hreflang: string;
  /** Mutlak adres. */
  href: string;
}

export interface AlternatifGirdisi {
  locale: string;
  market: string;
  /** `hreflang` için ülke kodu -- pazarın temsil ettiği ülke. */
  countryCode: string;
}

/**
 * Bir sayfanın bütün dil alternatifleri + `x-default`.
 *
 * `x-default`, hangi varyantın "başka hiçbiri uymazsa" gösterileceğini
 * söyler ve varsayılan ikiliye işaret eder. Onsuz arama motoru seçimi
 * kendisi yapar; bizim bildiğimiz bir şeyi ona tahmin ettirmenin sebebi
 * yok.
 */
export function dilAlternatifleri(
  kalan: string,
  girdiler: readonly AlternatifGirdisi[],
  varsayilan: YolDili,
  siteUrl: string,
): DilAlternatifi[] {
  const kok = siteUrl.replace(/\/+$/, '');
  const gorulen = new Set<string>();
  const cikti: DilAlternatifi[] = [];

  for (const g of girdiler) {
    const etiket = hreflangEtiketi(g.locale, g.countryCode);
    /* Aynı etiket iki kez yazılamaz: arama motoru çelişkili sayar. */
    if (gorulen.has(etiket)) continue;
    gorulen.add(etiket);
    cikti.push({ hreflang: etiket, href: `${kok}${yolKur(kalan, g.locale, g.market, varsayilan)}` });
  }

  cikti.sort((a, b) => a.hreflang.localeCompare(b.hreflang));

  cikti.push({
    hreflang: 'x-default',
    href: `${kok}${yolKur(kalan, varsayilan.locale, varsayilan.market, varsayilan)}`,
  });

  return cikti;
}

/**
 * Sayfanın KENDİ kanonik adresi.
 *
 * NEDEN GEREKLİ
 * Kanonik, `dilMetaVerisi` içinde dil öneki ATILMIŞ yoldan üretiliyordu.
 * Sonucu üretimde ölçüldü: `/en-uk` sayfası `rel="canonical"` ile
 * `https://www.ohaaaa.com` (Türkçe kök) gösteriyordu. Bu, arama motoruna
 * "İngiliz pazarı sayfası Türkçe kökün KOPYASIDIR" demektir; sayfa dizine
 * girmez ve üzerindeki `hreflang` kümesi de yok sayılır -- çünkü arama
 * motoru `hreflang`i yalnızca KENDİ kanonik sayfasında dikkate alır.
 * Yani adres öneki eklenmiş olmasına rağmen hiçbir pazar sayfası
 * indekslenemezdi.
 *
 * KURAL
 * Kanonik, sayfanın gerçekten sunduğu dil-pazar ikilisine işaret eder.
 * Varsayılan ikili öneksiz kalır (`yolKur` zaten böyle davranır), yani
 * `/tr-tr/...` hâlâ `/...` adresine kanoniklenir -- bilinçli olan tek
 * çapraz-kanonik budur.
 *
 * `sunulanlar` ŞART. Kanonik, `hreflang` listesinde BULUNMAYAN bir adrese
 * işaret ederse küme tutarsız olur ve arama motoru tamamını atar. Aynı
 * listeyi kaynak almak bu tutarlılığı yapısal olarak garanti eder:
 * tanınmayan bir önek (`/en-gb` -- `gb` bir pazar değil) ya da çevirisi
 * olmayan bir dil geldiğinde varsayılana düşülür, böylece uydurma adres
 * kanonikleşmez.
 */
export function kanonikYol(
  kalan: string,
  secim: YolDili | null,
  varsayilan: YolDili,
  sunulanlar: readonly AlternatifGirdisi[],
): string {
  const sunuluyor =
    secim !== null &&
    sunulanlar.some(
      (g) =>
        g.locale.toLowerCase() === secim.locale.toLowerCase() &&
        g.market.toUpperCase() === secim.market.toUpperCase(),
    );

  const ikili = sunuluyor ? secim : varsayilan;
  return yolKur(kalan, ikili.locale, ikili.market, varsayilan);
}
