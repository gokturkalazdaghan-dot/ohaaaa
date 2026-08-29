import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createRateLimiter } from './rateLimiter.js';

/** Zamanı elle ilerletebilmek için sahte saat. */
function fakeClock(start = 1_700_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

test('sınıra kadar izin verir, sonra reddeder', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(clock.now);

  for (let i = 0; i < 5; i += 1) {
    const result = limiter.check('key-1', 5);
    assert.equal(result.allowed, true, `${i + 1}. istek geçmeliydi`);
    assert.equal(result.remaining, 4 - i);
  }

  const blocked = limiter.check('key-1', 5);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
});

test('anahtarlar birbirinden bağımsızdır', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(clock.now);

  limiter.check('key-1', 1);
  assert.equal(limiter.check('key-1', 1).allowed, false);
  assert.equal(limiter.check('key-2', 1).allowed, true, 'başka anahtar etkilenmemeli');
});

test('kayan pencere: sabit pencere sınırındaki iki kat trafiği engeller', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(clock.now);

  // 0. saniyede 10 istek — kotayı doldurur.
  for (let i = 0; i < 10; i += 1) assert.equal(limiter.check('k', 10).allowed, true);

  // 59. saniye: sabit pencere olsaydı sıfırlanmış olurdu, burada olmamalı.
  clock.advance(59_000);
  assert.equal(limiter.check('k', 10).allowed, false, 'pencere henüz kaymadı');

  // 61. saniye: ilk istekler pencereden çıktı.
  clock.advance(2_000);
  assert.equal(limiter.check('k', 10).allowed, true);
});

test('pencere kısmen kayınca kota kısmen açılır', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(clock.now);

  limiter.check('k', 3);
  clock.advance(30_000);
  limiter.check('k', 3);
  limiter.check('k', 3);
  assert.equal(limiter.check('k', 3).allowed, false);

  // İlk isteğin üzerinden 60 sn geçince yalnızca o slot boşalır.
  clock.advance(30_001);
  assert.equal(limiter.check('k', 3).allowed, true);
  assert.equal(limiter.check('k', 3).allowed, false);
});

test('prune eski kayıtları temizler (bellek sızıntısı olmaz)', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(clock.now);

  for (let i = 0; i < 100; i += 1) limiter.check(`key-${i}`, 10);
  assert.equal(limiter.size(), 100);

  assert.equal(limiter.prune(), 0, 'taze kayıtlar korunmalı');

  clock.advance(61_000);
  assert.equal(limiter.prune(), 100);
  assert.equal(limiter.size(), 0);
});

test('resetAt gelecekte bir zamandır', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(clock.now);

  const result = limiter.check('k', 1);
  assert.ok(result.resetAt > Math.floor(clock.now() / 1000));
});
