import assert from 'node:assert/strict';
import test from 'node:test';

import { uygulanacakPazar } from './pazarSuzgeci.js';

/*
 * Bu testler bir uygulama ayrıntısını değil, SİTENİN AYAKTA KALMA
 * koşulunu sabitliyor: pazar süzgeci hiçbir durumda gösterilecek ürünü
 * olan bir sayfayı boşaltmamalı.
 */

/** Canlıda ölçülen küme (26 Eylül 2026). */
const KATALOG = ['UK', 'AT', 'IE', 'PL', 'US', 'IT'];

test('urunu olan pazar suzulur', () => {
  assert.equal(uygulanacakPazar('AT', KATALOG), 'AT');
  assert.equal(uygulanacakPazar('US', KATALOG), 'US');
});

test('URUNU OLMAYAN PAZAR SUZULMEZ -- ana sayfa bosalmaz', () => {
  /*
   * En kritik satır. TR varsayılan pazar ve katalogda sıfır ürünü var;
   * burada 'TR' dönseydi öneksiz ana sayfa hiç ürün göstermezdi.
   */
  assert.equal(uygulanacakPazar('TR', KATALOG), undefined);
  assert.equal(uygulanacakPazar('DE', KATALOG), undefined);
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
