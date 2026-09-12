import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gtinDisplayForm } from './gtin.js';

test('tek sıfırla dolgulanmış EAN-13 geri kazanılır', () => {
  // 05099206039292 -> 5099206039292 (normalize.ts içindeki gerçek örnek)
  assert.equal(gtinDisplayForm('05099206039292'), '5099206039292');
});

test('iki sıfırla dolgulanmış UPC-12 geri kazanılır', () => {
  assert.equal(gtinDisplayForm('00012345678905'), '012345678905');
});

test('11 haneye İNİLMEZ -- 11 geçerli bir GTIN uzunluğu değil', () => {
  /*
   * Üretimde 2.955 kaydın sıfırsız uzunluğu 11. Körlemesine kırpmak baştaki
   * ANLAMLI sıfırı silip geçersiz bir kod üretirdi; kural onları GTIN-12'de
   * durduruyor.
   */
  assert.equal(gtinDisplayForm('00012345678901'), '012345678901'); // 3 sıfır -> 12
  assert.equal(gtinDisplayForm('00001234567890'), '001234567890'); // 4 sıfır -> 12
});

test('altı sıfır GTIN-8 demektir', () => {
  assert.equal(gtinDisplayForm('00000012345670'), '12345670');
});

test('beş sıfırda GTIN-8 değil GTIN-12 döner', () => {
  // 9 haneye inmek geçersiz olurdu; bir üst geçerli uzunluk 12.
  assert.equal(gtinDisplayForm('00000123456789'), '000123456789');
});

test('sıfırla başlamayan GTIN-14 olduğu gibi kalır', () => {
  assert.equal(gtinDisplayForm('12345678901231'), '12345678901231');
});

test('zaten kısa biçimdeki değer bozulmaz', () => {
  assert.equal(gtinDisplayForm('5099206039292'), '5099206039292');
  assert.equal(gtinDisplayForm('12345670'), '12345670');
});

test('rakam olmayan, boş ve kısa değerler null döner', () => {
  assert.equal(gtinDisplayForm(null), null);
  assert.equal(gtinDisplayForm(undefined), null);
  assert.equal(gtinDisplayForm(''), null);
  assert.equal(gtinDisplayForm('ABC123'), null);
  assert.equal(gtinDisplayForm('1234567'), null, '7 hane hiçbir GTIN biçimi değil');
  assert.equal(gtinDisplayForm('123456789012345'), null, '15 hane GTIN değil');
});

test('boşluklu değer kırpılır', () => {
  assert.equal(gtinDisplayForm('  05099206039292  '), '5099206039292');
});
