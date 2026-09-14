/**
 * ÇOK PAZARLI SEO META VERİSİ.
 *
 * `hreflang`, bir sayfanın başka dillerdeki KARŞILIKLARINI bildirir. İki
 * koşulu birden sağlamayan hiçbir varyant buraya yazılmaz:
 *
 *   1. Pazar gerçekten AÇIK olmalı (`markets.is_active`).
 *   2. Dilin ÇEVİRİSİ gerçekten olmalı.
 *
 * İkincisi burada asıl kısıt. `countries.default_locale` Arapça diyebilir
 * ama sözlüğümüz yoksa `/ar-ae/` adresi Türkçe ya da İngilizce içerik
 * döndürür. Onu `hreflang="ar-AE"` diye bildirmek arama motoruna YANLIŞ
 * söylemektir: kullanıcı Arapça beklediği bir sonuca tıklar, Türkçe sayfa
 * bulur. Bildirdiğimiz her varyant, gerçekten sunduğumuz bir varyanttır.
 */

import {
  dilAlternatifleri,
  DEFAULT_LOCALE,
  DEFAULT_MARKET,
  pazarinUlkeleri,
  ulkeKaydi,
  type AlternatifGirdisi,
  type MarketKatalogu,
} from '@ohaaaa/shared';

import { pazarKatalogu } from '@/data/markets';
import { siteUrl } from '@/lib/env';
import { isTranslated } from '@/lib/locale';

const VARSAYILAN = { locale: DEFAULT_LOCALE, market: DEFAULT_MARKET };

/**
 * Katalogdan, GERÇEKTEN sunulan dil-pazar ikililerini çıkarır.
 *
 * Her pazar için o pazarın ülkelerinin dilleri denenir; çevirisi olan her
 * dil bir varyant üretir. `hreflang` ÜLKE kodu ister -- pazar kodu değil
 * (Britanya: pazar `UK`, ülke `GB`), o yüzden ülke de taşınıyor.
 */
function sunulanVaryantlar(katalog: MarketKatalogu): AlternatifGirdisi[] {
  const cikti: AlternatifGirdisi[] = [];

  for (const pazar of katalog.markets) {
    if (!pazar.isActive) continue;

    const ulkeler = pazarinUlkeleri(katalog, pazar.code);
    /*
     * Pazarın hreflang ülkesi: kodu pazarla aynı olan ülke varsa o,
     * yoksa ilk ülke. Bölgesel pazarda (EU) tek bir ülke seçmek zorundayız
     * -- hreflang bölge kodu kabul etmez.
     */
    const temsilci = ulkeler.find((k) => k === pazar.code) ?? ulkeler[0];
    if (!temsilci) continue;

    const diller = new Set<string>();
    for (const kod of ulkeler) {
      const ulke = ulkeKaydi(katalog, kod);
      if (ulke) diller.add(ulke.defaultLocale);
    }

    for (const dil of diller) {
      if (!isTranslated(dil as never)) continue;
      cikti.push({ locale: dil, market: pazar.code, countryCode: temsilci });
    }
  }

  return cikti;
}

export interface DilMetaVerisi {
  canonical: string;
  languages: Record<string, string>;
}

/**
 * Bir sayfa yolu için kanonik adres ve dil alternatifleri.
 *
 * `kalan`, dil öneki OLMAYAN yoldur (`/kategori/telefon`). Sayfa kendi
 * yolunu zaten bilir; başlıktan okumaya gerek yok.
 *
 * Katalog okunamazsa alternatif ÜRETİLMEZ, yalnızca kanonik döner: yanlış
 * bir dil haritası yayımlamaktansa hiç yayımlamamak doğrudur.
 */
export async function dilMetaVerisi(kalan: string): Promise<DilMetaVerisi> {
  const kok = siteUrl.replace(/\/+$/, '');
  const canonical = `${kok}${kalan === '/' ? '' : kalan}` || kok;

  const katalog = await pazarKatalogu().catch(() => null);
  if (!katalog || katalog.markets.length === 0) {
    return { canonical, languages: {} };
  }

  const alternatifler = dilAlternatifleri(kalan, sunulanVaryantlar(katalog), VARSAYILAN, kok);

  const languages: Record<string, string> = {};
  for (const a of alternatifler) languages[a.hreflang] = a.href;

  return { canonical, languages };
}
