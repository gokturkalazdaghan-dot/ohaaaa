/**
 * PAZAR KATALOĞU — ülke, pazar, dil ve para biriminin VERİDEN gelen hâli.
 *
 * NEDEN VAR
 * `market.ts` bu kavramları kodda sabit listelerle taşıyordu: yeni bir ülke
 * eklemek `MARKETS`, `MARKET_CONFIG`, `COUNTRY_TO_MARKET` ve `LOCALE_TAGS`
 * dizilerini düzenleyip yeniden dağıtım yapmak demekti. Oysa veritabanı bu
 * bilgiyi zaten doğru modelliyor (`countries`, `markets`, `market_countries`,
 * `currencies`, `locales`). Kod, verinin ikinci bir kopyasıydı.
 *
 * Bu modül veriyi ALIR ve üzerinde saf fonksiyonlarla karar üretir. Kendisi
 * veritabanına BAĞLANMAZ: bağlantı çağırana ait. Böylece hem test edilebilir
 * kalıyor hem de paylaşılan paket sunucuya bağımlı olmuyor.
 *
 * DÖRT KAVRAM, DÖRT AYRI SINIR -- karıştırmak somut hata üretir:
 *
 *   country   → ISO 3166-1 ülke. Dilini ve sayı biçimini KENDİSİ taşır.
 *   market    → ticari bölge. Para birimi ÖNERİR, dil TAŞIMAZ.
 *   locale    → arayüz dili. Ülkeden gelir, pazardan değil.
 *   currency  → ödeme birimi. Pazardan ya da ülkeden gelir.
 *
 * Bir ülke BİRDEN FAZLA pazarda olabilir (İsveç hem EU hem NORDICS); bu
 * yüzden üyelik ayrı bir liste, ülke üzerinde tek bir alan değil.
 */

/** `countries` satırı. */
export interface UlkeKaydi {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** Ülkenin olağan para birimi. ÖNERİDİR; teklifin birimini belirlemez. */
  defaultCurrency: string;
  /** Ülkenin gerçek dili -- çevirisi olup olmadığından BAĞIMSIZ. */
  defaultLocale: string;
  /** Sayı/para biçimi için BCP-47 etiketi. Çeviri gerektirmez. */
  numberLocale: string;
  isActive: boolean;
}

/** `markets` satırı. */
export interface PazarKaydi {
  code: string;
  /**
   * Pazarın olağan para birimi. NULL SERBEST ve anlamlı: GCC altı ülkede
   * altı para birimi taşır, NORDICS beş ülkede dört. Birini seçip
   * varsayılan yazmak sessizce yanlış fiyat üretirdi.
   */
  defaultCurrency: string | null;
  isActive: boolean;
}

/** `market_countries` satırı — ÇOKLU üyelik. */
export interface PazarUlkesi {
  marketCode: string;
  countryCode: string;
}

export interface MarketKatalogu {
  markets: readonly PazarKaydi[];
  countries: readonly UlkeKaydi[];
  membership: readonly PazarUlkesi[];
}

/** Etkin pazar kodları, kararlı sırada. */
export function etkinPazarlar(katalog: MarketKatalogu): string[] {
  return katalog.markets
    .filter((m) => m.isActive)
    .map((m) => m.code)
    .sort();
}

/** Bir pazarın kapsadığı etkin ülkeler, kararlı sırada. */
export function pazarinUlkeleri(katalog: MarketKatalogu, marketCode: string): string[] {
  const etkin = new Set(katalog.countries.filter((u) => u.isActive).map((u) => u.code));
  return katalog.membership
    .filter((uy) => uy.marketCode === marketCode && etkin.has(uy.countryCode))
    .map((uy) => uy.countryCode)
    .sort();
}

export function ulkeKaydi(katalog: MarketKatalogu, countryCode: string): UlkeKaydi | null {
  const kod = countryCode.trim().toUpperCase();
  return katalog.countries.find((u) => u.code === kod && u.isActive) ?? null;
}

export function pazarKaydi(katalog: MarketKatalogu, marketCode: string): PazarKaydi | null {
  const kod = marketCode.trim().toUpperCase();
  return katalog.markets.find((m) => m.code === kod && m.isActive) ?? null;
}

