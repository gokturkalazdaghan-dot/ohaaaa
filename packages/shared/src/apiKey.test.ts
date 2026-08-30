import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  decideApiKeyAccess,
  extractPrefix,
  generateApiKey,
  hashApiKey,
  safeCompareHash,
} from './apiKey.js';

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

// ---------------------------------------------------------------------------
// decideApiKeyAccess — kimlik doğrulama kararları
// ---------------------------------------------------------------------------
// decideApiKeyAccess testleri
{
  const key = generateApiKey('live');

  /** Geçerli bir kayıt; testler tek alanı değiştirip sapmayı ölçer. */
  function record(overrides: Partial<Parameters<typeof decideApiKeyAccess>[0]['record'] & object> = {}) {
    return {
      keyHash: key.hash,
      scopes: ['products:read', 'products:write'],
      revokedAt: null,
      expiresAt: null,
      vendorStatus: 'approved',
      ...overrides,
    };
  }

  test('decideApiKeyAccess: geçerli anahtara izin verir', () => {
    const decision = decideApiKeyAccess({
      presented: key.plaintext,
      record: record(),
      requiredScope: 'products:write',
    });
    assert.equal(decision.ok, true);
  });

  test('decideApiKeyAccess: biçimi bozuk anahtarda veritabanına hiç gitmeden reddeder', () => {
    const decision = decideApiKeyAccess({
      presented: 'bozuk-anahtar',
      record: record(),
      requiredScope: 'products:read',
    });
    assert.deepEqual(decision, { ok: false, code: 'unauthorized', reason: 'malformed' });
  });

  test('decideApiKeyAccess: kayıt bulunamazsa reddeder', () => {
    const decision = decideApiKeyAccess({
      presented: key.plaintext,
      record: null,
      requiredScope: 'products:read',
    });
    assert.deepEqual(decision, { ok: false, code: 'unauthorized', reason: 'not_found' });
  });

  test('decideApiKeyAccess: özet tutmuyorsa reddeder', () => {
    const other = generateApiKey('live');
    const decision = decideApiKeyAccess({
      presented: key.plaintext,
      record: record({ keyHash: other.hash }),
      requiredScope: 'products:read',
    });
    assert.deepEqual(decision, { ok: false, code: 'unauthorized', reason: 'mismatch' });
  });

  test('decideApiKeyAccess: iptal edilmiş anahtarı reddeder', () => {
    const decision = decideApiKeyAccess({
      presented: key.plaintext,
      record: record({ revokedAt: '2026-01-01T00:00:00Z' }),
      requiredScope: 'products:read',
    });
    assert.deepEqual(decision, { ok: false, code: 'unauthorized', reason: 'revoked' });
  });

  test('decideApiKeyAccess: süresi dolmuş anahtarı reddeder', () => {
    const decision = decideApiKeyAccess({
      presented: key.plaintext,
      record: record({ expiresAt: '2026-01-01T00:00:00Z' }),
      requiredScope: 'products:read',
      now: new Date('2026-06-01T00:00:00Z'),
    });
    assert.deepEqual(decision, { ok: false, code: 'unauthorized', reason: 'expired' });
  });

  test('decideApiKeyAccess: süresi HENÜZ dolmamış anahtarı kabul eder (sınır durumu)', () => {
    const decision = decideApiKeyAccess({
      presented: key.plaintext,
      record: record({ expiresAt: '2026-06-01T00:00:01Z' }),
      requiredScope: 'products:read',
      now: new Date('2026-06-01T00:00:00Z'),
    });
    assert.equal(decision.ok, true);
  });

  test('decideApiKeyAccess: onaylanmamış mağazayı, anahtar geçerli olsa bile reddeder', () => {
    for (const status of ['suspended', 'rejected', null]) {
      const decision = decideApiKeyAccess({
        presented: key.plaintext,
        record: record({ vendorStatus: status }),
        requiredScope: 'products:read',
      });
      assert.deepEqual(
        decision,
        { ok: false, code: 'forbidden', reason: 'vendor_not_approved' },
        `durum: ${status}`,
      );
    }
  });

  /*
   * Bekleyen başvuru ile askıya alınmış hesap AYRI sebep döner: ikisinde
   * satıcının yapması gereken şey farklı (beklemek / bize ulaşmak).
   */
  test('decideApiKeyAccess: bekleyen başvuruyu askıya alınmıştan ayırır', () => {
    const decision = decideApiKeyAccess({
      presented: key.plaintext,
      record: record({ vendorStatus: 'pending' }),
      requiredScope: 'products:read',
    });
    assert.deepEqual(decision, { ok: false, code: 'forbidden', reason: 'vendor_pending' });
  });

  test('decideApiKeyAccess: yetki verilmezse yetki adımı atlanır, gerisi uygulanır', () => {
    // Express katmanı kimliği ve yetkiyi ayrı adımlarda kontrol eder.
    const allowed = decideApiKeyAccess({ presented: key.plaintext, record: record() });
    assert.equal(allowed.ok, true);

    const revoked = decideApiKeyAccess({
      presented: key.plaintext,
      record: record({ revokedAt: '2026-01-01T00:00:00Z' }),
    });
    assert.equal(revoked.ok, false);
  });

  test('decideApiKeyAccess: yetkisi olmayan işlemi reddeder', () => {
    const decision = decideApiKeyAccess({
      presented: key.plaintext,
      record: record({ scopes: ['products:read'] }),
      requiredScope: 'products:write',
    });
    assert.deepEqual(decision, { ok: false, code: 'forbidden', reason: 'missing_scope' });
  });

  /*
   * İptal, süre ve mağaza durumu kontrolleri özet karşılaştırmasından SONRA
   * gelmeli. Önce gelselerdi, yanlış bir anahtarla bile "bu anahtar iptal
   * edilmiş" cevabı alınabilir; bu, o önekte bir anahtarın VAR OLDUĞUNU
   * doğrulayan bir sızıntı olurdu.
   */
  test('decideApiKeyAccess: yanlış anahtarla iptal/süre durumunu sızdırmaz', () => {
    const other = generateApiKey('live');
    const decision = decideApiKeyAccess({
      presented: key.plaintext,
      record: record({ keyHash: other.hash, revokedAt: '2026-01-01T00:00:00Z' }),
      requiredScope: 'products:read',
    });
    assert.equal(decision.ok, false);
    assert.equal(decision.ok === false && decision.reason, 'mismatch');
  });
}
