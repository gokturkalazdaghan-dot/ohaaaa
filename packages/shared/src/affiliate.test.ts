import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  AffiliateLinkError,
  allowedHostsForMerchant,
  assertSafeRedirect,
  buildAffiliateUrl,
  estimateCommission,
  generateSubId,
} from './affiliate.js';

const NETWORK_TEMPLATE =
  'https://ag.example/c?pub={tracking_id}&sub={subid}&url={url_encoded}';
const DIRECT_TEMPLATE = '{url}?ref={tracking_id}&subid={subid}';

test('subid tahmin edilemez ve şema kısıtına uyar', () => {
  const ids = new Set(Array.from({ length: 1000 }, generateSubId));
  assert.equal(ids.size, 1000, 'çakışma olmamalı');

  for (const id of [...ids].slice(0, 50)) {
    assert.match(id, /^[A-Za-z0-9_-]{16,64}$/, `şema kısıtına uymuyor: ${id}`);
  }
});

test('ağ şablonunda hedef adres kodlanarak gömülür', () => {
  const url = buildAffiliateUrl({
    template: NETWORK_TEMPLATE,
    productUrl: 'https://magaza-a.example/urun/iphone?renk=siyah&hafiza=128',
    trackingId: 'ohaaaa-21',
    subid: 'abc123XYZ_-abc123',
    allowedHosts: ['ag.example'],
  });

  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'ag.example');
  assert.equal(parsed.searchParams.get('pub'), 'ohaaaa-21');
  assert.equal(parsed.searchParams.get('sub'), 'abc123XYZ_-abc123');

  // Kritik: hedefteki & işaretleri ağın parametrelerini bozmamalı.
  assert.equal(
    parsed.searchParams.get('url'),
    'https://magaza-a.example/urun/iphone?renk=siyah&hafiza=128',
  );
});

test('doğrudan şablonda parametreler ürün adresine eklenir', () => {
  const url = buildAffiliateUrl({
    template: DIRECT_TEMPLATE,
    productUrl: 'https://magaza-b.example/p/telefon',
    trackingId: 'ohaaaa',
    subid: 'sub_0123456789abcdef',
    allowedHosts: ['magaza-b.example'],
  });

  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'magaza-b.example');
  assert.equal(parsed.pathname, '/p/telefon');
  assert.equal(parsed.searchParams.get('ref'), 'ohaaaa');
  assert.equal(parsed.searchParams.get('subid'), 'sub_0123456789abcdef');
});

test('ürün adresinde zaten sorgu varsa doğrudan şablon bozulmaz', () => {
  // '{url}?ref=' şablonu, adreste zaten '?' varsa geçersiz URL üretebilirdi.
  const url = buildAffiliateUrl({
    template: '{url}&ref={tracking_id}&subid={subid}',
    productUrl: 'https://magaza-b.example/p/telefon?varyant=2',
    trackingId: 'ohaaaa',
    subid: 'sub_0123456789abcdef',
    allowedHosts: ['magaza-b.example'],
  });

  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('varyant'), '2');
  assert.equal(parsed.searchParams.get('ref'), 'ohaaaa');
});

test('tracking_id eksikse link üretilmez (takipsiz trafik gönderilmez)', () => {
  assert.throws(
    () =>
      buildAffiliateUrl({
        template: NETWORK_TEMPLATE,
        productUrl: 'https://magaza-a.example/u/1',
        trackingId: null,
        subid: 'sub_0123456789abcdef',
        allowedHosts: ['ag.example'],
      }),
    (error: unknown) =>
      error instanceof AffiliateLinkError && error.code === 'missing_tracking_id',
  );
});

test('hedef içermeyen şablon reddedilir', () => {
  assert.throws(
    () =>
      buildAffiliateUrl({
        template: 'https://ag.example/c?pub={tracking_id}',
        productUrl: 'https://magaza-a.example/u/1',
        trackingId: 'x',
        subid: 'sub_0123456789abcdef',
        allowedHosts: ['ag.example'],
      }),
    (error: unknown) =>
      error instanceof AffiliateLinkError && error.code === 'invalid_template',
  );
});

