import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cozumle } from './conflict.js';
import type { Iddia, KaynakTuru } from './conflict.js';

const T = 1_700_000_000_000;

function iddia(
  agentId: string, deger: number, kaynak: KaynakTuru, guven = 0.8, at = T,
): Iddia<number> {
  return { agentId, deger, kaynak, guven, kanitlar: [{ kaynak, gozlem: String(deger), at }] };
}

test('hic iddia yoksa belirsiz', () => {
  const c = cozumle<number>([]);
  assert.equal(c.durum, 'belirsiz');
});

test('tek iddia dogrudan cozulur', () => {
  const c = cozumle([iddia('a', 799, 'model')]);
  assert.equal(c.durum, 'cozuldu');
  if (c.durum === 'cozuldu') { assert.equal(c.deger, 799); assert.equal(c.kod, 'tek_iddia'); }
});

test('ayni degeri soyleyen ajanlar celiski degil', () => {
  const c = cozumle([iddia('a', 799, 'model'), iddia('b', 799, 'turetilmis')]);
  assert.equal(c.durum, 'cozuldu');
  if (c.durum === 'cozuldu') assert.equal(c.kod, 'uzlasma');
});

test('guclu kaynak kazanir -- magaza beslemesi modeli yener', () => {
  const c = cozumle([iddia('price', 799, 'model'), iddia('merchant', 829, 'merchant_feed')]);
  assert.equal(c.durum, 'cozuldu');
  if (c.durum === 'cozuldu') {
    assert.equal(c.deger, 829);
    assert.equal(c.kazanan, 'merchant');
    assert.equal(c.kod, 'kaynak_gucu');
  }
});

test('esit kaynakta TAZE kanit kazanir', () => {
  const c = cozumle([
    iddia('a', 799, 'olcum', 0.8, T - 100_000),
    iddia('b', 829, 'olcum', 0.8, T),
  ]);
  assert.equal(c.durum, 'cozuldu');
  if (c.durum === 'cozuldu') {
    assert.equal(c.deger, 829);
    assert.equal(c.kod, 'kanit_tazeligi');
  }
});

test('kaynak ve tazelik esitse ANLAMLI guven farki kazanir', () => {
  const c = cozumle([iddia('a', 799, 'olcum', 0.55), iddia('b', 829, 'olcum', 0.95)]);
  assert.equal(c.durum, 'cozuldu');
  if (c.durum === 'cozuldu') {
    assert.equal(c.deger, 829);
    assert.equal(c.kod, 'guven_farki');
  }
});

test('kucuk guven farki ayirt ETMEZ -- belirsiz doner', () => {
  /* 0.80 ve 0.85 arasındaki fark gürültü; birini seçmek uydurmak olurdu. */
  const c = cozumle([iddia('a', 799, 'olcum', 0.80), iddia('b', 829, 'olcum', 0.85)]);
  assert.equal(c.durum, 'belirsiz');
  if (c.durum === 'belirsiz') assert.deepEqual([...c.adaylar].sort(), ['a', 'b']);
});

test('belirsiz sonuc bir deger TASIMAZ', () => {
  const c = cozumle([iddia('a', 799, 'olcum', 0.8), iddia('b', 829, 'olcum', 0.8)]);
  assert.equal(c.durum, 'belirsiz');
  assert.equal('deger' in c, false);
});

test('ozel esitlik karsilastirmasi kullanilabilir', () => {
  /* Kuruş farkını önemsemeyen bir karşılaştırma uzlaşma üretir. */
  const c = cozumle(
    [iddia('a', 79900, 'olcum'), iddia('b', 79901, 'olcum')],
    (x, y) => Math.abs(x - y) <= 1,
  );
  assert.equal(c.durum, 'cozuldu');
  if (c.durum === 'cozuldu') assert.equal(c.kod, 'uzlasma');
});

test('uc iddiada en guclu kaynak tek ise o kazanir', () => {
  const c = cozumle([
    iddia('a', 799, 'model'), iddia('b', 829, 'turetilmis'), iddia('c', 849, 'merchant_feed'),
  ]);
  assert.equal(c.durum, 'cozuldu');
  if (c.durum === 'cozuldu') assert.equal(c.kazanan, 'c');
});
