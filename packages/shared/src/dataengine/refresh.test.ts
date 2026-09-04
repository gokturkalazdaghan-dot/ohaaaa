import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  REFRESH_WINDOWS,
  computeRefreshPlan,
  type RefreshSignals,
} from './refresh.js';
import {
  effectiveIntervalMinutes,
  jobAllowed,
  schedulingPolicyFor,
} from './scheduling.js';

const sabitAn = new Date('2026-09-03T12:00:00Z');

const sinyal = (over: Partial<RefreshSignals> = {}): RefreshSignals => ({
  priceVolatility: 0,
  stockVolatility: 0,
  traffic: 0,
  conversionRate: 0,
  opportunityScore: null,
  revenueValue: 0,
  health: 'saglikli',
  ...over,
});

// --- Sınıflar -------------------------------------------------------------

test('yüksek oynaklık + yüksek trafik VERY_HOT', () => {
  const p = computeRefreshPlan(
    sinyal({
      priceVolatility: 1,
      stockVolatility: 1,
      traffic: 1,
      conversionRate: 1,
      revenueValue: 1,
      opportunityScore: 95,
    }),
    sabitAn,
  );
  assert.equal(p.freshnessClass, 'VERY_HOT');
  assert.equal(p.priority, 'kritik');
});

/*
 * BANT GİRDİLERİ HESAPLANARAK SEÇİLDİ.
 *
 * İlk yazılışta girdiler göz kararı seçilmişti ve üç test kırıldı --
 * biri eşiğin 0,005 altına düşüyordu. Davranış doğruydu, beklenti
 * özensizdi. Ağırlıklar: fiyat 0,35 · stok 0,20 · trafik 0,20 ·
 * dönüşüm 0,10 · gelir 0,15. Eşikler: 0,8 / 0,6 / 0,4 / 0,15.
 */
test('orta-yüksek sinyaller HOT', () => {
  // 1,0*0,35 + 1,0*0,20 + 0,5*0,20 + 0 + 0,4*0,15 = 0,71
  const p = computeRefreshPlan(
    sinyal({ priceVolatility: 1, stockVolatility: 1, traffic: 0.5, revenueValue: 0.4 }),
    sabitAn,
  );
  assert.equal(p.freshnessClass, 'HOT');
});

test('orta sinyaller ACTIVE', () => {
  // 0,8*0,35 + 0,5*0,20 + 0,5*0,20 + 0 + 0,2*0,15 = 0,51
  const p = computeRefreshPlan(
    sinyal({ priceVolatility: 0.8, stockVolatility: 0.5, traffic: 0.5, revenueValue: 0.2 }),
    sabitAn,
  );
  assert.equal(p.freshnessClass, 'ACTIVE');
});

test('düşük sinyaller NORMAL', () => {
  // 0,5*0,35 + 0,3*0,20 = 0,235
  const p = computeRefreshPlan(
    sinyal({ priceVolatility: 0.5, traffic: 0.3 }),
    sabitAn,
  );
  assert.equal(p.freshnessClass, 'NORMAL');
});

/*
 * EŞİKLER AÇIKÇA SINANIYOR.
 *
 * Bantlar bir iş kararı; sessizce kaymamalı. Eşiğin hemen altı ve
 * üstü test edilirse, ağırlıkları değiştiren biri hangi bandın
 * kaydığını görür.
 */
test('bant eşikleri kaymıyor', () => {
  // 0,6 tam eşiği: 1,0*0,35 + 1,0*0,20 + 0,25*0,20 = 0,60 → HOT
  const esikte = computeRefreshPlan(
    sinyal({ priceVolatility: 1, stockVolatility: 1, traffic: 0.25 }),
    sabitAn,
  );
  assert.equal(esikte.freshnessClass, 'HOT');

  // Eşiğin hemen altı → ACTIVE
  const altinda = computeRefreshPlan(
    sinyal({ priceVolatility: 1, stockVolatility: 1, traffic: 0.2 }),
    sabitAn,
  );
  assert.equal(altinda.freshnessClass, 'ACTIVE');
});

