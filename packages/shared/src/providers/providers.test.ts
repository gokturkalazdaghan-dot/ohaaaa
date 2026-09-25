import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  AWIN_PUBLISHER_ID,
  ProviderError,
  awinClickrefToSubid,
  awinProvider,
  awinMagazaEslemesi,
  awinTransactionToConversion,
  awinTransactionsUrl,
  awinmidCikar,
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

test('kayitli aglar direct, awin ve impact', () => {
  assert.deepEqual(knownNetworks(), ['awin', 'direct', 'impact']);
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

// ---------------------------------------------------------------------------
// AWIN TRANSACTIONS API — ÇEKİLEN DÖNÜŞÜMÜN EŞLENMESİ
// ---------------------------------------------------------------------------
// Bu testlerin hepsi, SESSİZCE YANLIŞ çalışabilecek yerlere bakıyor. Bir
// dönüşüm eşlemesi çöktüğünde gürültü çıkarmaz; yanlış bir tutarı doğru
// sanırsınız ve fark mutabakatta, aylar sonra ortaya çıkar.

/** Resmî `GET /publishers/{id}/transactions/` yanıtından bir satır. */
const AWIN_ORNEK = {
  id: 259630312,
  advertiserId: 7052,
  publisherId: 189069,
  commissionStatus: 'pending',
  commissionAmount: { amount: 5.59, currency: 'GBP' },
  saleAmount: { amount: 55.96, currency: 'GBP' },
  clickRefs: { clickRef: 'abcdefghijklmnop' },
  clickDate: '2017-01-23T12:18:00',
  transactionDate: '2017-02-20T22:04:00',
  orderRef: '111222333444',
};

test('awin: resmi ornek satir ortak modele cevrilir', () => {
  const d = awinTransactionToConversion(AWIN_ORNEK);
  assert.ok(d);
  assert.equal(d.orderId, '259630312');
  assert.equal(d.networkMerchantId, '7052');
  assert.equal(d.subid, 'abcdefghijklmnop');
  assert.equal(d.status, 'pending');
  assert.equal(d.currency, 'GBP');
});

test('awin: tutarlar KURUS olarak, yuvarlama kaybi olmadan cevrilir', () => {
  // 5.59 * 100 ikilik tabanda 558.9999999999999'dur. `trunc` 558 verir ve
  // her donusumde bir kurus kaybederiz.
  const d = awinTransactionToConversion(AWIN_ORNEK);
  assert.ok(d);
  assert.equal(d.commissionCents, 559);
  assert.equal(d.orderTotalCents, 5596);
});

test('awin: declined -> rejected (adlar ayrisiyor, esleme acik yazili)', () => {
  const d = awinTransactionToConversion({ ...AWIN_ORNEK, commissionStatus: 'declined' });
  assert.equal(d?.status, 'rejected');
});

test('awin: approved gecer', () => {
  const d = awinTransactionToConversion({ ...AWIN_ORNEK, commissionStatus: 'approved' });
  assert.equal(d?.status, 'approved');
});

test('awin: TANINMAYAN durum sessizce pending sayilmaz, satir DUSER', () => {
  // Awin sozluge yeni bir deger eklerse, reddedilmis bir satiri "beklemede"
  // diye kaydetmek onu gelir gibi gosterirdi.
  assert.equal(awinTransactionToConversion({ ...AWIN_ORNEK, commissionStatus: 'voided' }), null);
});

test('awin: tarih UTC olarak okunur, calistiran makinenin saatine gore kaymaz', () => {
  const d = awinTransactionToConversion(AWIN_ORNEK);
  assert.equal(d?.occurredAt, '2017-02-20T22:04:00.000Z');
  assert.equal(d?.clickedAt, '2017-01-23T12:18:00.000Z');
});

test('awin: bizim uretmedigimiz clickref atif kurmaz', () => {
  // `clicks_subid_format` kisiti: [A-Za-z0-9_-]{16,64}
  const d = awinTransactionToConversion({
    ...AWIN_ORNEK,
    clickRefs: { clickRef: 'kisa' },
  });
  assert.ok(d, 'satir dusmemeli; yalnizca atifsiz kalmali');
  assert.equal(d.subid, null);
});

test('awin: clickRef hic yoksa donusum yine kaydedilir (atifsiz)', () => {
  const { clickRefs: _atilan, ...clickrefsiz } = AWIN_ORNEK;
  const d = awinTransactionToConversion(clickrefsiz);
  assert.ok(d);
  assert.equal(d.subid, null);
});

test('awin: eksik tutar satiri DUSURUR, sifir yazmaz', () => {
  // 0 kurus komisyon "komisyon yok" demektir; eksik alani 0 saymak
  // olculmemis bir degeri olculmus gibi gosterirdi.
  assert.equal(awinTransactionToConversion({ ...AWIN_ORNEK, commissionAmount: null }), null);
  assert.equal(awinTransactionToConversion({ ...AWIN_ORNEK, saleAmount: {} }), null);
});

test('awin: id ya da advertiserId yoksa satir duser', () => {
  const { id: _a, ...idsiz } = AWIN_ORNEK;
  const { advertiserId: _b, ...advsiz } = AWIN_ORNEK;
  assert.equal(awinTransactionToConversion(idsiz), null);
  assert.equal(awinTransactionToConversion(advsiz), null);
});

test('awin: transactions adresi resmi bicimde kurulur', () => {
  const url = new URL(
    awinTransactionsUrl({
      publisherId: '45628',
      startDate: new Date('2026-09-01T00:00:00Z'),
      endDate: new Date('2026-09-19T05:00:00Z'),
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://api.awin.com/publishers/45628/transactions/');
  // Saat dilimi ayri parametrede; tarihe `Z` eklenmez.
  assert.equal(url.searchParams.get('startDate'), '2026-09-01T00:00:00');
  assert.equal(url.searchParams.get('timezone'), 'UTC');
  assert.equal(url.searchParams.get('dateType'), 'transaction');
});

test('awin postback yolu KAPALI kalir ve sebebi acik soyler', () => {
  // Sir zorunlulugu kalkti ama imzasiz yazma yolu ACILMADI.
  assert.equal(awinProvider.conversionSource, 'pull');
  assert.throws(
    () => awinProvider.verifyPostback({ rawBody: '{}', headers: { get: () => null }, secret: '' }),
    (e: unknown) => e instanceof ProviderError && /pull|CEKILIR/i.test((e as Error).message),
  );
});

test('imzali aglarin postback davranisi DEGISMEDI', () => {
  // Awin icin gevsetilen kural direct'e sizmamali.
  assert.equal(directProvider.conversionSource, 'postback');
});

// ---------------------------------------------------------------------------
// REKLAMVEREN -> MAĞAZA EŞLEMESİ
// ---------------------------------------------------------------------------
// Yanlış mağazaya yazılmış bir komisyon, mutabakatı SESSİZCE bozar: tutar
// gerçektir, sahibi yanlıştır ve bunu hiçbir kısıt yakalamaz.

test('awinmid deeplink sablonundan cikarilir', () => {
  assert.equal(
    awinmidCikar('https://www.awin1.com/cread.php?awinmid=61655&awinaffid=3074081&ued={x}'),
    '61655',
  );
  assert.equal(awinmidCikar('https://example.com/?awinmid=abc'), null);
  assert.equal(awinmidCikar(null), null);
});

test('esleme: baglanti tablosunda satiri OLMAYAN magaza sablondan bulunur', () => {
  // Olculdu: urunlerin ve tiklarin tamamini tasiyan magazanin baglanti
  // tablosunda satiri YOK. Yalnizca baglanti tablosuna dayansaydik o
  // magazanin butun donusumleri duserdi.
  const esleme = awinMagazaEslemesi(
    [{ id: 'bto', deeplink_template: 'https://www.awin1.com/cread.php?awinmid=61655&x=1' }],
    [],
  );
  assert.equal(esleme.get('61655'), 'bto');
});

test('esleme: ACIK tanim, sablondan cikarimi EZER', () => {
  const esleme = awinMagazaEslemesi(
    [{ id: 'sablondan', deeplink_template: '?awinmid=999' }],
    [{ merchant_id: 'acik-tanim', network_program_id: '999' }],
  );
  assert.equal(esleme.get('999'), 'acik-tanim');
});

test('esleme: CELISKILI sablonlar eslenmez, tahmin edilmez', () => {
  // Ayni awinmid iki magazaya isaret ediyorsa birini secmek yazi tura
  // atmaktir. Eslenmemis donusum loglanir ve gorunur kalir.
  const esleme = awinMagazaEslemesi(
    [
      { id: 'a', deeplink_template: '?awinmid=777' },
      { id: 'b', deeplink_template: '?awinmid=777' },
    ],
    [],
  );
  assert.equal(esleme.has('777'), false);
});

test('esleme: celiski olsa bile ACIK tanim varsa o kazanir', () => {
  const esleme = awinMagazaEslemesi(
    [
      { id: 'a', deeplink_template: '?awinmid=777' },
      { id: 'b', deeplink_template: '?awinmid=777' },
    ],
    [{ merchant_id: 'karar', network_program_id: '777' }],
  );
  assert.equal(esleme.get('777'), 'karar');
});

test('esleme: sablonsuz magaza esleme uretmez', () => {
  const esleme = awinMagazaEslemesi([{ id: 'x', deeplink_template: null }], []);
  assert.equal(esleme.size, 0);
});
