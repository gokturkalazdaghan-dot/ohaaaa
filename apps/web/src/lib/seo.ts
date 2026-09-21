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

import { headers } from 'next/headers';

import {
  dilAlternatifleri,
  kanonikYol,
  DEFAULT_LOCALE,
  DEFAULT_MARKET,
  pazarinUlkeleri,
  ulkeKaydi,
  type AlternatifGirdisi,
  type MarketKatalogu,
  type YolDili,
} from '@ohaaaa/shared';

import { getServedMarkets } from '@/data/catalog';
import { pazarKatalogu } from '@/data/markets';
import { siteUrl } from '@/lib/env';
import { isTranslated } from '@/lib/locale';
import { ADRES_DILI_BASLIGI, ADRES_PAZARI_BASLIGI } from '@/middleware';

const VARSAYILAN = { locale: DEFAULT_LOCALE, market: DEFAULT_MARKET };

/**
 * Çevirisi olmayan pazarların sunulduğu dil.
 *
 * İngilizce seçildi çünkü en geniş ikinci dil ve sözlüğü tam. Varsayılan
 * dil (Türkçe) YEDEK OLAMAZ: Polonya'daki bir ziyaretçiye Türkçe sayfa
 * göstermek, hiç göstermemekten iyi değil.
 */
const DEFAULT_YEDEK_DIL = 'en';

/**
 * Katalogdan, GERÇEKTEN sunulan dil-pazar ikililerini çıkarır.
 *
 * Her pazar için o pazarın ülkelerinin dilleri denenir; çevirisi olan her
 * dil bir varyant üretir. `hreflang` ÜLKE kodu ister -- pazar kodu değil
 * (Britanya: pazar `UK`, ülke `GB`), o yüzden ülke de taşınıyor.
 */
function sunulanVaryantlar(
  katalog: MarketKatalogu,
  sunulanPazarlar: ReadonlySet<string>,
): AlternatifGirdisi[] {
  const cikti: AlternatifGirdisi[] = [];

  for (const pazar of katalog.markets) {
    if (!pazar.isActive) continue;

    /*
     * ÜRÜN TAŞIMADIĞIMIZ PAZAR İLAN EDİLMEZ.
     *
     * Ölçüldü: `hreflang` altı pazar bildiriyordu (en-US, en-CA, en-IE,
     * en-EU, en-ANZ, en-GB) ama ürün yalnızca UK'deydi. Arama motoruna
     * beş boş vitrin göstermek ince içerik sinyalidir ve gerçek olan tek
     * vitrini de zayıflatır.
     *
     * Küme boşsa (okuma hatası) eleme YAPILMAZ: geçici bir arıza bütün
     * dil haritasını silmemeli.
     *
     * Varsayılan pazar her zaman kalır -- kanonik ve `x-default` ona
     * bağlı; onu elemek sayfayı kendi kanonik adresinden koparırdı.
     */
    if (
      sunulanPazarlar.size > 0 &&
      pazar.code !== DEFAULT_MARKET &&
      !sunulanPazarlar.has(pazar.code)
    ) {
      continue;
    }

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

    const cevrilenler = [...diller].filter((d) => isTranslated(d as never));

    /*
     * ÇEVİRİSİ OLMAYAN PAZAR İNGİLİZCE SUNULUR.
     *
     * ÖLÇÜLEN ARIZA: Polonya'da 1.494 aktif ürün vardı ve `hreflang`de
     * HİÇ görünmüyordu. Sebep SEO ayarı değil: `countries.PL.default_locale`
     * = 'pl' ve Lehçe sözlüğümüz yok, dolayısıyla pazar bütünüyle eleniyordu.
     *
     * Ürünü olan bir pazarı "dilini konuşamıyoruz" diye hiç sunmamak,
     * o ürünleri arama motorundan tamamen saklamak demek. İngilizce
     * sunmak dürüst bir ara çözüm: `hreflang="en-PL"` tam olarak
     * "Polonya için İngilizce içerik" der -- uydurma değil, eksik olanı
     * açıkça bildiren bir sinyal.
     *
     * Lehçe sözlük eklendiği gün `cevrilenler` kendiliğinden dolar ve bu
     * yedek devreden çıkar; burada değişecek bir şey yok.
     */
    const kullanilacak = cevrilenler.length > 0 ? cevrilenler : [DEFAULT_YEDEK_DIL];

    for (const dil of kullanilacak) {
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
 * Adresteki dil öneki -- middleware'in yazdığı başlıklardan.
 *
 * Sayfa kendi yolunu bilir ama önekini bilmez: `next.config` yeniden
 * yazması öneki yoldan SİLDİĞİ için sayfa bileşeni `/kategori/x` görür.
 * Öneki tek bilen middleware'dir, o yüzden başlıktan okunuyor.
 */
async function adrestekiIkili(): Promise<YolDili | null> {
  const h = await headers();
  const dil = h.get(ADRES_DILI_BASLIGI);
  const pazar = h.get(ADRES_PAZARI_BASLIGI);
  if (!dil || !pazar) return null;
  return { locale: dil, market: pazar };
}

/** Yolu mutlak adrese çevirir; kök için sondaki eğik çizgi yazılmaz. */
function mutlak(kok: string, yol: string): string {
  return yol === '/' ? kok : `${kok}${yol}`;
}

/**
 * Bir sayfa yolu için kanonik adres ve dil alternatifleri.
 *
 * `kalan`, dil öneki OLMAYAN yoldur (`/kategori/telefon`). Sayfa kendi
 * yolunu zaten bilir; başlıktan okumaya gerek yok.
 *
 * Katalog okunamazsa alternatif ÜRETİLMEZ ve kanonik varsayılana düşer:
 * yanlış bir dil haritası yayımlamaktansa hiç yayımlamamak doğrudur.
 */
export async function dilMetaVerisi(kalan: string): Promise<DilMetaVerisi> {
  const kok = siteUrl.replace(/\/+$/, '');

  const [katalog, sunulan] = await Promise.all([
    pazarKatalogu().catch(() => null),
    getServedMarkets().catch(() => [] as string[]),
  ]);
  const varyantlar = katalog
    ? sunulanVaryantlar(katalog, new Set(sunulan))
    : [];
  const secim = await adrestekiIkili();

  const canonical = mutlak(kok, kanonikYol(kalan, secim, VARSAYILAN, varyantlar));

  if (varyantlar.length === 0) return { canonical, languages: {} };

  const alternatifler = dilAlternatifleri(kalan, varyantlar, VARSAYILAN, kok);

  const languages: Record<string, string> = {};
  for (const a of alternatifler) languages[a.hreflang] = a.href;

  return { canonical, languages };
}
