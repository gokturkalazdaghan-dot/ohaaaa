/**
 * PAZAR KATALOĞUNUN VERİTABANINDAN OKUNMASI.
 *
 * `packages/shared/src/marketCatalog.ts` kararları üretir ama veriye
 * BAĞLANMAZ -- bağlantı burada. Bu ayrım bilinçli: paylaşılan paket hem
 * tarayıcıda hem sunucuda, hem de veritabanı olmadan test edilebilir kalıyor.
 *
 * YENİ ÜLKE EKLEMEK KOD DEĞİŞİKLİĞİ GEREKTİRMEZ. `countries`,
 * `markets` ve `market_countries` tablolarına satır eklendiğinde bu okuma
 * onları kendiliğinden görür. TypeScript tarafında değiştirilecek hiçbir
 * liste yok -- `Market` artık `string`, `Currency` gibi.
 *
 * OKUNAMAZSA YEDEĞE DÜŞÜLÜR, UYDURULMAZ. Katalog gelmezse `market.ts`
 * içindeki sabit yapılandırma devreye girer; site pazarsız kalmaz. Bu bir
 * gerileme değil bilinçli bir kademe: bugünkü davranışın ta kendisi.
 */

import {
  BOS_KATALOG,
  type MarketKatalogu,
  type PazarKaydi,
  type PazarUlkesi,
  type UlkeKaydi,
} from '@ohaaaa/shared';

import { createAnonClient } from '@/lib/supabase/anon';

import { onbellekle, ONBELLEK } from './onbellek';

async function pazarKatalogunuOku(): Promise<MarketKatalogu> {
  const supabase = createAnonClient();
  if (!supabase) return BOS_KATALOG;

  /*
   * ÜÇ SORGU PARALEL. Aralarında bağımlılık yok ve üçü de küçük referans
   * tablosu; sıralı gitmek gecikmeyi üçe katlardı.
   */
  const [pazarCevabi, ulkeCevabi, uyelikCevabi] = await Promise.all([
    supabase.from('markets').select('code, default_currency, is_active'),
    supabase
      .from('countries')
      .select('code, default_currency, default_locale, number_locale, is_active'),
    supabase.from('market_countries').select('market_code, country_code'),
  ]);

  const hata = pazarCevabi.error ?? ulkeCevabi.error ?? uyelikCevabi.error;
  if (hata) {
    /*
     * KISMİ KATALOG DÖNDÜRÜLMEZ. Ülkeler gelip üyelikler gelmezse her ülke
     * "hiçbir pazara ait değil" görünürdü ve bütün ziyaretçiler sessizce
     * varsayılan pazara düşerdi -- yanlış para birimiyle. Boş katalog,
     * çağıranı açıkça yedeğe gönderir.
     */
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Pazar katalogu okunamadi; sabit yedek yapilandirma kullanilacak',
        hata: hata.message,
      }),
    );
    return BOS_KATALOG;
  }

  const markets: PazarKaydi[] = (pazarCevabi.data ?? []).map((satir) => ({
    code: String(satir.code),
    defaultCurrency: satir.default_currency ? String(satir.default_currency) : null,
    isActive: satir.is_active !== false,
  }));

  const countries: UlkeKaydi[] = (ulkeCevabi.data ?? []).map((satir) => ({
    code: String(satir.code),
    defaultCurrency: String(satir.default_currency),
    defaultLocale: String(satir.default_locale),
    numberLocale: String(satir.number_locale),
    isActive: satir.is_active !== false,
  }));

  const membership: PazarUlkesi[] = (uyelikCevabi.data ?? []).map((satir) => ({
    marketCode: String(satir.market_code),
    countryCode: String(satir.country_code),
  }));

  return { markets, countries, membership };
}

/**
 * Önbellek süresi UZUN ve bu bilinçli: taksonomi gibi, pazar tanımları da
 * göçle değişir, beslemeyle değil. Yeni bir ülke eklendiğinde en geç bir
 * saat içinde görünür.
 */
export const pazarKatalogu = onbellekle(
  'pazar-katalogu',
  pazarKatalogunuOku,
  ONBELLEK.taksonomi,
);
