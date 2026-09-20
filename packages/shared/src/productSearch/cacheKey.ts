/**
 * Talep-anı arama önbelleğinin ANAHTARI.
 *
 * ======================================================================
 * ANAHTAR DETERMİNİSTİK OLMAK ZORUNDA
 * ======================================================================
 * Aynı arama iki kez yapıldığında aynı anahtar çıkmazsa önbellek hiç
 * tutmaz: her istek sağlayıcıya gider, hız sınırı yenir ve ortak
 * şartlarının sınırına boşuna yaklaşılır. Tersi daha da kötüdür: FARKLI
 * aramalar aynı anahtara düşerse bir kullanıcıya başka bir sorgunun
 * sonucu gösterilir.
 *
 * Bu yüzden anahtar, isteğe giren HER alanı sayar: sorgu metni, para
 * birimi kümesi, ağ/satıcı kimlikleri, havuz ve sayfalama. Fazladan alan
 * saymanın bedeli birkaç ıskalanan isabettir; eksik saymanın bedeli
 * yanlış sonuçtur.
 *
 * ======================================================================
 * ANAHTAR SIR TAŞIMAZ
 * ======================================================================
 * İçinde yalnızca kullanıcının yazdığı metin ve pazar bilgisi vardır. API
 * anahtarı anahtara GİRMEZ: önbellek anahtarları günlüklere ve hata ayıklama
 * çıktılarına düşer.
 */

import type { ProductSearchQuery } from './types.js';

/**
 * ANAHTAR SÜRÜMÜ -- NORMALİZASYON KURALI DEĞİŞİRSE ARTIRIN.
 *
 * Aynı gerekçe `apps/web/src/data/onbellek.ts` içindeki `KATALOG_SURUMU`
 * ile aynı: kural değiştiğinde eski girdiler öksüz kalmalı, yeni kuralla
 * çakışmamalı.
 *
 * v1 -> v2: sorgu modeli resmî sözleşmeye göre değişti. `market` ve
 *           `country` alanları kalktı (sözleşmede yoklar; `country`
 *           ürünün MENŞE ülkesiydi, pazar değil), yerlerine para birimi
 *           kümesi + ağ/satıcı/havuz kimlikleri geldi. Eski anahtarlar
 *           artık başka bir isteği tarif ettiği için öksüz bırakıldı.
 */
const ANAHTAR_SURUMU = 'v2';

/**
 * Sorgu metnini önbellek için normalize eder.
 *
 * ÜÇ ADIM, HEPSİ GERİ DÖNÜŞSÜZ VE BİLEREK BASİT:
 *   1. Kırpma
 *   2. Ardışık boşlukları teke indirme  ("oyuncu   kulaklık" = "oyuncu kulaklık")
 *   3. Küçük harfe indirme
 *
 * AGRESİF NORMALİZASYON YAPILMAZ. Türkçe karakterleri ASCII'ye çevirmek
 * ("kulaklık" -> "kulaklik") daha çok isabet verirdi ama iki ayrı sorguyu
 * birleştirir; sağlayıcıya giden metin ile önbellek anahtarı ayrışır ve
 * kullanıcı yazdığından başka bir aramanın sonucunu görebilir.
 *
 * `toLowerCase` yerel ayardan BAĞIMSIZ çağrılır: aynı metnin sunucunun
 * diline göre farklı anahtar üretmesi, tam olarak kaçındığımız şeydir.
 */
export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Küme alanlarını SIRALAYIP birleştirir.
 *
 * `[3, 1]` ile `[1, 3]` AYNI aramadır -- sözleşmede bu değerler `||` ile
 * VEYA'lanıyor, yani sıra sonucu değiştirmiyor. Sıralamadan anahtara
 * yazmak, aynı aramaya iki ayrı önbellek girdisi açardı.
 */
function kume(degerler: ReadonlyArray<string | number> | undefined): string {
  if (!degerler || degerler.length === 0) return '';

  return [...new Set(degerler.map((d) => String(d).trim()).filter((d) => d !== ''))]
    .sort()
    .join(',');
}

/**
 * Bir arama isteğinin önbellek anahtarı.
 *
 * Biçim, gözle okunabilir olsun diye alan=değer çiftleri hâlinde:
 *   `urun-arama:v2:affiliate-com:q=oyuncu kulaklık:cur=TRY:net=12,34:...`
 *
 * Alan sırası SABİTTİR (nesne anahtar sırasına bırakılmaz): JavaScript'te
 * nesne sırası genelde ekleme sırasıdır ama buna dayanmak, çağıran taraf
 * alanları başka sırada verdiğinde iki farklı anahtar üretir.
 */
export function productSearchCacheKey(providerId: string, query: ProductSearchQuery): string {
  const alanlar: Array<[string, string]> = [
    ['q', normalizeSearchQuery(query.query)],
    ['cur', kume(query.currencies?.map((c) => c.toUpperCase()))],
    ['net', kume(query.networkIds)],
    ['mer', kume(query.merchantIds)],
    ['pool', (query.poolId ?? '').trim()],
    ['per', String(query.perPage ?? '')],
    ['page', String(query.page ?? '')],
  ];

  const govde = alanlar.map(([ad, deger]) => `${ad}=${deger}`).join(':');

  return `urun-arama:${ANAHTAR_SURUMU}:${providerId}:${govde}`;
}
