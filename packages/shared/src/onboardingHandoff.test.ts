import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ONBOARDING_REQUIREMENTS,
  HandoffError,
  evaluateOnboardingHandoff,
  handoffKey,
  type HandoffInput,
} from './onboardingHandoff.js';

/* =========================================================================
 * ONAY → ONBOARDING DEVİR SÖZLEŞMESİ
 * -------------------------------------------------------------------------
 * Kovalanan tehlike: ağın "onaylandı" demesini bir mağaza kaydı açmak için
 * yeterli saymak. Ana sayfası bilinmeyen bir mağaza için deeplink
 * üretilemez, çerez penceresi bilinmeyen bir program için dönüşüm
 * ilişkilendirilemez. İkisi de çalışma anında, gerçek trafikte patlar.
 * ========================================================================= */

function girdi(patch: Partial<HandoffInput> = {}): HandoffInput {
  return {
    programId: 'prog-1',
    network: 'awin',
    networkProgramId: '158122',
    applicationState: 'APPROVED',
    homepageUrl: 'https://ornek.example',
    countryCode: 'US',
    commissionRate: 0.1,
    cookieWindowDays: 30,
    termsVerifiedAt: '2026-09-06T00:00:00Z',
    merchantId: null,
    ...patch,
  };
}

test('1) tüm kanıt varsa devir hazır', () => {
  const h = evaluateOnboardingHandoff(girdi());

  assert.equal(h.ready, true);
  assert.deepEqual(h.missing, []);
  assert.equal(h.satisfied.length, ONBOARDING_REQUIREMENTS.length);
  assert.equal(h.alreadyOnboarded, false);
});

test('2) ONAY TEK BAŞINA YETMEZ — her eksik kalem devri durdurur', () => {
  const eksikler: Array<[Partial<HandoffInput>, string]> = [
    [{ homepageUrl: null }, 'homepage_url'],
    [{ homepageUrl: '   ' }, 'homepage_url'],
    [{ countryCode: null }, 'country_code'],
    [{ commissionRate: null }, 'commission_rate'],
    [{ cookieWindowDays: null }, 'cookie_window_days'],
    [{ termsVerifiedAt: null }, 'verified_terms'],
  ];

  for (const [patch, beklenen] of eksikler) {
    const h = evaluateOnboardingHandoff(girdi(patch));
    assert.equal(h.ready, false, `${beklenen} eksikken hazır sayılmamalı`);
    assert.deepEqual(h.missing, [beklenen]);
  }
});

test('3) PENDING "yakında onaylanacak" DEĞİLDİR', () => {
  // Ağ hâlâ değerlendiriyor. Üzerine mağaza kaydı açmak, hiç gelmeyecek
  // bir onayı varsaymak olurdu.
  for (const durum of ['PENDING', 'APPLIED', 'DISCOVERED', 'MANUAL_REQUIRED', 'REJECTED'] as const) {
    const h = evaluateOnboardingHandoff(girdi({ applicationState: durum }));
    assert.equal(h.ready, false, `${durum} devre hazır sayılmamalı`);
    assert.ok(h.missing.includes('approved_state'));
  }

  assert.equal(evaluateOnboardingHandoff(girdi({ applicationState: 'APPROVED' })).ready, true);
});

test('4) KOMİSYON 0 GEÇERLİ bir orandır, eksik veri değil', () => {
  // Komisyonsuz bir program bilinen bir gerçektir. NULL ile aynı kefeye
  // koymak, bilineni eksik ilan etmek olurdu.
  const sifir = evaluateOnboardingHandoff(girdi({ commissionRate: 0 }));
  assert.equal(sifir.ready, true);
  assert.ok(sifir.satisfied.includes('commission_rate'));

  const bilinmeyen = evaluateOnboardingHandoff(girdi({ commissionRate: null }));
  assert.equal(bilinmeyen.ready, false);
  assert.ok(bilinmeyen.missing.includes('commission_rate'));
});

test('5) çerez penceresi 0 ise dönüşüm ilişkilendirilemez — hazır değil', () => {
  // `record_conversion` pencere dışındaki dönüşümü reddeder; 0 gün pencere
  // her dönüşümü sessizce düşürürdü.
  assert.equal(evaluateOnboardingHandoff(girdi({ cookieWindowDays: 0 })).ready, false);
  assert.equal(evaluateOnboardingHandoff(girdi({ cookieWindowDays: -1 })).ready, false);
  assert.equal(evaluateOnboardingHandoff(girdi({ cookieWindowDays: 1 })).ready, true);
});

test('6) bozuk sayı hazır saymıyor (kapalı başarısız)', () => {
  assert.equal(evaluateOnboardingHandoff(girdi({ commissionRate: Number.NaN })).ready, false);
  assert.equal(evaluateOnboardingHandoff(girdi({ cookieWindowDays: Number.POSITIVE_INFINITY })).ready, false);
});

test('7) birden çok eksik hepsi birden raporlanıyor', () => {
  // Tek tek raporlansaydı operatör altı tur döner, her turda bir eksik
  // öğrenirdi.
  const h = evaluateOnboardingHandoff(
    girdi({ applicationState: 'PENDING', homepageUrl: null, commissionRate: null }),
  );

  assert.deepEqual(h.missing.sort(), ['approved_state', 'commission_rate', 'homepage_url']);
  assert.deepEqual(h.satisfied.sort(), ['cookie_window_days', 'country_code', 'verified_terms']);
});

test('8) İDEMPOTENT: anahtar yalnız ağ ve program kimliğinden türer', () => {
  const a = evaluateOnboardingHandoff(girdi());
  const b = evaluateOnboardingHandoff(girdi({ programId: 'baska-uuid', commissionRate: 0.5 }));

  assert.equal(a.handoffKey, b.handoffKey, 'aynı program aynı anahtarı üretmeli');
  assert.equal(a.handoffKey, 'onboard:awin:158122');

  // Aynı kimlik farklı ağda AYRI programdır.
  assert.notEqual(handoffKey('awin', '158122'), handoffKey('direct', '158122'));
});

test('9) zaten devredilmiş program işaretleniyor', () => {
  const h = evaluateOnboardingHandoff(girdi({ merchantId: 'merchant-uuid' }));
  assert.equal(h.alreadyOnboarded, true);
  assert.equal(h.ready, true, 'kanıt hâlâ tam; tekrar devir çağıranın kararı');
});

test('10) SAF: girdiyi değiştirmiyor, merchant AÇMIYOR', () => {
  const g = girdi();
  const kopya = { ...g };
  Object.freeze(g);

  const h = evaluateOnboardingHandoff(g);

  assert.deepEqual(g, kopya, 'girdi değişmemeli');
  // Çıktı bir ÖLÇÜMDÜR: merchant kimliği üretmez, yalnız var olanı bildirir.
  assert.ok(!Object.keys(h).includes('merchantId'));
  assert.ok(!Object.keys(h).includes('merchant_id'));
});

test('11) ağ ya da program kimliği yoksa devir ölçülemez', () => {
  assert.throws(() => evaluateOnboardingHandoff(girdi({ network: '' })), HandoffError);
  assert.throws(() => evaluateOnboardingHandoff(girdi({ networkProgramId: '' })), HandoffError);
});
