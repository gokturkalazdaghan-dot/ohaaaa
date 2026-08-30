import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MIN_OBSERVED_DAYS,
  assessDiscountClaim,
  summarizePriceHistory,
  type PricePoint,
} from './priceHistory.js';

/** gün sayısı kadar, verilen fiyatlarla geçmiş üretir (bugünden geriye). */
function history(prices: number[], today = new Date('2026-08-30T00:00:00Z')): PricePoint[] {
  return prices.map((minPriceCents, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (prices.length - 1 - i));
    return { day: d.toISOString().slice(0, 10), minPriceCents };
  });
}

test('gözlem yoksa yorum yapılmaz', () => {
  const s = summarizePriceHistory([], 1000);
  assert.equal(s.available, false);
  assert.equal(s.observedDays, 0);
});

test('eşik altında gözlemle hüküm verilmez', () => {
  const s = summarizePriceHistory(history([100, 100, 100]), 100);
  assert.equal(s.available, false, 'üç günlük veriyle "available" olmamalı');
  assert.equal(s.observedDays, 3);
});

test('en düşük, en yüksek ve ortalama doğru', () => {
  const s = summarizePriceHistory(history([300, 100, 200, 100, 400, 200, 100]), 150);
  assert.equal(s.available, true);
  assert.equal(s.lowestCents, 100);
  assert.equal(s.highestCents, 400);
  assert.equal(s.averageCents, 200); // (300+100+200+100+400+200+100)/7 = 200
});

test('ortalama tam sayı kuruş döner', () => {
  const s = summarizePriceHistory(history([100, 101, 100, 101, 100, 101, 100]), 100);
  assert.ok(Number.isInteger(s.averageCents), 'yarım kuruş diye bir şey yok');
});

test('şu anki fiyat en düşükteyse işaretlenir', () => {
  const s = summarizePriceHistory(history([200, 200, 200, 200, 200, 200, 150]), 150);
  assert.equal(s.isAtLowest, true);
  assert.equal(s.aboveLowestPercent, 0);
});

test('en düşüğün ne kadar üstünde olduğu hesaplanır', () => {
  const s = summarizePriceHistory(history([100, 100, 100, 100, 100, 100, 100]), 125);
  assert.equal(s.isAtLowest, false);
  assert.equal(s.aboveLowestPercent, 25);
});

test('referans fiyat yoksa hüküm verilmez', () => {
  assert.equal(assessDiscountClaim(null, history([100, 100, 100, 100, 100, 100, 100])).kind,
               'insufficient-data');
});

test('yetersiz gözlemle satıcı suçlanmaz', () => {
  // Referans belirgin sekilde yuksek ama elimizde 3 gunluk veri var.
  const v = assessDiscountClaim(9999, history([100, 100, 100]));
  assert.equal(v.kind, 'insufficient-data',
    'az veriyle "sahte indirim" demek haksizlik olur');
});

test('referans son 30 günün en düşüğüne eşit veya altındaysa tutarlı', () => {
  const v = assessDiscountClaim(100, history(new Array(MIN_OBSERVED_DAYS).fill(100)),
                                new Date('2026-08-30T00:00:00Z'));
  assert.equal(v.kind, 'consistent');
});

test('referans en düşüğün üstündeyse indirim abartılmış sayılır', () => {
  const points = history([200, 200, 200, 200, 200, 200, 150], new Date('2026-08-30T00:00:00Z'));
  const v = assessDiscountClaim(300, points, new Date('2026-08-30T00:00:00Z'));
  assert.equal(v.kind, 'overstated');
  if (v.kind === 'overstated') {
    assert.equal(v.lowest30Cents, 150);
    // Gercek indirim en dusuge gore: (150-150)/150 = 0
    assert.equal(v.realPercent, 0);
  }
});

test('30 günden eski gözlemler pencereye girmez', () => {
  const today = new Date('2026-08-30T00:00:00Z');
  // 40 gunluk gecmis: ilk 10 gun cok ucuz, son 30 gun pahali.
  const points = history([...new Array(10).fill(50), ...new Array(30).fill(500)], today);
  const v = assessDiscountClaim(500, points, today);
  assert.equal(v.kind, 'consistent',
    'eski ucuz donem 30 gunluk pencereye girmemeli');
});
