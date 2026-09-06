import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runOnboarding, type OnboardingRepository, type OnboardingRefusal } from './onboarding.js';
import { clearSecretsForTest, registerSecret } from './http/redact.js';

/* =========================================================================
 * AŞAMA 9 — OTOMATİK ONBOARDING
 * -------------------------------------------------------------------------
 * Kovalanan tehlike: onayı bir mağaza kaydı açmak için yeterli saymak.
 * Ana sayfası bilinmeyen bir mağaza için deeplink üretilemez ve bu ancak
 * GERÇEK TRAFİKTE ortaya çıkar.
 * ========================================================================= */

function aday(id = 'p1') {
  return { programId: id, network: 'awin', networkProgramId: '158122' };
}

function sahteDepo(
  yanit: (id: string) => Awaited<ReturnType<OnboardingRepository['onboard']>> | Error,
) {
  const cagrilar: string[] = [];
  const repository: OnboardingRepository = {
    async onboard(programId) {
      cagrilar.push(programId);
      const y = yanit(programId);
      if (y instanceof Error) throw y;
      return y;
    },
  };
  return { repository, cagrilar };
}

test('1) devir yapıldı: merchant bağlandı', async () => {
  const { repository } = sahteDepo(() => ({ merchantId: 'm1', created: true, refusal: null }));

  const r = await runOnboarding({ candidates: [aday()], repository });

  assert.equal(r.outcomes[0]?.status, 'onboarded');
  assert.equal(r.outcomes[0]?.merchantId, 'm1');
  assert.equal(r.onboarded, 1);
});

test('2) İDEMPOTENT: ikinci devir yeni mağaza açmıyor', async () => {
  // created=false, aynı merchant. Kod tarafı bunu bir HATA saymamalı:
  // idempotent bir işlemin ikinci çağrısı başarılıdır.
  const { repository } = sahteDepo(() => ({ merchantId: 'm1', created: false, refusal: null }));

  const r = await runOnboarding({ candidates: [aday()], repository });

  assert.equal(r.outcomes[0]?.status, 'already_onboarded');
  assert.equal(r.outcomes[0]?.merchantId, 'm1');
  assert.equal(r.onboarded, 0);
  assert.equal(r.alreadyOnboarded, 1);
});

test('3) her RET GEREKÇESİ ayrı taşınıyor', async () => {
  // Tek bir "başarısız" değeri, eksik ana sayfa ile onaysız programı aynı
  // kefeye koyar ve operatör ne yapacağını bilemez.
  const gerekceler: OnboardingRefusal[] = [
    'not_approved',
    'missing_homepage',
    'missing_country',
    'missing_commission',
    'missing_cookie_window',
    'missing_terms',
    'network_taken',
  ];

  for (const g of gerekceler) {
    const { repository } = sahteDepo(() => ({ merchantId: null, created: false, refusal: g }));
    const r = await runOnboarding({ candidates: [aday()], repository });

    assert.equal(r.outcomes[0]?.status, 'refused');
    assert.equal(r.outcomes[0]?.refusal, g);
    assert.equal(r.outcomes[0]?.merchantId, null, 'reddedilen devirde merchant bağlanmamalı');
  }
});

test('4) ONAYSIZ program devredilmiyor', async () => {
  const { repository } = sahteDepo(() => ({
    merchantId: null,
    created: false,
    refusal: 'not_approved',
  }));

  const r = await runOnboarding({ candidates: [aday()], repository });

  assert.equal(r.refused, 1);
  assert.equal(r.onboarded, 0);
  assert.equal(r.outcomes[0]?.merchantId, null);
});

test('5) program bulunamazsa "devredildi" sayılmıyor', async () => {
  // null dönen bir çağrıyı "başarılı ama boş" saymak, olmayan bir programı
  // devredilmiş göstermek olurdu.
  const { repository } = sahteDepo(() => null);

  const r = await runOnboarding({ candidates: [aday()], repository });

  assert.equal(r.outcomes[0]?.status, 'failed');
  assert.equal(r.failed, 1);
  assert.match(String(r.outcomes[0]?.detail), /bulunamadi/);
});

test('6) bir programın düşmesi diğerlerini durdurmuyor', async () => {
  const { repository } = sahteDepo((id) =>
    id === 'kotu' ? new Error('veritabani hatasi') : { merchantId: 'm', created: true, refusal: null },
  );

  const r = await runOnboarding({
    candidates: [aday('iyi1'), aday('kotu'), aday('iyi2')],
    repository,
  });

  assert.deepEqual(r.outcomes.map((o) => o.status), ['onboarded', 'failed', 'onboarded']);
  assert.equal(r.onboarded, 2);
});

test('7) tur kotası: sınırsız devir yok', async () => {
  // İlk gerçek onay dalgasında binlerce mağaza aynı anda açılırsa hiçbiri
  // gözden geçirilmemiş olur; mağaza açmak geri alınması pahalı bir iştir.
  const { repository, cagrilar } = sahteDepo(() => ({
    merchantId: 'm',
    created: true,
    refusal: null,
  }));

  const r = await runOnboarding({
    candidates: Array.from({ length: 10 }, (_, i) => aday(`p${i}`)),
    repository,
    maxPerRun: 3,
  });

  assert.equal(cagrilar.length, 3);
  assert.equal(r.outcomes.length, 3);
});

test('8) sır hata mesajından maskeleniyor', async () => {
  const SIR = 'onboarding-secret-GERCEK-DEGIL-13579';
  clearSecretsForTest();
  registerSecret(SIR);

  try {
    const { repository } = sahteDepo(() => new Error(`baglanti reddedildi: ${SIR}`));
    const kayitlar: string[] = [];

    const r = await runOnboarding({
      candidates: [aday()],
      repository,
      log: (e, d) => kayitlar.push(`${e} ${JSON.stringify(d)}`),
    });

    const hepsi = JSON.stringify({ r, kayitlar });
    assert.ok(!hepsi.includes(SIR));
    assert.match(String(r.outcomes[0]?.detail), /\*\*\*/);
  } finally {
    clearSecretsForTest();
  }
});

test('9) onboarding AĞA GİTMİYOR: getirici sözleşmede yok', async () => {
  // Onboarding bir İÇ işlemdir; olmayan bir ağ yüzeyi kapatılması gereken
  // bir yüzey de değildir.
  const gercek = globalThis.fetch;
  let cagrildi = false;
  globalThis.fetch = (() => {
    cagrildi = true;
    throw new Error('ag cagrisi');
  }) as unknown as typeof fetch;

  try {
    const { repository } = sahteDepo(() => ({ merchantId: 'm', created: true, refusal: null }));
    await runOnboarding({ candidates: [aday()], repository });
  } finally {
    globalThis.fetch = gercek;
  }

  assert.equal(cagrildi, false);
});