test('sinyal yoksa COLD', () => {
  const p = computeRefreshPlan(sinyal(), sabitAn);
  assert.equal(p.freshnessClass, 'COLD');
  assert.equal(p.priority, 'dusuk');
  assert.ok(p.reasons.includes('dusuk_sinyal'));
});

// --- Oynaklık yönü --------------------------------------------------------

test('yüksek oynaklık DAHA SIK yenileme üretir', () => {
  const sik = computeRefreshPlan(sinyal({ priceVolatility: 1, traffic: 1 }), sabitAn);
  const seyrek = computeRefreshPlan(sinyal({ priceVolatility: 0.05 }), sabitAn);
  assert.ok(sik.intervalMinutes < seyrek.intervalMinutes);
});

test('oynaklık düşünce aralık uzar', () => {
  const a = computeRefreshPlan(sinyal({ priceVolatility: 0.9, traffic: 0.9 }), sabitAn);
  const b = computeRefreshPlan(sinyal({ priceVolatility: 0.45, traffic: 0.3 }), sabitAn);
  assert.ok(b.intervalMinutes > a.intervalMinutes);
});

// --- Sağlıksız kaynak -----------------------------------------------------

/*
 * SEZGİYE AYKIRI AMA KRİTİK.
 *
 * Veri bayatladığı için "daha çok deneyelim" demek, çöken bir kaynağa
 * yüklenmek ve toparlanmasını geciktirmektir.
 */
test('sağlıksız kaynak yüksek sinyallere rağmen AGRESİFLEŞMEZ', () => {
  const p = computeRefreshPlan(
    sinyal({
      priceVolatility: 1,
      stockVolatility: 1,
      traffic: 1,
      revenueValue: 1,
      health: 'basarisiz',
    }),
    sabitAn,
  );
  assert.equal(p.freshnessClass, 'COLD');
  assert.equal(p.priority, 'dusuk');
  assert.ok(p.reasons.includes('kaynak_basarisiz'));
});

test('devre kesici açıkken en soğuk sınıfa düşer', () => {
  const p = computeRefreshPlan(
    sinyal({ priceVolatility: 1, traffic: 1, breakerOpen: true }),
    sabitAn,
  );
  assert.equal(p.freshnessClass, 'COLD');
  assert.ok(p.reasons.includes('devre_kesici_acik'));
});

// --- Determinizm ----------------------------------------------------------

/*
 * Rastgelelik olsaydı aynı ürün iki çalıştırmada farklı sınıfa düşer,
 * "neden şimdi kontrol edildi" sorusu cevaplanamazdı.
 */
test('aynı girdi HER ZAMAN aynı planı üretir', () => {
  const s = sinyal({ priceVolatility: 0.7, traffic: 0.5, opportunityScore: 60 });
  const a = computeRefreshPlan(s, sabitAn);
  const b = computeRefreshPlan(s, sabitAn);
  const c = computeRefreshPlan(s, sabitAn);

  assert.equal(a.freshnessClass, b.freshnessClass);
  assert.equal(b.freshnessClass, c.freshnessClass);
  assert.equal(a.intervalMinutes, b.intervalMinutes);
  assert.equal(a.nextRefreshAt.getTime(), c.nextRefreshAt.getTime());
});

test('next_refresh_at gelecekte ve pencere içinde', () => {
  const p = computeRefreshPlan(sinyal({ priceVolatility: 1, traffic: 1 }), sabitAn);
  const pencere = REFRESH_WINDOWS[p.freshnessClass];

  assert.ok(p.nextRefreshAt.getTime() > sabitAn.getTime());
  assert.ok(p.intervalMinutes >= pencere.min && p.intervalMinutes <= pencere.max);
  assert.equal(
    p.nextRefreshAt.getTime(),
    sabitAn.getTime() + p.intervalMinutes * 60_000,
  );
});

