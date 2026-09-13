/**
 * Pazar (market) ve dil (locale) çözümlemesi.
 *
 * NEDEN AYRI BİR KAVRAM
 * "Dil" ile "pazar" aynı şey değildir ve bunları karıştırmak somut hatalar
 * üretir: Almanya'da yaşayan Türkçe konuşan bir kullanıcı Türkçe arayüz
 * ister ama EURO fiyat ve Almanya'ya kargo yapan satıcılar görmelidir.
 * Dili pazara zincirlemek ona Türkiye'den, kendisine hiç gönderilmeyecek
 * teklifler gösterirdi.
 *
 *   locale  → arayüzün dili, sayı/tarih biçimi
 *   market  → hangi ülkenin teklifleri, hangi para birimi, hangi kargo
 *
 * Bu yüzden ikisi ayrı çözümlenir ve birbirinden BAĞIMSIZ taşınır.
 */

import type { Currency } from './money.js';

/** Arayüz dilleri. */
export const LOCALES = ['tr', 'de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Faaliyet gösterilen pazarlar.
 *
 * BU LİSTE ARTIK VERİTABANIYLA UYUMLU. Önceki hâli `['TR','DE','US','GB','ES','PT']`
 * idi ve kendi yorumunda bunun veritabanından ileride olduğunu, güvenli
 * olmasının tek sebebinin "bu değerler hiçbir sorguya ULAŞMIYOR" olduğunu
 * yazıyordu. O koşul artık geçerli değil: pazar kodu sorguya parametre olarak
 * girecek (`products.market_code`), dolayısıyla sözlüğün veriyle birebir
 * olması ŞART.
 *
 * ÖLÇÜLEN GERÇEK -- `public.markets` tablosu:
 *   ANZ · CA · EU · GCC · NORDICS · TR · UK · US
 *
 * Eski listedeki `GB` veritabanında YOK; oradaki kod `UK`. Ürünlerin tamamı
 * `market_code = 'UK'` taşıyor (35.742 teklif, ölçüldü). Yani eski sözlükle
 * kurulacak bir pazar süzmesi HİÇBİR ürün döndürmezdi. `DE`, `ES` ve `PT` de
 * tabloda yok -- Avrupa tek bir `EU` pazarı olarak modellenmiş.
 *
 * NEDEN TABLONUN TAMAMI DEĞİL: `ANZ`, `GCC` ve `NORDICS` satırlarının
 * `default_currency` değeri NULL (ölçüldü) -- çünkü üçü de tek para birimi
 * olmayan bölgeler (AUD/NZD, AED/SAR/QAR/KWD, SEK/NOK/DKK). Bir pazarın para
 * birimi, ziyaretçinin gerçekte ödeyeceği birimdir; onu uydurmak fiyatı
 * yanlış göstermek olur. O üçü, para birimi kararı verilip ürün geldiğinde
 * eklenecek. Buradaki her kod tabloda VAR -- liste bir alt küme, çelişki
 * değil.
 */
export const MARKETS = ['TR', 'UK', 'US', 'EU', 'CA'] as const;
export type Market = (typeof MARKETS)[number];

export const DEFAULT_LOCALE: Locale = 'tr';
export const DEFAULT_MARKET: Market = 'TR';

export interface MarketConfig {
  code: Market;
  /** Bu pazarın para birimi. Teklifler bu birimde saklanır. */
  currency: Currency;
  /** Kullanıcı bir dil belirtmediyse bu pazarda varsayılan dil. */
  defaultLocale: Locale;
  /** Sayı/tarih biçimi için BCP-47 etiketi. */
  numberLocale: string;
  /**
   * Bu pazarda öne çıkan diller -- dil SEÇİMİNİ SINIRLAMAZ.
   *
   * Bir zamanlar bu liste bir SÜZGEÇTİ: tarayıcının istediği dil listede
   * yoksa yok sayılıyordu. Ölçülen sonuç, dosyanın kendi başlığında yanlış
   * diye anlatılan davranışın ta kendisiydi -- Türkçe tarayıcıyla gelen
   * ziyaretçi `x-vercel-ip-country: GB` yüzünden İngilizce sayfa alıyordu
   * (canlıda doğrulandı: `<html lang="en-US">`, "We found what you need").
   *
   * Dil kullanıcının OKUYABİLDİĞİ şeydir, bulunduğu ülkenin değil. Süzgeç
   * kaldırıldı; liste, pazar için varsayılan/alternatif dilleri bildirmeye
   * devam ediyor (hreflang ve dil seçici bunu kullanır).
   */
  locales: readonly Locale[];
}

export const MARKET_CONFIG: Record<Market, MarketConfig> = {
  TR: {
    code: 'TR',
    currency: 'TRY',
    defaultLocale: 'tr',
    numberLocale: 'tr-TR',
    locales: ['tr', 'en'],
  },
  UK: {
    code: 'UK',
    currency: 'GBP',
    defaultLocale: 'en',
    numberLocale: 'en-GB',
    locales: ['en'],
  },
  US: {
    code: 'US',
    currency: 'USD',
    defaultLocale: 'en',
    numberLocale: 'en-US',
    locales: ['en'],
  },
  EU: {
    /*
     * Avrupa tek bir pazar olarak modelleniyor -- veritabanı öyle diyor
     * (`markets.code = 'EU'`, `default_currency = 'EUR'`). Ülke ülke ayırmak
     * mümkün ama bugün hiçbir Avrupa ülkesinde ürün yok; ayrım, ayıracak
     * ürün geldiğinde anlam kazanır.
     *
     * `defaultLocale` 'en': `LOCALES` yalnızca tr/de/en taşıyor ve EU yirmi
     * ülkeyi kapsıyor. Almancayı varsayılan yapmak Fransız kullanıcıya
     * Almanca göstermek olurdu. Almanca ve Türkçe PAZAR DİLİ olarak duruyor:
     * ikisi de gerçekten var ve kullanıcı seçerse çalışıyor.
     *
     * `numberLocale` 'en-IE': İngilizce + euro biçimi. Uydurma değil --
     * İrlanda tam olarak böyle yazar ("€1,234.56").
     */
    code: 'EU',
    currency: 'EUR',
    defaultLocale: 'en',
    numberLocale: 'en-IE',
    locales: ['en', 'de', 'tr'],
  },
  CA: {
    code: 'CA',
    currency: 'CAD',
    defaultLocale: 'en',
    numberLocale: 'en-CA',
    locales: ['en'],
  },
};

/**
 * Ülke kodundan pazara eşleme (ISO 3166-1 alpha-2).
 *
 * NEDEN AYRI BİR EŞLEME GEREKİYOR
 * Eskiden IP ülkesi DOĞRUDAN pazar kodu sayılıyordu. Artık olmaz: ülke ile
 * pazar aynı şey değil. Britanya'nın ülke kodu `GB`, pazar kodu `UK`;
 * Almanya'nın ülke kodu `DE`, pazarı ise `EU`.
 *
 * AVRUPA'DA YALNIZCA EURO BÖLGESİ EŞLENİYOR ve bu bilinçli. `EU` pazarının
 * para birimi EUR; bir pazarın para birimi ziyaretçinin gerçekte ödeyeceği
 * birimdir. İsveç'i (SEK) ya da Polonya'yı (PLN) EU'ya eşlemek onlara euro
 * fiyat göstermek olurdu. Euro kullanmayan AB üyeleri, kendi pazarları
 * açılana kadar varsayılana düşer -- onlara yanlış para birimi göstermektense
 * varsayılan pazarı göstermek dürüst.
 */
const EURO_BOLGESI = [
  'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
] as const;

const COUNTRY_TO_MARKET: Readonly<Record<string, Market>> = {
  TR: 'TR',
  GB: 'UK',
  US: 'US',
  CA: 'CA',
  ...Object.fromEntries(EURO_BOLGESI.map((ulke) => [ulke, 'EU' as Market])),
};

/**
 * Bir ülke kodunun pazarı; tanınmıyorsa null.
 *
 * Tanınmayan ülke için UYDURMA PAZAR AÇILMAZ. Çağıran taraf null görünce
 * varsayılana düşer; bu, ziyaretçiye yanlış para biriminde fiyat göstermekten
 * iyidir.
 */
export function marketForCountry(value: string | null | undefined): Market | null {
  if (!value) return null;
  const kod = value.trim().toUpperCase();
  return COUNTRY_TO_MARKET[kod] ?? null;
}

/** BCP-47 dil etiketi — `<html lang>` ve sesli arama için. */
const LOCALE_TAGS: Record<Locale, Record<Market, string>> = {
  tr: { TR: 'tr-TR', UK: 'tr-TR', US: 'tr-TR', EU: 'tr-TR', CA: 'tr-TR' },
  de: { TR: 'de-DE', UK: 'de-DE', US: 'de-DE', EU: 'de-DE', CA: 'de-DE' },
  en: { TR: 'en-GB', UK: 'en-GB', US: 'en-US', EU: 'en-IE', CA: 'en-CA' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function isMarket(value: unknown): value is Market {
  return typeof value === 'string' && (MARKETS as readonly string[]).includes(value);
}

/**
 * Tam BCP-47 etiketi.
 *
 * `<html lang>` ve `SpeechRecognition.lang` bunu ister. Salt "tr" de
 * geçerlidir ama bölge kodu ekli hâli, ekran okuyucunun ve ses tanımanın
 * doğru varyantı seçmesini sağlar: "en" belirsizdir, "en-US" değildir.
 */
export function localeTag(locale: Locale, market: Market = DEFAULT_MARKET): string {
  return LOCALE_TAGS[locale][market] ?? LOCALE_TAGS[locale][DEFAULT_MARKET]!;
}

/** Bir pazarın para birimi. */
export function currencyOf(market: Market): Currency {
  return MARKET_CONFIG[market].currency;
}

/**
 * `Accept-Language` başlığını q-değerlerine göre sıralı dil listesine çevirir.
 *
 * Tarayıcılar "tr-TR,tr;q=0.9,en-US;q=0.8" gibi gönderir. q yoksa 1 kabul
 * edilir. Bölge kısmı burada ATILIR: "de-AT" da Almancadır — Avusturyalı
 * bir ziyaretçiye "dilini desteklemiyoruz" demek yanlış olurdu.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale[] {
  if (!header) return [];

  const seen = new Set<Locale>();
  const out: Locale[] = [];

  const entries = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: (tag ?? '').trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((e) => e.tag !== '' && e.q > 0)
    /*
     * Sıralama KARARLI olmalı. Aynı q değerine sahip iki dil varsa
     * başlıktaki sıra korunur; `sort` kararlılığına güvenmek yerine
     * bunu açıkça yazıyoruz çünkü sıra, kullanıcının tercih sırasıdır.
     */
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => (b.q - a.q) || (a.i - b.i));

  for (const entry of entries) {
    const base = entry.tag.split('-')[0];
    if (isLocale(base) && !seen.has(base)) {
      seen.add(base);
      out.push(base);
    }
  }

  return out;
}

/**
 * Market çözümlemesinde kullanılan sinyaller — hepsi isteğe bağlı.
 *
 * PAZAR VE DİL AYRI ALANLARDA TAŞINIR ve bu, testin yakaladığı gerçek bir
 * hatanın sonucudur. Önce tek bir `explicit` alanı vardı; "de" değeri hem
 * Almanca (dil) hem Almanya (ülke) olarak okunabildiği için dil seçen bir
 * kullanıcı sessizce PAZAR da değiştirmiş oluyordu. "en" (İngilizce) ile
 * "EN" gibi bir ülke kodu arasında da aynı belirsizlik vardı.
 *
 * Belirsiz tek alan yerine iki açık alan: çağıran taraf ne demek istediğini
 * söylemek zorunda.
 */
export interface MarketSignals {
  /** Kullanıcının açıkça seçtiği PAZAR (ör. '/de-de' yolundaki 'DE'). */
  explicitMarket?: string | null;
  /** Kullanıcının açıkça seçtiği DİL. */
  explicitLocale?: string | null;
  /** Hesabın kayıtlı pazar tercihi. */
  accountMarket?: string | null;
  /** Hesabın kayıtlı dil tercihi. */
  accountLocale?: string | null;
  /** CDN/edge'in bildirdiği ülke kodu (ör. Vercel `x-vercel-ip-country`). */
  ipCountry?: string | null;
  /** `Accept-Language` başlığı. */
  acceptLanguage?: string | null;
}

export interface ResolvedMarket {
  market: Market;
  locale: Locale;
  currency: Currency;
  /** Kararın hangi sinyalden geldiği — log ve hata ayıklama için. */
  marketSource: 'explicit' | 'account' | 'ip' | 'fallback';
  localeSource: 'explicit' | 'account' | 'accept-language' | 'market-default';
}

/**
 * Pazarı ve dili çözer (madde 12).
 *
 * ÖNCELİK: açık seçim → hesap tercihi → IP ülkesi → güvenli varsayılan
 *
 * IP TEK BAŞINA YETERLİ DEĞİLDİR ve bilerek en sonda: VPN, kurumsal ağ,
 * mobil operatör yönlendirmesi ve seyahat, IP'yi düzenli olarak yanıltır.
 * Kullanıcı bir kez açıkça seçtiyse IP onu EZEMEZ -- aksi hâlde
 * Almanya'dan bakan Türk kullanıcı her sayfada geri fırlatılırdı.
 *
 * Desteklenmeyen bir ülkeden gelen ziyaretçi varsayılan pazara düşer;
 * ona "ülkenizde hizmet yok" demek yerine bir pazar göstermek, hiçbir şey
 * göstermemekten iyidir -- ama uydurma bir pazar da yaratılmaz.
 */
export function resolveMarket(signals: MarketSignals = {}): ResolvedMarket {
  let market: Market = DEFAULT_MARKET;
  let marketSource: ResolvedMarket['marketSource'] = 'fallback';

  const explicitMarket = normalizeMarket(signals.explicitMarket);
  const accountMarket = normalizeMarket(signals.accountMarket);
  // IP bir ÜLKE kodu verir, pazar kodu değil: eşlemeden geçmeli.
  const ipMarket = marketForCountry(signals.ipCountry);

  if (explicitMarket) {
    market = explicitMarket;
    marketSource = 'explicit';
  } else if (accountMarket) {
    market = accountMarket;
    marketSource = 'account';
  } else if (ipMarket) {
    market = ipMarket;
    marketSource = 'ip';
  }

  const config = MARKET_CONFIG[market];

  let locale: Locale = config.defaultLocale;
  let localeSource: ResolvedMarket['localeSource'] = 'market-default';

  const explicitLocale = normalizeLocale(signals.explicitLocale);
  const accountLocale = normalizeLocale(signals.accountLocale);

  if (explicitLocale) {
    locale = explicitLocale;
    localeSource = 'explicit';
  } else if (accountLocale) {
    locale = accountLocale;
    localeSource = 'account';
  } else {
    /*
     * Tarayıcının İLK tanıdığımız dili -- pazardan BAĞIMSIZ.
     *
     * Eskiden burada `config.locales.includes(l)` süzgeci vardı ve bu,
     * dosyanın başındaki ilkeyi ("dili pazara zincirleme") ihlal ediyordu:
     * Londra'daki Türk ziyaretçi Türkçe istiyor ama sterlin fiyat görmeli.
     * Süzgeç ikisini birbirine bağladığı için ona İngilizce sayfa
     * gösteriliyordu.
     *
     * Çevirisi olmayan dil burada ELENMEZ; o ayrı bir sorudur ve tek bir
     * yerde -- sunum katmanındaki `contentLocale` -- cevaplanır. Burada
     * elemek, "kullanıcı ne istedi" bilgisini geri dönülemez biçimde
     * kaybettirirdi: dil seçiciye ne göstereceğimizi de, hangi çevirinin
     * talep gördüğünü de bilemezdik.
     */
    const preferred = parseAcceptLanguage(signals.acceptLanguage);
    const match = preferred[0];
    if (match) {
      locale = match;
      localeSource = 'accept-language';
    }
  }

  return { market, locale, currency: config.currency, marketSource, localeSource };
}

/** Serbest metni bilinen bir pazara çevirir; tanınmazsa null. */
function normalizeMarket(value: string | null | undefined): Market | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return isMarket(upper) ? upper : null;
}

/** Serbest metni bilinen bir dile çevirir; tanınmazsa null. */
function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  // 'tr-TR' veya 'TR' de kabul edilir: bölge atılır, küçük harfe indirilir.
  const base = value.trim().toLowerCase().split('-')[0] ?? '';
  return isLocale(base) ? base : null;
}
