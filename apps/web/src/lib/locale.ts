import { headers } from 'next/headers';

import {
  BOS_KATALOG,
  DEFAULT_LOCALE,
  MARKET_CONFIG,
  isLocale,
  isTranslatedLocale,
  localeTag,
  pazarinUlkeleri,
  resolveMarket,
  ulkeKaydi,
  type Locale,
  type Market,
  type MarketKatalogu,
  type ResolvedMarket,
} from '@ohaaaa/shared';

import { pazarKatalogu } from '@/data/markets';
import { ADRES_DILI_BASLIGI, ADRES_PAZARI_BASLIGI } from '@/middleware';

/**
 * İstek başına dil ve pazar çözümlemesi (madde 12–14).
 *
 * ÇEVİRİSİ OLMAYAN DİL İLAN EDİLMEZ
 * `resolveMarket` kullanıcının Almanca istediğini doğru şekilde tespit
 * edebilir. Ama arayüz metinleri henüz yalnızca Türkçe. `<html lang="de">`
 * yazıp Türkçe metin sunmak iki somut zarar üretir:
 *
 *   1) Ekran okuyucu Türkçe cümleleri Almanca fonetikle okur — sayfayı
 *      duyan kullanıcı için anlaşılmaz hâle gelir.
 *   2) Arama motoruna sayfanın Almanca olduğu bildirilir; Almanca
 *      sorgularda Türkçe bir sayfa çıkar ve sıralama cezası alınır.
 *
 * Bu yüzden İKİ AYRI kavram var:
 *
 *   resolved.locale  → kullanıcının İSTEDİĞİ dil (tercih, ölçüm, yönlendirme)
 *   contentLocale    → gerçekten SUNDUĞUMUZ dil (`<html lang>`, sesli arama)
 *
 * Bir dilin çevirisi tamamlandığında `TRANSLATED` listesine eklenir ve
 * o dil kendiliğinden yayına girer. Liste, "hangi dilleri gerçekten
 * konuşuyoruz" sorusunun tek dürüst cevabıdır.
 */
/*
 * ÇEVİRİSİ OLAN DİLLER ARTIK SÖZLÜKTEN OKUNUYOR, ELLE YAZILMIYOR.
 *
 * Önceki hâli sabit `['tr']` idi. Sabit liste ile gerçek sözlükler ayrı iki
 * yer olduğu için biri güncellenip diğeri unutulabilirdi: İngilizce sözlük
 * eklenir ama liste 'tr' kalırsa, çeviri var olduğu hâlde HİÇ gösterilmez --
 * ve bunu kimse fark etmez.
 *
 * `isTranslatedLocale` doğrudan `messages/` altındaki sözlüklerden türüyor,
 * yani soru "bu dilin metinleri gerçekten var mı" sorusuna veriyle cevap
 * veriyor.
 */

export interface RequestLocale extends ResolvedMarket {
  /** Sayfanın GERÇEKTEN sunulduğu dil. */
  contentLocale: Locale;
  /** `<html lang>` ve `SpeechRecognition.lang` için BCP-47 etiketi. */
  contentTag: string;
  /** İstenen dil sunulamıyor mu? (çeviri bekleyen ziyaretçi) */
  untranslated: boolean;
}

/** Bir dilin çevirisi hazır mı? */
export function isTranslated(locale: Locale): boolean {
  return isTranslatedLocale(locale);
}

/**
 * Veritabanından gelen SERBEST dil kodunu daraltır.
 *
 * `countries.default_locale` her ISO dil kodunu taşıyabilir ('ar', 'fr',
 * 'pl'...) -- çevirisi olup olmadığından bağımsız, çünkü ülkenin gerçek
 * dilidir. Arayüzde kullanılabilmesi için İKİ koşul birden gerekir:
 * bilinen bir dil olmalı VE sözlüğü bulunmalı. İkisini ayrı ayrı sormak,
 * "Arapça ülke dili ama henüz çevirimiz yok" durumunu doğru ifade eder.
 */
function cevirisiVarMi(kod: string): kod is Locale {
  return isLocale(kod) && isTranslatedLocale(kod);
}

/**
 * İSTENEN dilden SUNULACAK dile.
 *
 * Çevirisi olmayan bir dil istendiğinde nereye düşeceğimiz önemsiz bir
 * ayrıntı değil. Önceki hâli her durumda Türkçeye düşüyordu; bu, Londra'dan
 * Almanca tarayıcıyla gelen ziyaretçiye TÜRKÇE sayfa göstermek demekti --
 * ona en yakın dil açık biçimde İngilizceyken.
 *
 * Sıra: istenen dil → PAZARIN varsayılan dili → genel varsayılan. Pazarın
 * varsayılanı, "bu ülkedeki bir ziyaretçi büyük olasılıkla hangi dili
 * okuyabilir" sorusunun zaten verilmiş cevabıdır.
 */