// Bozuk girdi planı çökertmemeli.
test('geçersiz sinyaller kırpılır, plan üretilmeye devam eder', () => {
  const p = computeRefreshPlan(
    sinyal({ priceVolatility: Number.NaN, traffic: 99, conversionRate: -5 }),
    sabitAn,
  );
  assert.ok(REFRESH_WINDOWS[p.freshnessClass]);
});

/*
 * Ölçülemeyen skoru sıfır saymak, skoru düşük bir fırsat gibi davranmak
 * olurdu -- "bilmiyoruz" ile "kötü" farklı şeyler.
 */
test('ölçülemeyen fırsat skoru puanı düşürmez', () => {
  const olculdu = computeRefreshPlan(
    sinyal({ priceVolatility: 0.6, traffic: 0.6, opportunityScore: 0 }),
    sabitAn,
  );
  const olculmedi = computeRefreshPlan(
    sinyal({ priceVolatility: 0.6, traffic: 0.6, opportunityScore: null }),
    sabitAn,
  );
  assert.ok(olculmedi.intervalMinutes <= olculdu.intervalMinutes);
  assert.ok(olculmedi.reasons.includes('firsat_skoru_olculmedi'));
});

// --- Sağlık → kuyruk politikası ------------------------------------------

test('sağlıklı kaynak tüm öncelikleri kabul eder', () => {
  const p = schedulingPolicyFor('saglikli');
  assert.equal(p.allowNewJobs, true);
  assert.equal(p.backoffMultiplier, 1);
  assert.ok(jobAllowed(p, 'dusuk'));
});

/*
 * Başarısız kaynakta yalnızca KRİTİK iş: normal katalog yenilemesi
 * göndermek çöken bir kaynağa yüklenmektir. Kritik iş geçer çünkü
 * arkasında bekleyen bir kullanıcı var.
 */
test('başarısız kaynakta yalnızca kritik iş geçer', () => {
  const p = schedulingPolicyFor('basarisiz');
  assert.ok(jobAllowed(p, 'kritik'));
  assert.ok(!jobAllowed(p, 'normal'));
  assert.ok(!jobAllowed(p, 'dusuk'));
  assert.ok(p.backoffMultiplier > 1);
});

test('devre açıkken KRİTİK iş bile üretilmez', () => {
  const p = schedulingPolicyFor('saglikli', true);
  assert.equal(p.allowNewJobs, false);
  // İstek fiziksel olarak engelleniyor; iş üretmek ölü mektup kutusunu
  // doldurmaktan başka bir şey yapmazdı.
  assert.ok(!jobAllowed(p, 'kritik'));
});

/*
 * Hiç çalışmamış kaynak CEZALANDIRILMAZ: bayat ya da başarısız değil,
 * sadece henüz denenmemiş.
 */
test('hiç çalışmamış kaynak backoff almaz', () => {
  const p = schedulingPolicyFor('hic_calismadi');
  assert.equal(p.backoffMultiplier, 1);
  assert.ok(jobAllowed(p, 'normal'));
});

test('bayat kaynak kontrollü backoff alır', () => {
  const p = schedulingPolicyFor('bayat');
  assert.ok(p.backoffMultiplier > 1);
  assert.ok(jobAllowed(p, 'yuksek'));
  assert.ok(!jobAllowed(p, 'normal'));
});

test('efektif aralık backoff ile çarpılır ve 24 saatte sınırlanır', () => {
  assert.equal(effectiveIntervalMinutes(30, schedulingPolicyFor('saglikli')), 30);
  assert.equal(effectiveIntervalMinutes(30, schedulingPolicyFor('basarisiz')), 180);
  // Hiçbir kaynak bir günden fazla tamamen unutulmamalı.
  assert.equal(effectiveIntervalMinutes(1000, schedulingPolicyFor('basarisiz')), 1440);
});
