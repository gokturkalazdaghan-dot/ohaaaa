/**
 * Split-cart birim testleri.
 *
 * Kritik nokta: 4 numaralı test, aynı sepetin veritabanındaki create_order()
 * fonksiyonuyla AYNI tutarı üretmesini doğrular. Sayılar
 * supabase/tests/10_split_cart_test.sql ile eşleşir.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { addToCart, summarizeCart, updateQuantity } from './cart.js';
import {
  allowedVendorOrderTransitions,
  canTransitionVendorOrder,
  nextVendorOrderStep,
  safeInternalPath,
  VENDOR_ORDER_TRANSITIONS,
} from './types.js';
import { calculateCommission, discountPercent, formatMoney, parseMoneyToCents } from './money.js';
import type { CartItem } from './types.js';

function item(overrides: Partial<CartItem> & Pick<CartItem, 'productId' | 'vendorId'>): CartItem {
  return {
    groupSlug: 'test-urun',
    title: 'Test Ürün',
    imageUrl: null,
    priceCents: 100_00,
    quantity: 1,
    vendorName: `Taşeron ${overrides.vendorId}`,
    vendorSlug: `tasoron-${overrides.vendorId}`,
    shippingFeeCents: 0,
    freeShippingThresholdCents: null,
    estimatedDeliveryDays: 2,
    maxStock: 100,
    ...overrides,
  };
}

test('sepet taşeron bazında bölünür', () => {
  const summary = summarizeCart([
    item({ productId: 'p1', vendorId: 'v1' }),
    item({ productId: 'p2', vendorId: 'v1' }),
    item({ productId: 'p3', vendorId: 'v2' }),
  ]);

  assert.equal(summary.vendorCount, 2);
  assert.equal(summary.groups.length, 2);
  assert.equal(summary.itemCount, 3);

  const v1 = summary.groups.find((g) => g.vendorId === 'v1');
  assert.equal(v1?.items.length, 2);
});

test('kargo taşeron başına bir kez ve en yüksek ücretten alınır', () => {
  const summary = summarizeCart([
    item({ productId: 'p1', vendorId: 'v1', shippingFeeCents: 29_99 }),
    item({ productId: 'p2', vendorId: 'v1', shippingFeeCents: 49_99 }),
  ]);

  // İki kalem tek koli: 49,99 bir kez alınır, 29,99 + 49,99 değil.
  assert.equal(summary.groups[0]?.shippingCents, 49_99);
  assert.equal(summary.shippingTotalCents, 49_99);
});

test('ücretsiz kargo eşiği aşılınca kargo sıfırlanır', () => {
  const under = summarizeCart([
    item({
      productId: 'p1',
      vendorId: 'v1',
      priceCents: 200_00,
      shippingFeeCents: 49_99,
      freeShippingThresholdCents: 500_00,
    }),
  ]);
  assert.equal(under.groups[0]?.shippingCents, 49_99);
  assert.equal(under.groups[0]?.freeShippingRemainingCents, 300_00);

  const over = summarizeCart([
    item({
      productId: 'p1',
      vendorId: 'v1',
      priceCents: 200_00,
      quantity: 3,
      shippingFeeCents: 49_99,
      freeShippingThresholdCents: 500_00,
    }),
  ]);
  assert.equal(over.groups[0]?.shippingCents, 0);
  assert.equal(over.groups[0]?.freeShippingRemainingCents, null);
});

test('eşiği olmayan kalem, diğerinin eşiğini bozmaz (müşteri lehine)', () => {
  const summary = summarizeCart([
    item({
      productId: 'p1',
      vendorId: 'v1',
      priceCents: 600_00,
      shippingFeeCents: 49_99,
      freeShippingThresholdCents: 500_00,
    }),
    item({ productId: 'p2', vendorId: 'v1', priceCents: 10_00, shippingFeeCents: 19_99 }),
  ]);

  assert.equal(summary.groups[0]?.shippingCents, 0);
});

test('veritabanındaki create_order() ile aynı tutarı üretir', () => {
  // supabase/tests/10_split_cart_test.sql ile birebir aynı sepet:
  //   Teknomarkt : Sony XM5 x2 (1.189.900 kuruş) + Airfryer x1 (824.900)
  //   Moda Vitrin: Nike Pegasus x1 (449.900)
  const summary = summarizeCart([
    item({
      productId: 'sony',
      vendorId: 'teknomarkt',
      priceCents: 1_189_900,
      quantity: 2,
      shippingFeeCents: 0,
      freeShippingThresholdCents: 500_00,
    }),
    item({
      productId: 'airfryer',
      vendorId: 'teknomarkt',
      priceCents: 824_900,
      shippingFeeCents: 0,
      freeShippingThresholdCents: 500_00,
    }),
    item({
      productId: 'nike',
      vendorId: 'moda-vitrin',
      priceCents: 449_900,
      shippingFeeCents: 29_99,
      freeShippingThresholdCents: 1_000_00,
    }),
  ]);

  // SQL testinde doğrulanan değerler:
  assert.equal(summary.itemsSubtotalCents, 3_654_600);
  assert.equal(summary.shippingTotalCents, 0);
  assert.equal(summary.grandTotalCents, 3_654_600);
  assert.equal(summary.vendorCount, 2);
});

test('komisyon veritabanıyla aynı şekilde aşağı yuvarlanır', () => {
  // SQL: floor((1189900*2) * 0.07) + floor(824900 * 0.07)
  assert.equal(calculateCommission(2_379_800, 0.07), 166_586);
  assert.equal(calculateCommission(824_900, 0.07), 57_743);

  // Yuvarlama farkı daima taşeron lehine (aşağı) olmalı.
  assert.equal(calculateCommission(999, 0.07), 69); // 69.93 -> 69
});

test('sepete ekleme adetleri birleştirir ve stoğu aşmaz', () => {
  let cart = addToCart([], item({ productId: 'p1', vendorId: 'v1', quantity: 2, maxStock: 5 }));
  cart = addToCart(cart, item({ productId: 'p1', vendorId: 'v1', quantity: 2, maxStock: 5 }));
  assert.equal(cart.length, 1);
  assert.equal(cart[0]?.quantity, 4);

  cart = addToCart(cart, item({ productId: 'p1', vendorId: 'v1', quantity: 10, maxStock: 5 }));
  assert.equal(cart[0]?.quantity, 5, 'stok üst sınırında kırpılmalı');
});

test('adet sıfıra düşünce kalem sepetten çıkar', () => {
  const cart = [item({ productId: 'p1', vendorId: 'v1' })];
  assert.equal(updateQuantity(cart, 'p1', 0).length, 0);
});

test('para biçimlendirme ve ayrıştırma', () => {
  assert.match(formatMoney(5_499_900), /54\.999,00/);

  assert.equal(parseMoneyToCents('1.299,90'), 129_990); // Türkçe
  assert.equal(parseMoneyToCents('1,299.90'), 129_990); // İngilizce
  assert.equal(parseMoneyToCents('1299'), 129_900);
  assert.equal(parseMoneyToCents('12,3'), 1_230);
  assert.equal(parseMoneyToCents('abc'), null);

  assert.equal(discountPercent(5_499_900, 6_299_900), 13);
  assert.equal(discountPercent(100, 100), null);
});

// ---------------------------------------------------------------------------
// Alt sipariş durum geçişleri
// ---------------------------------------------------------------------------
/*
 * Bu tablo hem Express API'sinde hem web uygulamasının uç noktalarında
 * uygulanır. Testler kuralın kendisini sabitler: bir geçişin sessizce
 * açılması, alıcıya gönderilmiş bildirimin geri alınabilmesi demektir.
 */