/**
 * Bir ülkenin pazarı.
 *
 * ÇOKLU ÜYELİK BİR SEÇİM GEREKTİRİR ve bu seçim KARARLI olmalı: İsveç hem
 * `EU` hem `NORDICS` üyesi, ama ziyaretçiye tek bir para birimi ve tek bir
 * teklif kümesi gösterilecek. Sıra bilinçli:
 *
 *   1. Kodu ülkeyle AYNI olan pazar (`TR` ülkesi → `TR` pazarı). Ülkeye özel
 *      pazar varsa bölgesel olandan her zaman daha doğrudur.
 *   2. Para birimi ülkeninkiyle UYUŞAN pazar. İsveç'i (SEK) euro pazarına
 *      koymak ona yanlış birimde fiyat göstermek olurdu.
 *   3. EN AZ ülke kapsayan pazar -- yani en özgül olan.
 *   4. Alfabetik. Üçü de ayırmıyorsa karar yine de belirlenimci kalsın.
 *
 * Hiçbir pazara üye değilse `null`. UYDURMA PAZAR AÇILMAZ: çağıran taraf
 * varsayılana düşer, bu yanlış para birimi göstermekten iyidir.
 */
export function ulkeninPazari(katalog: MarketKatalogu, countryCode: string): string | null {
  const ulke = ulkeKaydi(katalog, countryCode);
  if (!ulke) return null;

  const adaylar = katalog.membership
    .filter((uy) => uy.countryCode === ulke.code)
    .map((uy) => pazarKaydi(katalog, uy.marketCode))
    .filter((m): m is PazarKaydi => m !== null);

  if (adaylar.length === 0) return null;

  const kapsam = new Map<string, number>();
  for (const aday of adaylar) {
    kapsam.set(aday.code, pazarinUlkeleri(katalog, aday.code).length);
  }

  const sirali = [...adaylar].sort((a, b) => {
    const aKendi = a.code === ulke.code ? 0 : 1;
    const bKendi = b.code === ulke.code ? 0 : 1;
    if (aKendi !== bKendi) return aKendi - bKendi;

    const aPara = a.defaultCurrency === ulke.defaultCurrency ? 0 : 1;
    const bPara = b.defaultCurrency === ulke.defaultCurrency ? 0 : 1;
    if (aPara !== bPara) return aPara - bPara;

    const aKapsam = kapsam.get(a.code) ?? Number.MAX_SAFE_INTEGER;
    const bKapsam = kapsam.get(b.code) ?? Number.MAX_SAFE_INTEGER;
    if (aKapsam !== bKapsam) return aKapsam - bKapsam;

    return a.code.localeCompare(b.code);
  });

  return sirali[0]?.code ?? null;
}

/**
 * Bir pazarın para birimi.
 *
 * Pazarın kendi varsayılanı yoksa (GCC, NORDICS, ANZ) ülkeden gelir --
 * `countryCode` verilmişse. İkisi de yoksa `null`: tahmin ÜRETİLMEZ, çünkü
 * yanlış para biriminde fiyat göstermek, fiyat göstermemekten kötüdür.
 */
export function pazarinParaBirimi(
  katalog: MarketKatalogu,
  marketCode: string,
  countryCode?: string | null,
): string | null {
  const pazar = pazarKaydi(katalog, marketCode);
  if (pazar?.defaultCurrency) return pazar.defaultCurrency;

  if (countryCode) {
    const ulke = ulkeKaydi(katalog, countryCode);
    if (ulke) return ulke.defaultCurrency;
  }

  return null;
}

/**
 * Bir pazarda sayı/para biçimi için kullanılacak BCP-47 etiketi.
 *
 * Pazarın kendi etiketi YOKTUR -- biçim ülkenin özelliğidir. Pazar birden
 * çok ülke kapsıyorsa ve hangi ülkede olduğumuzu bilmiyorsak, para birimi
 * uyuşan ilk ülkenin biçimi kullanılır; o da yoksa ilk ülke. Böylece EU
 * pazarında euro biçimi, GCC'de ilgili körfez ülkesinin biçimi çıkar.
 */
export function pazarinSayiBicimi(
  katalog: MarketKatalogu,
  marketCode: string,
  countryCode?: string | null,
): string | null {
  if (countryCode) {
    const ulke = ulkeKaydi(katalog, countryCode);
    if (ulke) return ulke.numberLocale;
  }

  const pazar = pazarKaydi(katalog, marketCode);
  const ulkeler = pazarinUlkeleri(katalog, marketCode)
    .map((kod) => ulkeKaydi(katalog, kod))
    .filter((u): u is UlkeKaydi => u !== null);

  if (ulkeler.length === 0) return null;

  const paraUyan = pazar?.defaultCurrency
    ? ulkeler.find((u) => u.defaultCurrency === pazar.defaultCurrency)
    : undefined;

  return (paraUyan ?? ulkeler[0])!.numberLocale;
}

/** Katalogda o pazar var mı (ve etkin mi). */
export function pazarTaniniyor(katalog: MarketKatalogu, value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  return pazarKaydi(katalog, value) !== null;
}

/** Boş katalog — veri okunamadığında çağıranın yedeğe düşmesi için. */
export const BOS_KATALOG: MarketKatalogu = {
  markets: [],
  countries: [],
  membership: [],
};
