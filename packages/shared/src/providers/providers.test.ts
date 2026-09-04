import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  AWIN_PUBLISHER_ID,
  ProviderError,
  awinClickrefToSubid,
  awinProvider,
  directProvider,
  getProvider,
  isKnownNetwork,
  knownNetworks,
} from './index.js';

/** FIXTURE — deterministik test sırrı. Hicbir gercek kimlik bilgisi degildir. */
const TEST_SECRET = 'fixture-postback-secret-not-real';

function headersWith(values: Record<string, string>) {
  return {
    get(name: string): string | null {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

function signed(body: string, secret = TEST_SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

// ===========================================================================
// REGISTRY
// ===========================================================================

test('bilinmeyen ag sessizce direct sayilmaz, hata firlatir', () => {
  assert.throws(
    () => getProvider('bilinmeyen-ag'),
    (error: unknown) =>
      error instanceof ProviderError && error.code === 'unknown_network',
  );
});

test('bos network degeri de reddedilir', () => {
  for (const bos of [null, undefined, '']) {
    assert.throws(
      () => getProvider(bos),
      (error: unknown) =>
        error instanceof ProviderError && error.code === 'unknown_network',
    );
  }
});

test('kayitli aglar direct ve awin', () => {
  assert.deepEqual(knownNetworks(), ['awin', 'direct']);
  assert.equal(isKnownNetwork('direct'), true);
  assert.equal(isKnownNetwork('awin'), true);
  assert.equal(isKnownNetwork('amazon'), false);
});

test('getProvider dogru saglayiciyi dondurur', () => {
  assert.equal(getProvider('direct').network, 'direct');
  assert.equal(getProvider('awin').network, 'awin');
});

// ===========================================================================
// DIRECT — mevcut davranis korunmali
// ===========================================================================

test('direct: gecerli HMAC imzasi dogrulanir', () => {
  const body = '{"order_id":"S1"}';

  assert.equal(
    directProvider.verifyPostback({
      rawBody: body,
      headers: headersWith({ 'x-signature': signed(body) }),
      secret: TEST_SECRET,
    }),
    true,
  );
});

test('direct: sha256= onekli imza da kabul edilir', () => {
  const body = '{"order_id":"S1"}';

  assert.equal(
    directProvider.verifyPostback({
      rawBody: body,
      headers: headersWith({ 'x-hub-signature-256': `sha256=${signed(body)}` }),
      secret: TEST_SECRET,
    }),
    true,
  );
});

test('direct: govde degistiyse imza tutmaz', () => {
  const signature = signed('{"order_id":"S1"}');

  assert.equal(
    directProvider.verifyPostback({
      rawBody: '{"order_id":"S1-DEGISTIRILMIS"}',
      headers: headersWith({ 'x-signature': signature }),
      secret: TEST_SECRET,
    }),
    false,
  );
});

test('direct: imza yoksa reddedilir', () => {
  assert.equal(
    directProvider.verifyPostback({
      rawBody: '{}',
      headers: headersWith({}),
      secret: TEST_SECRET,
    }),
    false,
  );
});

test('direct: kurus cinsinden tutar oldugu gibi tasinir', () => {
  const sonuc = directProvider.normalizePostback({
    order_id: 'S1',
    subid: 'abcdefghijklmnop',
    status: 'approved',
    amount: 100000,
    commission: 3000,
    currency: 'try',
    occurred_at: '2026-09-04T10:00:00.000Z',
  });

  assert.equal(sonuc.orderTotalCents, 100000);
  assert.equal(sonuc.commissionCents, 3000);
  assert.equal(sonuc.currency, 'TRY', 'para birimi buyuk harfe normalize edilir');
  assert.equal(sonuc.subid, 'abcdefghijklmnop');
  assert.equal(sonuc.status, 'approved');
});

test('direct: amount_is_major ile ondalikli tutar kurusa cevrilir', () => {
  const sonuc = directProvider.normalizePostback({
    order_id: 'S2',
    status: 'pending',
    amount: 1000.5,
    commission: 30.25,
    amount_is_major: true,
  });

  // Kayan nokta ARA hesapta kalir, sonuc tam sayidir.
  assert.equal(sonuc.orderTotalCents, 100050);
  assert.equal(sonuc.commissionCents, 3025);
  assert.equal(Number.isInteger(sonuc.orderTotalCents), true);
  assert.equal(Number.isInteger(sonuc.commissionCents), true);
});

test('direct: eksik zorunlu alan reddedilir', () => {
  assert.throws(
    () => directProvider.normalizePostback({ status: 'approved' }),
    (error: unknown) =>
      error instanceof ProviderError && error.code === 'invalid_payload',
  );
});

test('direct: bilinmeyen durum degeri reddedilir', () => {
  assert.throws(
    () =>
      directProvider.normalizePostback({
        order_id: 'S3',
        status: 'iade_edildi',
        amount: 1,
        commission: 1,
      }),
    (error: unknown) =>
      error instanceof ProviderError && error.code === 'invalid_payload',
  );
});

// ===========================================================================
// AWIN — dogrulanmamis kisim KAPALI BASARISIZ olmali
// ===========================================================================

test('awin: postback dogrulamasi false DONMEZ, acikca hata firlatir', () => {
  assert.throws(
    () =>
      awinProvider.verifyPostback({
        rawBody: '{}',
        headers: headersWith({ 'x-signature': 'herhangi' }),
        secret: TEST_SECRET,
      }),
    (error: unknown) =>
      error instanceof ProviderError && error.code === 'verification_unavailable',
    '"imza yanlis" ile "sema bilinmiyor" ayni yanit olmamali',
  );
});

test('awin: alan eslemesi de kapali basarisiz olur', () => {
  assert.throws(
    () => awinProvider.normalizePostback({ transactionId: '1' }),
    (error: unknown) =>
      error instanceof ProviderError && error.code === 'verification_unavailable',
  );
});

test('awin: ortak sablon akisini kullanir, kendi deeplink kodunu ikizlemez', () => {
  assert.equal(awinProvider.buildDeeplink, undefined);
});

test('awin: yayinci kimligi bir sir degil ve sabit', () => {
  assert.equal(AWIN_PUBLISHER_ID, '3074081');
});

test('awin: clickref gecerliyse subid olarak esleslenir', () => {
  const subid = 'AbCd_1234-efGH567';
  assert.equal(awinClickrefToSubid(subid), subid);
  assert.equal(awinClickrefToSubid(`  ${subid}  `), subid, 'bosluk kirpilir');
});

test('awin: bizim uretmedigimiz clickref atif kurmaz', () => {
  assert.equal(awinClickrefToSubid(''), null);
  assert.equal(awinClickrefToSubid('kisa'), null, '16 karakterden kisa');
  assert.equal(awinClickrefToSubid('bosluk iceren deger 123'), null);
  assert.equal(awinClickrefToSubid(null), null);
  assert.equal(awinClickrefToSubid(12345), null);
  assert.equal(awinClickrefToSubid('a'.repeat(65)), null, '64 karakterden uzun');
});
