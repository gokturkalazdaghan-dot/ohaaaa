import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rankShowcase, scoredCount, type ShowcaseCandidate } from './showcase.js';

function aday(over: Partial<ShowcaseCandidate> & { slug: string }): ShowcaseCandidate {
  return { score: null, offerCount: 1, totalCostCents: null, ...over };
}

test('skoru olan ürün, olmayanın ÖNÜNE geçer', () => {
  const sonuc = rankShowcase(
    [
      aday({ slug: 'puansiz', offerCount: 99 }),
      aday({ slug: 'puanli', score: 51, offerCount: 1 }),
    ],
    2,
  );

  // 99 teklifli ürün daha "popüler" ama skoru ölçülmemiş. Ölçülmüş bilgi
  // ölçülmemiş popülerliği yener.
  assert.deepEqual(sonuc.map((x) => x.slug), ['puanli', 'puansiz']);
});

test('skorlular kendi aralarında büyükten küçüğe', () => {
  const sonuc = rankShowcase(
    [
      aday({ slug: 'orta', score: 70 }),
      aday({ slug: 'yuksek', score: 92 }),
      aday({ slug: 'dusuk', score: 55 }),
    ],
    3,
  );

  assert.deepEqual(sonuc.map((x) => x.slug), ['yuksek', 'orta', 'dusuk']);
});

test('hiç skor yoksa teklif sayısı, sonra kargo dahil toplam belirler', () => {
  const sonuc = rankShowcase(
    [
      aday({ slug: 'tek-teklif', offerCount: 1, totalCostCents: 100 }),
      aday({ slug: 'cok-teklif-pahali', offerCount: 5, totalCostCents: 900 }),
      aday({ slug: 'cok-teklif-ucuz', offerCount: 5, totalCostCents: 400 }),
    ],
    3,
  );

  assert.deepEqual(
    sonuc.map((x) => x.slug),
    ['cok-teklif-ucuz', 'cok-teklif-pahali', 'tek-teklif'],
  );
});

test('fiyatı bilinmeyen ürün SONA gider -- bilinmeyen ucuz sayılmaz', () => {
  const sonuc = rankShowcase(
    [
      aday({ slug: 'bilinmeyen', offerCount: 3, totalCostCents: null }),
      aday({ slug: 'bilinen', offerCount: 3, totalCostCents: 5_000_000 }),
    ],
    2,
  );

  assert.deepEqual(sonuc.map((x) => x.slug), ['bilinen', 'bilinmeyen']);
});

test('her ölçütte eşitlerde sıra KARARLI (slug belirler)', () => {
  const girdi = [
    aday({ slug: 'zeta', offerCount: 2, totalCostCents: 100 }),
    aday({ slug: 'alfa', offerCount: 2, totalCostCents: 100 }),
  ];

  // Aynı girdiyi iki kez sıralamak aynı sonucu vermeli: vitrin her ISR
  // yenilemesinde karışırsa kullanıcı aynı sayfayı tanıyamaz.
  assert.deepEqual(rankShowcase(girdi, 2).map((x) => x.slug), ['alfa', 'zeta']);
  assert.deepEqual(rankShowcase([...girdi].reverse(), 2).map((x) => x.slug), ['alfa', 'zeta']);
});

test('limit kadar döner, girdi bozulmaz', () => {
  const girdi = [
    aday({ slug: 'a', score: 10 }),
    aday({ slug: 'b', score: 90 }),
    aday({ slug: 'c', score: 50 }),
  ];

  const sonuc = rankShowcase(girdi, 2);
  assert.equal(sonuc.length, 2);
  assert.deepEqual(sonuc.map((x) => x.slug), ['b', 'c']);
  // Kaynak dizi yerinde sıralanmamalı.
  assert.deepEqual(girdi.map((x) => x.slug), ['a', 'b', 'c']);
});

test('limit sıfır veya negatifse boş döner', () => {
  assert.deepEqual(rankShowcase([aday({ slug: 'a' })], 0), []);
  assert.deepEqual(rankShowcase([aday({ slug: 'a' })], -3), []);
});

test('scoredCount yalnızca ÖLÇÜLMÜŞ skorları sayar', () => {
  assert.equal(
    scoredCount([aday({ slug: 'a', score: 0 }), aday({ slug: 'b' }), aday({ slug: 'c', score: 80 })]),
    2,
  );
});
