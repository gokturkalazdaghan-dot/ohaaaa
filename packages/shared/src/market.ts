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

/** Faaliyet gösterilen pazarlar (ISO 3166-1 alpha-2). */
export const MARKETS = ['TR', 'DE', 'US'] as const;
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
  /** Bu pazarda konuşulan/desteklenen diller. */
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
  DE: {
    code: 'DE',
    currency: 'EUR',
    defaultLocale: 'de',
    numberLocale: 'de-DE',
    /*
     * Almanya'da Türkçe DE BİR PAZAR DİLİDİR. Bu bir nezaket değil,
     * ölçülebilir bir gerçek: Almanya'daki en büyük göçmen topluluğu
     * Türkçe konuşuyor ve Ohaaaa'nın ilk doğal kitlesi tam olarak orada.
     */
    locales: ['de', 'tr', 'en'],
  },
  US: {
    code: 'US',
    currency: 'USD',
    defaultLocale: 'en',
    numberLocale: 'en-US',
    locales: ['en'],
  },
};

/** BCP-47 dil etiketi — `<html lang>` ve sesli arama için. */
const LOCALE_TAGS: Record<Locale, Record<string, string>> = {
  tr: { TR: 'tr-TR', DE: 'tr-TR', US: 'tr-TR' },
  de: { TR: 'de-DE', DE: 'de-DE', US: 'de-DE' },
  en: { TR: 'en-GB', DE: 'en-GB', US: 'en-US' },
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
  const ipMarket = normalizeMarket(signals.ipCountry);

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
     * Tarayıcı dilleri arasından bu PAZARDA desteklenen ilkini seçeriz.
     * Pazarda desteklenmeyen bir dile düşmek, çevirisi olmayan bir sayfa
     * göstermek demektir.
     */
    const preferred = parseAcceptLanguage(signals.acceptLanguage);
    const match = preferred.find((l) => config.locales.includes(l));
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