test('alt sipariş: ileri yöndeki geçişlere izin verilir', () => {
  assert.ok(canTransitionVendorOrder('awaiting_vendor', 'accepted'));
  assert.ok(canTransitionVendorOrder('accepted', 'preparing'));
  assert.ok(canTransitionVendorOrder('preparing', 'shipped'));
  assert.ok(canTransitionVendorOrder('shipped', 'delivered'));
});

test('alt sipariş: geriye dönük geçiş engellenir', () => {
  assert.equal(canTransitionVendorOrder('shipped', 'preparing'), false);
  assert.equal(canTransitionVendorOrder('delivered', 'shipped'), false);
  assert.equal(canTransitionVendorOrder('preparing', 'accepted'), false);
  assert.equal(canTransitionVendorOrder('accepted', 'awaiting_vendor'), false);
});

test('alt sipariş: adım atlanamaz', () => {
  // "Bekliyor"dan doğrudan "kargolandı"ya geçmek, kabul ve hazırlık
  // adımlarının hiç olmadığı bir sipariş geçmişi üretirdi.
  assert.equal(canTransitionVendorOrder('awaiting_vendor', 'shipped'), false);
  assert.equal(canTransitionVendorOrder('accepted', 'delivered'), false);
});

test('alt sipariş: teslim ve iptal son durumdur', () => {
  assert.deepEqual([...allowedVendorOrderTransitions('delivered')], []);
  assert.deepEqual([...allowedVendorOrderTransitions('cancelled')], []);
  // Teslim edilmiş bir sipariş iptal EDİLEMEZ: iptal bir iade değildir ve
  // ikisini karıştırmak muhasebeyi bozar.
  assert.equal(canTransitionVendorOrder('delivered', 'cancelled'), false);
});