function sunulacakDil(
  istenen: Locale,
  market: Market,
  katalog?: MarketKatalogu,
): Locale {
  if (isTranslated(istenen)) return istenen;

  /*
   * `Market` artık veri güdümlü bir `string`; yedek yapılandırmada
   * olmayan bir pazar kodu gelebilir. O durumda pazar dili bilinmiyor
   * demektir ve genel varsayılana düşülür -- uydurma yapılmaz.
   */
  /*
   * KATALOG VARSA DİL ÜLKEDEN GELİR. Pazar dil TAŞIMAZ (şema da öyle
   * diyor: `markets` tablosunda `default_locale` sütunu bilerek yok).
   * Pazarın kapsadığı ülkelerin varsayılan dilleri sırayla denenir;
   * çevirisi olan ilki sunulur. Böylece `GCC` açıldığında Arapça çevirisi
   * geldiği anda kod değişmeden devreye girer.
   */
  if (katalog) {
    for (const ulkeKodu of pazarinUlkeleri(katalog, market)) {
      const ulke = ulkeKaydi(katalog, ulkeKodu);
      if (ulke && cevirisiVarMi(ulke.defaultLocale)) return ulke.defaultLocale;
    }
  }

  const pazarDili = MARKET_CONFIG[market]?.defaultLocale;
  if (pazarDili && isTranslated(pazarDili)) return pazarDili;

  return DEFAULT_LOCALE;
}

/**
 * İstek başlıklarından pazarı ve dili çözer.
 *
 * Vercel `x-vercel-ip-country` başlığını ekler; yerelde yoktur ve bu
 * sorun değil — IP zaten önceliğin en altındadır.
 */
export async function getRequestLocale(): Promise<RequestLocale> {
  const h = await headers();

  /*
   * Katalog okunamazsa BOŞ gelir ve `resolveMarket` sabit yedeğe düşer --
   * yani bugünkü davranış. Pazar/dil çözümlemesi veritabanına BAĞIMLI
   * DEĞİL, ondan BESLENİYOR.
   */
  const katalog = await pazarKatalogu().catch(() => BOS_KATALOG);
  const katalogVar = katalog.markets.length > 0;
  const ipCountry = h.get('x-vercel-ip-country');

  /*
   * ADRESTEKİ SEÇİM IP TAHMİNİNİ EZER.
   *
   * `resolveMarket` bu alanları en baştan destekliyordu ama hiçbir çağıran
   * doldurmuyordu -- yani açık seçim ÖLÜ bir yetenekti ve dil her zaman
   * IP'den tahmin ediliyordu. Önek artık middleware tarafından başlığa
   * yazıldığı için `/en-gb/...` adresini açan ziyaretçi, nereden bakarsa
   * baksın İngilizce ve sterlin görüyor.
   */
  const resolved = resolveMarket(
    {
      explicitLocale: h.get(ADRES_DILI_BASLIGI),
      explicitMarket: h.get(ADRES_PAZARI_BASLIGI),
      ipCountry,
      acceptLanguage: h.get('accept-language'),
    },
    katalogVar ? katalog : undefined,
  );

  const contentLocale = sunulacakDil(
    resolved.locale,
    resolved.market,
    katalogVar ? katalog : undefined,
  );

  return {
    ...resolved,
    contentLocale,
    /*
     * BÖLGE KODU YALNIZCA PAZAR IP'DEN GELDİYSE IP ÜLKESİNDEN ALINIR.
     *
     * Ölçülen hata: `/en-gb` adresini ABD IP'siyle açan ziyaretçi
     * `lang="en-US"` alıyordu; `/tr-uk` ise `lang="tr-US"`. Dil ezmesi
     * çalışıyordu ama pazar ezmesi çalışmıyordu, çünkü `ipCountry`
     * koşulsuz geçiliyordu ve katalog ülke verildiğinde pazarı tamamen
     * yok sayıyor.
     *
     * Kullanıcı pazarı AÇIKÇA seçtiyse (adresten) ya da hesabından
     * geliyorsa, bölge o pazardan türemeli -- IP'den değil. IP yalnızca
     * pazarı zaten IP belirlediğinde bölgeyi de belirleyebilir; o durumda
     * ikisi tutarlıdır ve ülke, pazardan daha özgül bilgi taşır.
     */
    contentTag: localeTag(
      contentLocale,
      resolved.market,
      katalogVar ? katalog : undefined,
      resolved.marketSource === 'ip' ? ipCountry : null,
    ),
    untranslated: contentLocale !== resolved.locale,
  };
}

export type { Locale, Market };