test('javascript: ve data: şemaları reddedilir', () => {
  for (const hostile of [
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    'not-a-url',
  ]) {
    assert.throws(
      () =>
        buildAffiliateUrl({
          template: DIRECT_TEMPLATE,
          productUrl: hostile,
          trackingId: 'x',
          subid: 'sub_0123456789abcdef',
          allowedHosts: ['magaza-b.example'],
        }),
      (error: unknown) =>
        error instanceof AffiliateLinkError && error.code === 'invalid_product_url',
      `reddedilmeliydi: ${hostile}`,
    );
  }
});

// --- Açık yönlendirme (open redirect) savunması -----------------------------

test('alt alan adları kabul, benzer görünen alan adları reddedilir', () => {
  assert.doesNotThrow(() =>
    assertSafeRedirect(new URL('https://www.magaza.example/x'), ['magaza.example']),
  );
  assert.doesNotThrow(() =>
    assertSafeRedirect(new URL('https://shop.magaza.example/x'), ['magaza.example']),
  );

  // KLASİK AÇIK: endsWith ile kontrol edilseydi bu geçerdi.
  assert.throws(
    () =>
      assertSafeRedirect(
        new URL('https://magaza.example.saldirgan.net/kimlik-avi'),
        ['magaza.example'],
      ),
    (error: unknown) =>
      error instanceof AffiliateLinkError && error.code === 'unsafe_redirect',
  );

  // Ön ek hilesi de geçmemeli.
  assert.throws(
    () => assertSafeRedirect(new URL('https://notmagaza.example/x'), ['magaza.example']),
    AffiliateLinkError,
  );
});

test('izinli liste boşken hiçbir yönlendirme yapılmaz', () => {
  assert.throws(
    () => assertSafeRedirect(new URL('https://magaza.example/x'), []),
    (error: unknown) =>
      error instanceof AffiliateLinkError && error.code === 'unsafe_redirect',
  );
});

test('şablondaki hedef izinli listeye alınmadıysa link üretilmez', () => {
  assert.throws(
    () =>
      buildAffiliateUrl({
        template: NETWORK_TEMPLATE,
        productUrl: 'https://magaza-a.example/u/1',
        trackingId: 'x',
        subid: 'sub_0123456789abcdef',
        allowedHosts: ['magaza-a.example'], // ag.example listede yok
      }),
    (error: unknown) =>
      error instanceof AffiliateLinkError && error.code === 'unsafe_redirect',
  );
});

test('izinli listesi mağaza ve ağ alan adlarını birlikte çıkarır', () => {
  const hosts = allowedHostsForMerchant({
    homepageUrl: 'https://www.magaza-a.example',
    deeplinkTemplate: NETWORK_TEMPLATE,
  });

  assert.ok(hosts.includes('www.magaza-a.example'));
  assert.ok(hosts.includes('ag.example'));

  // Doğrudan şablonda ağ alan adı yoktur; yalnızca mağaza kalır.
  const directHosts = allowedHostsForMerchant({
    homepageUrl: 'https://magaza-b.example',
    deeplinkTemplate: DIRECT_TEMPLATE,
  });
  assert.deepEqual(directHosts, ['magaza-b.example']);
});

test('komisyon tahmini aşağı yuvarlanır ve teklif oranı önceliklidir', () => {
  // Teklif oranı %2.5, mağaza varsayılanı %4.5 → teklif kazanır.
  assert.equal(estimateCommission(5_349_900, 0.025, 0.045), 133_747);

  // Teklif oranı yoksa mağaza varsayılanı kullanılır.
  assert.equal(estimateCommission(1_000_000, null, 0.03), 30_000);

  // Yuvarlama daima aşağı: gerçekleşmemiş geliri şişirmeyiz.
  assert.equal(estimateCommission(999, null, 0.07), 69);
});
