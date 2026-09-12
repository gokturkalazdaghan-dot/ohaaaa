import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCategoryTree, siblingsOf } from './categoryTree.js';

type K = { id: string; parentId: string | null; slug: string };

const k = (slug: string, parentId: string | null = null): K => ({ id: slug, parentId, slug });

/** Üretimdeki gerçek ağaç (ölçülen sayılarla). */
const URETIM: K[] = [
  k('elektronik'), k('moda'), k('ev-yasam'), k('spor-outdoor'), k('kozmetik'), k('supermarket'),
  k('telefon', 'elektronik'), k('bilgisayar', 'elektronik'), k('kulaklik', 'elektronik'),
];
const SAYILAR = new Map<string, number>([
  ['elektronik', 0], ['moda', 0], ['ev-yasam', 261], ['spor-outdoor', 0],
  ['kozmetik', 0], ['supermarket', 0],
  ['telefon', 814], ['bilgisayar', 32_894], ['kulaklik', 541],
]);

test('kendi sayısı sıfır olan üst kategori, ÇOCUĞUNDA ürün varsa kalır', () => {
  const agac = buildCategoryTree(URETIM, SAYILAR);
  const elektronik = agac.find((d) => d.category.slug === 'elektronik');

  assert.ok(elektronik, 'Elektronik elenmemeliydi: çocuklarında 34.249 grup var');
  // 0 + 814 + 32.894 + 541
  assert.equal(elektronik.groupCount, 34_249);
  assert.deepEqual(elektronik.children.map((c) => c.category.slug), ['telefon', 'bilgisayar', 'kulaklik']);
});

test('tamamen boş kategoriler elenir -- kullanıcı boş sayfaya gönderilmez', () => {
  const agac = buildCategoryTree(URETIM, SAYILAR);
  const sluglar = agac.map((d) => d.category.slug);

  assert.deepEqual(sluglar, ['elektronik', 'ev-yasam']);
  for (const bos of ['moda', 'spor-outdoor', 'kozmetik', 'supermarket']) {
    assert.ok(!sluglar.includes(bos), `${bos} boş, menüde olmamalıydı`);
  }
});

test('çocuksuz ama ürünlü üst kategori kendi sayısıyla kalır', () => {
  const agac = buildCategoryTree(URETIM, SAYILAR);
  const ev = agac.find((d) => d.category.slug === 'ev-yasam');

  assert.ok(ev);
  assert.equal(ev.groupCount, 261);
  assert.deepEqual(ev.children, []);
});

test('boş çocuk elenir ama dolu kardeşi etkilenmez', () => {
  const sayilar = new Map(SAYILAR);
  sayilar.set('kulaklik', 0);

  const agac = buildCategoryTree(URETIM, sayilar);
  const elektronik = agac.find((d) => d.category.slug === 'elektronik');

  assert.ok(elektronik);
  assert.deepEqual(elektronik.children.map((c) => c.category.slug), ['telefon', 'bilgisayar']);
  assert.equal(elektronik.groupCount, 33_708);
});

test('ÖKSÜZ çocuk kaybolmaz, üst seviyeye çıkar', () => {
  // Üst kategori pasifleştirilmiş: listede yok ama çocuk hâlâ onu gösteriyor.
  const liste = [k('bilgisayar', 'silinmis-ust')];
  const agac = buildCategoryTree(liste, new Map([['bilgisayar', 32_894]]));

  assert.equal(agac.length, 1, 'öksüz çocuk düşürülseydi 32.894 grup gezinilemez olurdu');
  assert.equal(agac[0]?.category.slug, 'bilgisayar');
  assert.equal(agac[0]?.groupCount, 32_894);
});

test('sayısı bilinmeyen kategori sıfır sayılır -- uydurulmaz', () => {
  const agac = buildCategoryTree([k('bos')], new Map());
  assert.deepEqual(agac, []);
});

test('giriş sırası korunur', () => {
  const liste = [k('b'), k('a'), k('c')];
  const agac = buildCategoryTree(liste, new Map([['a', 1], ['b', 1], ['c', 1]]));
  assert.deepEqual(agac.map((d) => d.category.slug), ['b', 'a', 'c']);
});

test('kardeşler yalnızca aynı üst kategoriyi paylaşanlar', () => {
  const bilgisayar = URETIM.find((c) => c.slug === 'bilgisayar');
  assert.ok(bilgisayar);

  assert.deepEqual(
    siblingsOf(URETIM, bilgisayar).map((c) => c.slug),
    ['telefon', 'kulaklik'],
  );

  const evYasam = URETIM.find((c) => c.slug === 'ev-yasam');
  assert.ok(evYasam);
  assert.deepEqual(
    siblingsOf(URETIM, evYasam).map((c) => c.slug),
    ['elektronik', 'moda', 'spor-outdoor', 'kozmetik', 'supermarket'],
  );
});
