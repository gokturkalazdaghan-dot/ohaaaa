/**
 * Adres bütçesine göre parçalamanın testleri.
 *
 * Bu fonksiyon üretimde yaşanan bir arızadan doğdu: `.in(...)` değerleri GET
 * adresinin sorgu dizesine giriyor ve sabit sayıda parçalamak değerlerin
 * UZUNLUĞUNU yok sayıyordu. GTIN'ler 13 hane olduğu için 500'lük parça
 * geçiyor, serbest metin eşleştirme imzaları ise 200'lük parçada adresi 7 KB'ın
 * üzerine çıkarıp `TypeError: fetch failed` ile düşüyordu.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { chunkByUrlBudget } from './supabaseRepository.js';

test('butce asilmadan once parcalamaz', () => {
  const parcalar = chunkByUrlBudget(['a', 'b', 'c'], 100);
  assert.equal(parcalar.length, 1);
  assert.deepEqual(parcalar[0], ['a', 'b', 'c']);
});

test('uzun degerler daha kucuk parcalar uretir', () => {
  const kisa = chunkByUrlBudget(Array.from({ length: 100 }, () => '1234567890'), 200);
  const uzun = chunkByUrlBudget(Array.from({ length: 100 }, () => 'x'.repeat(40)), 200);

  assert.ok(
    uzun.length > kisa.length,
    `uzun degerler daha cok parcaya bolunmeliydi (kisa=${kisa.length}, uzun=${uzun.length})`,
  );
});

test('hicbir parca butceyi asmaz', () => {
  const imzalar = Array.from({ length: 500 }, (_, i) => `marka${i}|urun adi ornek ${i}`);
  for (const parca of chunkByUrlBudget(imzalar, 2000)) {
    const maliyet = parca.reduce((t, d) => t + encodeURIComponent(d).length + 1, 0);
    // Tek deger butceyi asiyorsa yalniz gonderilir; onun disinda butce gecerli.
    if (parca.length > 1) assert.ok(maliyet <= 2000, `parca butceyi asti: ${maliyet}`);
  }
});

test('butceyi tek basina asan deger kendi parcasinda gider (sonsuz dongu yok)', () => {
  const parcalar = chunkByUrlBudget(['x'.repeat(5000), 'kisa'], 100);
  assert.equal(parcalar.length, 2);
  assert.equal(parcalar[0]!.length, 1);
  assert.deepEqual(parcalar[1], ['kisa']);
});

test('bos girdi bos sonuc verir', () => {
  assert.deepEqual(chunkByUrlBudget([], 100), []);
});

test('yuzde kodlamasi maliyete dahil edilir', () => {
  // Bosluk %20 olur: 3 karakter. Ham uzunluga bakan bir uygulama bunu kacirir.
  const parcalar = chunkByUrlBudget(['a b c d e', 'a b c d e'], 12);
  assert.equal(parcalar.length, 2, 'kodlanmis maliyet hesaba katilmadi');
});
