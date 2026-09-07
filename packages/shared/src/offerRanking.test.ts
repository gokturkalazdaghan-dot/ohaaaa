import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BEST_VALUE_DELIVERY_SLACK_DAYS,
  rankOffersByCurrency,
  type RankableOffer,
} from './offerRanking.js';

/* =========================================================================
 * AŞAMA 14 — TEKLİF KARŞILAŞTIRMASI
 * -------------------------------------------------------------------------
 * Kovalanan tehlike: farklı para birimlerindeki tutarları tek listede
 * sıralamak. 1.200.000 HUF (~33 USD) 9.000 cent'ten (90 USD) "pahalı"
 * görünür ve gerçekte üçte biri fiyatındaki teklif listenin dibinde kalır.
 * ========================================================================= */

function o(patch: Partial<RankableOffer> & { id: string }): RankableOffer {
  return {
    currency: 'TRY',
    totalCostCents: 1000,
    estimatedDeliveryDays: 3,
    stock: 5,
    ...patch,
  };
}

test('1) PARA BİRİMLERİ ayrı gruplarda — tek listede sıralanmıyor', () => {
  const gruplar = rankOffersByCurrency([
    o({ id: 'huf', currency: 'HUF', totalCostCents: 1_200_000 }),
    o({ id: 'usd', currency: 'USD', totalCostCents: 9_000 }),
  ]);

  assert.equal(gruplar.length, 2);
  // Her grup kendi içinde tek teklif: HUF "pahalı" diye elenmedi.
  assert.deepEqual(
    gruplar.map((g) => g.offers.length),
    [1, 1],
  );
});

test('2) grup sırası BELİRLENİMCİ: çok tekliften aza, eşitlikte koda göre', () => {
  const gruplar = rankOffersByCurrency([
    o({ id: 'a', currency: 'USD' }),
    o({ id: 'b', currency: 'TRY' }),
    o({ id: 'c', currency: 'TRY' }),
  ]);

  assert.deepEqual(gruplar.map((g) => g.currency), ['TRY', 'USD']);

  // Aynı veri her zaman aynı sırayı verir; sayfa yenilenince yer değişmez.
  for (let i = 0; i < 50; i += 1) {
    assert.deepEqual(
      rankOffersByCurrency([o({ id: 'a', currency: 'USD' }), o({ id: 'b', currency: 'EUR' })])
        .map((g) => g.currency),
      ['EUR', 'USD'],
    );
  }
});

test('3) sıralama KARGO DAHİL toplam maliyete göre', () => {
  // Ürün fiyatı düşük ama kargoyla pahalı olan öne geçmemeli.
  const gruplar = rankOffersByCurrency([
    o({ id: 'pahali-toplam', totalCostCents: 1300 }),
    o({ id: 'ucuz-toplam', totalCostCents: 1100 }),
  ]);

  assert.deepEqual(gruplar[0]!.offers.map((x) => x.id), ['ucuz-toplam', 'pahali-toplam']);
});

test('4) ÜÇ AYRI ROZET: en ucuz, en hızlı, en iyi değer', () => {
  const gruplar = rankOffersByCurrency([
    o({ id: 'ucuz', totalCostCents: 1000, estimatedDeliveryDays: 10 }),
    o({ id: 'hizli', totalCostCents: 2000, estimatedDeliveryDays: 1 }),
    o({ id: 'deger', totalCostCents: 1200, estimatedDeliveryDays: 2 }),
  ]);

  const b = gruplar[0]!.badges;
  assert.deepEqual(b.get('ucuz'), ['cheapest']);
  assert.deepEqual(b.get('hizli'), ['fastest']);
  assert.deepEqual(b.get('deger'), ['best_value'], 'makul sürede en ucuz ayrı rozet almalı');
});

