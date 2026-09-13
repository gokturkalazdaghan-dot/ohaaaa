import { headers } from 'next/headers';

import {
  DEFAULT_LOCALE,
  MARKET_CONFIG,
  isTranslatedLocale,
  localeTag,
  resolveMarket,
  type Locale,
  type Market,
  type ResolvedMarket,
} from '@ohaaaa/shared';

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
function sunulacakDil(istenen: Locale, market: Market): Locale {
  if (isTranslated(istenen)) return istenen;

  const pazarDili = MARKET_CONFIG[market].defaultLocale;
  if (isTranslated(pazarDili)) return pazarDili;

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

  const resolved = resolveMarket({
    ipCountry: h.get('x-vercel-ip-country'),
    acceptLanguage: h.get('accept-language'),
  });

  const contentLocale = sunulacakDil(resolved.locale, resolved.market);

  return {
    ...resolved,
    contentLocale,
    contentTag: localeTag(contentLocale, resolved.market),
    untranslated: contentLocale !== resolved.locale,
  };
}

export type { Locale, Market };
