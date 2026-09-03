import { headers } from 'next/headers';

import {
  DEFAULT_LOCALE,
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
const TRANSLATED: readonly Locale[] = ['tr'];

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
  return TRANSLATED.includes(locale);
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

  const contentLocale = isTranslated(resolved.locale) ? resolved.locale : DEFAULT_LOCALE;

  return {
    ...resolved,
    contentLocale,
    contentTag: localeTag(contentLocale, resolved.market),
    untranslated: contentLocale !== resolved.locale,
  };
}

export type { Locale, Market };