test('5) en ucuz ZATEN hızlıysa ikinci rozet EKLENMİYOR', () => {
  // Aynı satıra iki gerekçe göstermek seçimi kolaylaştırmaz, zorlaştırır.
  const gruplar = rankOffersByCurrency([
    o({ id: 'hem-ucuz-hem-hizli', totalCostCents: 1000, estimatedDeliveryDays: 1 }),
    o({ id: 'diger', totalCostCents: 2000, estimatedDeliveryDays: 9 }),
  ]);

  const b = gruplar[0]!.badges;
  assert.deepEqual(b.get('hem-ucuz-hem-hizli'), ['cheapest', 'fastest']);
  assert.equal(b.get('diger'), undefined);
});

test('6) STOKTA OLMAYAN teklif rozet ALMAZ', () => {
  // Alınamayan bir fiyat, fiyat değildir; "en ucuz" diye öne çıkarmak
  // kullanıcıyı boşuna tıklatır.
  const gruplar = rankOffersByCurrency([
    o({ id: 'tukendi', totalCostCents: 500, stock: 0 }),
    o({ id: 'var', totalCostCents: 1500, stock: 3 }),
  ]);

  const b = gruplar[0]!.badges;
  assert.equal(b.get('tukendi'), undefined, 'tükenmiş teklif rozet almamalı');
  assert.deepEqual(b.get('var'), ['cheapest', 'fastest']);
});

test('6b) hepsi tükendiyse hiç rozet yok', () => {
  const gruplar = rankOffersByCurrency([o({ id: 'a', stock: 0 }), o({ id: 'b', stock: 0 })]);
  assert.equal(gruplar[0]!.badges.size, 0);
});

test('7) best_value penceresi AÇIK ve belirlenimci', () => {
  // Gizli bir ağırlık formülü "neden bu?" sorusunu cevaplayamazdı.
  assert.equal(BEST_VALUE_DELIVERY_SLACK_DAYS, 2);

  // Pencere DIŞINDA kalan ucuz teklif best_value almaz.
  const disarida = rankOffersByCurrency([
    o({ id: 'hizli', totalCostCents: 5000, estimatedDeliveryDays: 1 }),
    o({ id: 'ucuz-ama-yavas', totalCostCents: 1000, estimatedDeliveryDays: 30 }),
  ]);
  assert.deepEqual(disarida[0]!.badges.get('ucuz-ama-yavas'), ['cheapest']);

  // Pencere İÇİNDE olan alır.
  const iceride = rankOffersByCurrency([
    o({ id: 'hizli', totalCostCents: 5000, estimatedDeliveryDays: 1 }),
    o({ id: 'orta', totalCostCents: 2000, estimatedDeliveryDays: 3 }),
    o({ id: 'ucuz-yavas', totalCostCents: 1000, estimatedDeliveryDays: 30 }),
  ]);
  assert.deepEqual(iceride[0]!.badges.get('orta'), ['best_value']);
});

test('8) eşit toplamda BELİRLENİMCİ ayrım: teslimat, sonra kimlik', () => {
  const gruplar = rankOffersByCurrency([
    o({ id: 'zzz', totalCostCents: 1000, estimatedDeliveryDays: 2 }),
    o({ id: 'aaa', totalCostCents: 1000, estimatedDeliveryDays: 2 }),
    o({ id: 'mmm', totalCostCents: 1000, estimatedDeliveryDays: 1 }),
  ]);

  assert.deepEqual(gruplar[0]!.offers.map((x) => x.id), ['mmm', 'aaa', 'zzz']);
});

test('9) girdiyi DEĞİŞTİRMİYOR', () => {
  const girdi = [o({ id: 'b', totalCostCents: 2000 }), o({ id: 'a', totalCostCents: 1000 })];
  const kopya = girdi.map((x) => ({ ...x }));

  rankOffersByCurrency(girdi);

  assert.deepEqual(girdi, kopya, 'çağıranın dizisi yerinde sıralanmamalı');
});

test('10) boş girdi boş sonuç', () => {
  assert.deepEqual(rankOffersByCurrency([]), []);
});
