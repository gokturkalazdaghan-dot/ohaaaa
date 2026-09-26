import assert from 'node:assert/strict';
import test from 'node:test';

import { uygulanacakPazar } from './pazarSuzgeci.js';

/*
 * Bu testler bir uygulama ayrıntısını değil, SİTENİN AYAKTA KALMA
 * koşulunu sabitliyor: pazar süzgeci hiçbir durumda gösterilecek ürünü
 * olan bir sayfayı boşaltmamalı.
 */

/**
 * Canlıda ölçülen küme (26 Eylül 2026, P0.1 temizliğinden SONRA).
 *
 * Kapsam kesin olarak UK + Euro Bölgesi. ABD ve Polonya aktif ticaretten
 * çıkarıldı: ürünleri arşivlendi, kaynakları kapatıldı, `markets` satırları
 * `is_active = false`. Dolayısıyla `katalog_pazarlari()` ikisini de
 * döndürmüyor ve bu sabit o gerçeği yansıtıyor.
 */
const KATALOG = ['UK', 'AT', 'IE', 'IT'];

test('urunu olan pazar suzulur', () => {
  assert.equal(uygulanacakPazar('UK', KATALOG), 'UK');
  assert.equal(uygulanacakPazar('AT', KATALOG), 'AT');
  assert.equal(uygulanacakPazar('IE', KATALOG), 'IE');
});

test('URUNU OLMAYAN PAZAR SUZULMEZ -- ana sayfa bosalmaz', () => {
  /*
   * En kritik satır. TR varsayılan pazar ve katalogda sıfır ürünü var;
   * burada 'TR' dönseydi öneksiz ana sayfa hiç ürün göstermezdi.
   */
  assert.equal(uygulanacakPazar('TR', KATALOG), undefined);
  assert.equal(uygulanacakPazar('DE', KATALOG), undefined);
});

test('KAPSAM DISI PAZAR SUZGEC ACMAZ (ABD, Polonya)', () => {
  /*
   * P0.1'de ABD ve Polonya aktif ticaretten çıkarıldı. Bu satırlar o kararı
   * çalıştırılabilir biçimde sabitliyor: ikisi de katalog kümesinde
   * olmadığı için süzgeç UYGULANMAZ ve ziyaretçi boş sayfa değil, mevcut
   * UK/Euro katalogunu görür.
   *
   * Envanterleri geri açılırsa bu test KENDİLİĞİNDEN düşmez -- düşmesi
   * gereken yer `katalog_pazarlari()`; oraya girdikleri gün süzgeç de
   * kendiliğinden açılır. Burada sabitlenen şey kural, veri değil.
   */
  assert.equal(uygulanacakPazar('US', KATALOG), undefined);
  assert.equal(uygulanacakPazar('PL', KATALOG), undefined);
});

test('pazar istenmediyse suzgec yok', () => {
  assert.equal(uygulanacakPazar(undefined, KATALOG), undefined);
  assert.equal(uygulanacakPazar(null, KATALOG), undefined);
  assert.equal(uygulanacakPazar('', KATALOG), undefined);
  assert.equal(uygulanacakPazar('   ', KATALOG), undefined);
});

test('KATALOG OKUNAMADIYSA SUZULMEZ -- gecici hata katalogu gizlemez', () => {
  /* Boş liste "okuyamadım" da olabilir; o durumda güvenli taraf süzmemek. */
  assert.equal(uygulanacakPazar('AT', []), undefined);
  assert.equal(uygulanacakPazar('UK', []), undefined);
});

test('kod karsilastirmasi buyuk/kucuk harften bagimsiz', () => {
  /* Adres öneki küçük harf (`/de-at`), veritabanı büyük harf tutuyor. */
  assert.equal(uygulanacakPazar('at', KATALOG), 'AT');
  assert.equal(uygulanacakPazar(' At ', KATALOG), 'AT');
  assert.equal(uygulanacakPazar('AT', ['at']), 'AT');
});

test('donen deger HER ZAMAN buyuk harf -- veritabani oyle tutuyor', () => {
  /* Küçük harf dönseydi `market_code = 'at'` hiçbir satırla eşleşmez ve
     süzgeç sessizce BOŞ sonuç üretirdi. */
  for (const girdi of ['at', 'At', 'aT', 'AT']) {
    assert.equal(uygulanacakPazar(girdi, KATALOG), 'AT');
  }
});
