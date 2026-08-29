import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { extractPrefix, generateApiKey, hashApiKey, safeCompareHash } from './apiKey.js';

test('üretilen anahtar beklenen biçimdedir', () => {
  const key = generateApiKey('live');

  assert.match(key.plaintext, /^ohk_live_[0-9a-f]{16}_[0-9a-f]{48}$/);
  assert.equal(key.prefix, key.plaintext.split('_').slice(0, 3).join('_'));
  assert.equal(key.hash, hashApiKey(key.plaintext));
  assert.equal(key.hash.length, 64);
  assert.equal(key.lastFour.length, 4);
  assert.ok(key.plaintext.endsWith(key.lastFour));
});

test('test ve canlı anahtarlar ayırt edilebilir', () => {
  assert.ok(generateApiKey('test').plaintext.startsWith('ohk_test_'));
  assert.ok(generateApiKey('live').plaintext.startsWith('ohk_live_'));
});

test('anahtarlar benzersizdir', () => {
  const keys = new Set(Array.from({ length: 500 }, () => generateApiKey().plaintext));
  assert.equal(keys.size, 500);
});

test('ham anahtar özetten türetilemez (özet tek yönlüdür)', () => {
  const key = generateApiKey();
  assert.ok(!key.hash.includes(key.plaintext));
  assert.notEqual(key.hash, key.plaintext);
});

test('extractPrefix bozuk anahtarları veritabanına gitmeden reddeder', () => {
  const valid = generateApiKey().plaintext;
  assert.equal(extractPrefix(valid), valid.split('_').slice(0, 3).join('_'));

  const invalidInputs = [
    '',
    'ohk_live_abc',                                    // eksik parça
    'ohk_live_' + 'z'.repeat(16) + '_' + 'a'.repeat(48), // hex olmayan önek
    'ohk_live_' + 'a'.repeat(16) + '_' + 'a'.repeat(47), // kısa gizli kısım
    'xxx_live_' + 'a'.repeat(16) + '_' + 'a'.repeat(48), // yanlış şema
    'ohk_prod_' + 'a'.repeat(16) + '_' + 'a'.repeat(48), // geçersiz ortam
    'ohk_live_a_b_c_d',                                  // fazla parça
  ];

  for (const input of invalidInputs) {
    assert.equal(extractPrefix(input), null, `reddedilmeliydi: ${input}`);
  }
});

test('safeCompareHash farklı uzunlukta hata fırlatmaz', () => {
  assert.equal(safeCompareHash('abc', 'abcdef'), false);
  assert.equal(safeCompareHash('abc', 'abc'), true);
  assert.equal(safeCompareHash('abc', 'abd'), false);
  assert.equal(safeCompareHash('', ''), true);
});
