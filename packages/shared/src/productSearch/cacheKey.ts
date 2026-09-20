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
 * Bu yüzden anahtar, sonucu etkileyebilecek HER alanı sayar -- sağlayıcı
 * o alanı bugün tel üzerine yazmasa bile (bkz. `affiliateCom.ts` ->
 * `DOGRULANMAMIS_FILTRELER`). Sebep: filtre yarın gönderilmeye
 * başlandığında, önbellekte o günden kalma "filtresiz" sonuçlar
 * durmayacak. Fazladan alan saymanın bedeli birkaç ıskalanan isabettir;
 * eksik saymanın bedeli yanlış sonuçtur.
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
 */
const ANAHTAR_SURUMU = 'v1';

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
 * Bir arama isteğinin önbellek anahtarı.
 *
 * Biçim, gözle okunabilir olsun diye alan=değer çiftleri hâlinde:
 *   `urun-arama:v1:affiliate-com:q=oyuncu kulaklık:market=TR:...`
 *
 * Alan sırası SABİTTİR (nesne anahtar sırasına bırakılmaz): JavaScript'te
 * nesne sırası genelde ekleme sırasıdır ama buna dayanmak, çağıran taraf
 * alanları başka sırada verdiğinde iki farklı anahtar üretir.
 */
export function productSearchCacheKey(providerId: string, query: ProductSearchQuery): string {
  const alanlar: Array<[string, string]> = [
    ['q', normalizeSearchQuery(query.query)],
    ['market', (query.market ?? '').toUpperCase()],
    ['country', (query.country ?? '').toUpperCase()],
    ['currency', (query.currency ?? '').toUpperCase()],
    ['network', (query.network ?? '').toLowerCase()],
    ['merchant', (query.merchant ?? '').toLowerCase()],
    ['limit', String(query.limit ?? '')],
  ];

  const govde = alanlar.map(([ad, deger]) => `${ad}=${deger}`).join(':');

  return `urun-arama:${ANAHTAR_SURUMU}:${providerId}:${govde}`;
}