test('alt sipariş: kargolanana kadar iptal mümkün', () => {
  assert.ok(canTransitionVendorOrder('awaiting_vendor', 'cancelled'));
  assert.ok(canTransitionVendorOrder('accepted', 'cancelled'));
  assert.ok(canTransitionVendorOrder('preparing', 'cancelled'));
  // Kargoya verilmiş bir paket "hiç olmamış" sayılamaz.
  assert.equal(canTransitionVendorOrder('shipped', 'cancelled'), false);
});

test('alt sipariş: bilinmeyen durum hiçbir geçişe izin vermez', () => {
  // Veritabanına yeni bir durum eklenip tablo güncellenmezse, güvenli taraf
  // "hiçbir şey yapılamaz"dır — sessizce her geçişe izin vermek değil.
  assert.deepEqual([...allowedVendorOrderTransitions('uydurma_durum')], []);
  assert.equal(canTransitionVendorOrder('uydurma_durum', 'shipped'), false);
});

/*
 * Panelin gosterdigi "sonraki adim", gecis tablosunun izin verdigi bir gecis
 * OLMAK ZORUNDA.
 *
 * Bu iddia bir ayrisma riskine karsi: panel bir zamanlar kendi eslemesini
 * tutuyordu. Gecis tablosuna dokunan biri o eslemeyi guncellemeyi unutursa,
 * panel sunucunun reddedecegi bir dugme gosterir ve satici hatayi ancak
 * bastiktan sonra gorur. Burada tablo ile esleme birbirine baglaniyor.
 */
test('panelin sonraki adimi her zaman gecerli bir gecis', () => {
  for (const from of Object.keys(VENDOR_ORDER_TRANSITIONS)) {
    const step = nextVendorOrderStep(from);
    if (step === null) {
      assert.equal(
        allowedVendorOrderTransitions(from).filter((to) => to !== 'cancelled').length,
        0,
        `${from} durumunda ilerleyecek yer var ama panel adim gostermiyor`,
      );
      continue;
    }
    assert.ok(
      canTransitionVendorOrder(from, step.status),
      `${from} -> ${step.status} gecis tablosunda yok`,
    );
    assert.ok(step.label.length > 0, `${from} adiminin etiketi bos`);
  }
});

/* Son durumlar bir sonraki adim uretmemeli: teslim edilmis bir siparise
 * "ilerlet" dugmesi koymak, geri donusu olmayan bir islemi tekrarlatir. */
test('teslim ve iptal durumlarinda sonraki adim yok', () => {
  assert.equal(nextVendorOrderStep('delivered'), null);
  assert.equal(nextVendorOrderStep('cancelled'), null);
});

/* Acik yonlendirme, girisin en sik istismar edilen yeridir: kullanici
 * ohaaaa.com'da basladigi icin sondaki adrese guvenir. */
test('devam parametresi yalnizca uygulama ici yol kabul eder', () => {
  assert.equal(safeInternalPath('/siparislerim'), '/siparislerim');
  assert.equal(safeInternalPath('/tasoron/panel/urunler'), '/tasoron/panel/urunler');

  for (const kotu of [
    'https://sahte-site.example',
    '//sahte-site.example',
    '/\\sahte-site.example',
    'javascript:alert(1)',
    '/arama?q=x',
    '/urun#bolum',
    'siparislerim',
    '',
    null,
    undefined,
  ]) {
    assert.equal(safeInternalPath(kotu), null, `kabul edilmemeliydi: ${String(kotu)}`);
  }
});
