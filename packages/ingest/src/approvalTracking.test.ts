import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  awinProvider,
  type AffiliateProvider,
  type ApplicationResult,
  type CapabilitySupport,
  type ProviderContext,
  type ProviderFetcher,
} from '@ohaaaa/shared/providers';

import {
  runApprovalTracking,
  yoklamaAnahtari,
  yoklamaEngelAnahtari,
  type ApprovalCandidate,
} from './approvalTracking.js';
import type {
  ApplicationRepository,
  AttemptClaim,
  AttemptOutcome,
} from './applicationRepository.js';
import { clearSecretsForTest, registerSecret } from './http/redact.js';

/* =========================================================================
 * AŞAMA 5 — ONAY TAKİBİ
 * -------------------------------------------------------------------------
 * Kovalanan tehlikeler, hepsi SESSİZ olanlar:
 *   • olmayan bir onayın varsayılması (yanıt yok / anlaşılmadı / zaman aşımı)
 *   • ağın bir tutarsızlığının çalışan onayı geri çekmesi
 *   • yoklamanın başvuru anahtarını yakması ya da hiç yoklanamaması
 *   • denetim izinin her turda şişmesi
 *   • sırrın hata mesajıyla denetim izine sızması
 * ========================================================================= */

const cagrilmamaliFetcher: ProviderFetcher = {
  get: async () => {
    throw new Error('Getirici motordan cagrilmamaliydi.');
  },
};

function sahteDepo(opts: { transitionHatasi?: string } = {}) {
  const anahtarlar = new Set<string>();
  const claims: AttemptClaim[] = [];
  const completions: Array<{ key: string; outcome: AttemptOutcome }> = [];
  const transitions: Array<{ programId: string; state: string }> = [];

  const repository: ApplicationRepository = {
    async claimAttempt(claim) {
      if (anahtarlar.has(claim.idempotencyKey)) return false;
      anahtarlar.add(claim.idempotencyKey);
      claims.push(claim);
      return true;
    },
    async completeAttempt(key, outcome) {
      completions.push({ key, outcome });
    },
    async transition(programId, state) {
      if (opts.transitionHatasi) throw new Error(opts.transitionHatasi);
      transitions.push({ programId, state });
    },
  };

  return { repository, claims, completions, transitions, anahtarlar };
}

function aday(patch: Partial<ApprovalCandidate> = {}): ApprovalCandidate {
  return {
    programId: 'prog-1',
    network: 'awin',
    networkProgramId: '158122',
    applicationState: 'PENDING',
    ...patch,
  };
}

async function yoklarken(
  statusFn: AffiliateProvider['applicationStatus'],
  govde: () => Promise<void>,
  destek: CapabilitySupport = 'supported',
): Promise<void> {
  const yetenekler = awinProvider.capabilities as Record<string, CapabilitySupport>;
  const eskiDestek = yetenekler.application_status as CapabilitySupport;
  const eskiMetot = awinProvider.applicationStatus;

  yetenekler.application_status = destek;
  (awinProvider as { applicationStatus?: unknown }).applicationStatus = statusFn;

  try {
    await govde();
  } finally {
    yetenekler.application_status = eskiDestek;
    (awinProvider as { applicationStatus?: unknown }).applicationStatus = eskiMetot;
  }
}

function sonuc(patch: Partial<ApplicationResult> = {}): ApplicationResult {
  return {
    state: 'PENDING',
    networkApplicationId: 'AG-1',
    message: null,
    checkedAt: '2026-09-07T00:00:00.000Z',
    ...patch,
  };
}

const HIZLI = { minDelayMs: 0, retryBaseMs: 0, sleep: async () => {}, pollWindow: '2026-09-07' };

// =========================================================================
// DURUM AYRIMLARI
// =========================================================================
test('1) approved: ağ onayladı diyorsa durum ilerliyor', async () => {
  const depo = sahteDepo();

  await yoklarken(
    async () => sonuc({ state: 'APPROVED', message: 'Kabul edildi.' }),
    async () => {
      const r = await runApprovalTracking({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.status, 'approved');
      assert.equal(r.outcomes[0]?.newState, 'APPROVED');
      assert.equal(r.outcomes[0]?.networkApplicationId, 'AG-1');
      assert.equal(r.approved, 1);
      assert.deepEqual(depo.transitions, [{ programId: 'prog-1', state: 'APPROVED' }]);
    },
  );
});

test('2) rejected: ret de kaydediliyor', async () => {
  const depo = sahteDepo();

  await yoklarken(
    async () => sonuc({ state: 'REJECTED', message: 'Trafik yetersiz.' }),
    async () => {
      const r = await runApprovalTracking({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.status, 'rejected');
      assert.equal(depo.completions[0]?.outcome.result, 'REJECTED');
      assert.equal(depo.completions[0]?.outcome.message, 'Trafik yetersiz.');
    },
  );
});

test('3) pending: durum aynı kalıyor, geçiş DENENMİYOR', async () => {
  const depo = sahteDepo();

  await yoklarken(
    async () => sonuc({ state: 'PENDING' }),
    async () => {
      const r = await runApprovalTracking({
        candidates: [aday({ applicationState: 'PENDING' })],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.status, 'unchanged');
      assert.equal(r.outcomes[0]?.newState, null);
      assert.equal(depo.transitions.length, 0, 'aynı duruma yazma yapılmamalı');
      assert.equal(depo.completions[0]?.outcome.result, 'PENDING');
    },
  );
});

test('4) manual_required: ağ otomasyona izin vermiyor', async () => {
  const depo = sahteDepo();

  const r = await runApprovalTracking({
    candidates: [aday({ network: 'direct' })], // direct: application_status = manual_required
    fetcher: cagrilmamaliFetcher,
    repository: depo.repository,
    ...HIZLI,
  });

  assert.equal(r.outcomes[0]?.status, 'manual_required');
  assert.equal(r.outcomes[0]?.requestSent, false);
  assert.equal(depo.claims[0]?.result, 'MANUAL_REQUIRED');
});

test('5) unavailable: sözleşme doğrulanmadı, istek GİTMEDİ', async () => {
  const depo = sahteDepo();

  const r = await runApprovalTracking({
    candidates: [aday()], // awin: application_status = unavailable
    fetcher: cagrilmamaliFetcher,
    repository: depo.repository,
    ...HIZLI,
  });

  assert.equal(r.outcomes[0]?.status, 'unavailable');
  assert.equal(r.outcomes[0]?.errorCategory, 'CAPABILITY_UNAVAILABLE');
  assert.equal(r.requestsSent, 0);
});

test('6) not_implemented: beyan var, kod yok', async () => {
  const depo = sahteDepo();

  await yoklarken(undefined, async () => {
    const r = await runApprovalTracking({
      candidates: [aday()],
      fetcher: cagrilmamaliFetcher,
      repository: depo.repository,
      ...HIZLI,
    });

    assert.equal(r.outcomes[0]?.status, 'not_implemented');
    assert.equal(r.outcomes[0]?.errorCategory, 'CAPABILITY_NOT_IMPLEMENTED');
  });
});

test('6b) üç engel durumu AYRI raporlanıyor', async () => {
  const depo = sahteDepo();

  const r = await runApprovalTracking({
    candidates: [aday({ programId: 'p1', network: 'awin' }), aday({ programId: 'p2', network: 'direct' })],
    fetcher: cagrilmamaliFetcher,
    repository: depo.repository,
    ...HIZLI,
  });

  const d = Object.fromEntries(r.outcomes.map((o) => [o.network, o.status]));
  assert.equal(d.awin, 'unavailable', 'BOŞLUK');
  assert.equal(d.direct, 'manual_required', 'KARAR');
});

test('7) YOKLAMA ENGELİ DURUM DEĞİŞTİRMEZ', async () => {
  // Başvurusu gönderilmiş bir programı "durumunu soramadık" diye
  // UNAVAILABLE yapmak, gerçekten beklemede olan bir başvuruyu kaybetmek
  // olurdu. Başvuru turundan farkı bu.
  const depo = sahteDepo();

  const r = await runApprovalTracking({
    candidates: [aday({ applicationState: 'APPLIED' })],
    fetcher: cagrilmamaliFetcher,
    repository: depo.repository,
    ...HIZLI,
  });

  assert.equal(r.outcomes[0]?.status, 'unavailable');
  assert.equal(r.outcomes[0]?.newState, null);
  assert.equal(r.outcomes[0]?.previousState, 'APPLIED');
  assert.equal(depo.transitions.length, 0, 'beklemede olan başvuru kaybedilmemeli');
});

// =========================================================================
// ONAY UYDURULMAZ / FAIL-CLOSED
// =========================================================================
test('8) ONAY GERİ ALINAMAZ: ağ "PENDING" dese bile APPROVED korunuyor', async () => {
  // Ağın panelinde bir gecikme ya da önbellek olabilir. O yanıta uyup onayı
  // geri çekmek, çalışan gelir hattını ağın bir tutarsızlığı yüzünden
  // koparmak olurdu. Motor veritabanına HİÇ GİTMİYOR.
  const depo = sahteDepo();

  await yoklarken(
    async () => sonuc({ state: 'PENDING' }),
    async () => {
      const r = await runApprovalTracking({
        candidates: [aday({ applicationState: 'APPROVED' })],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.status, 'transition_blocked');
      assert.equal(r.outcomes[0]?.newState, null);
      assert.equal(depo.transitions.length, 0, 'veritabanına geçersiz geçiş DENENMEMELİ');
      assert.match(String(r.outcomes[0]?.detail), /yasak/);
    },
  );
});

test('8b) ağ onayı GERİ ALABİLİR: APPROVED -> REJECTED serbest', async () => {
  const depo = sahteDepo();

  await yoklarken(
    async () => sonuc({ state: 'REJECTED', message: 'Program kapandi.' }),
    async () => {
      const r = await runApprovalTracking({
        candidates: [aday({ applicationState: 'APPROVED' })],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.status, 'rejected');
      assert.deepEqual(depo.transitions, [{ programId: 'prog-1', state: 'REJECTED' }]);
    },
  );
});

test('9) bozuk yanıt OLMAYAN BİR ONAY varsaymıyor', async () => {
  for (const bozuk of [
    null,
    'APPROVED',
    { state: 'ONAYLANDI' },
    { state: 'APPROVED' },
    { state: 'APPROVED', networkApplicationId: null, message: null, checkedAt: 'dun' },
  ]) {
    const depo = sahteDepo();

    await yoklarken(
      async () => bozuk as ApplicationResult,
      async () => {
        const r = await runApprovalTracking({
          candidates: [aday()],
          fetcher: cagrilmamaliFetcher,
          repository: depo.repository,
          ...HIZLI,
        });

        assert.equal(r.outcomes[0]?.errorCategory, 'MALFORMED_RESPONSE', JSON.stringify(bozuk));
        assert.equal(r.outcomes[0]?.newState, null);
        assert.equal(depo.transitions.length, 0);
      },
    );
  }
});

test('10) zaman aşımı onay üretmiyor', async () => {
  const depo = sahteDepo();

  await yoklarken(
    () => new Promise<ApplicationResult>(() => {}),
    async () => {
      const r = await runApprovalTracking({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        timeoutMs: 20,
        maxRetries: 2,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.status, 'failed');
      assert.equal(r.outcomes[0]?.errorCategory, 'TIMEOUT');
      assert.equal(r.outcomes[0]?.newState, null, 'yanıt gelmedi: durum OLDUĞU GİBİ kalmalı');
      assert.equal(depo.transitions.length, 0);
    },
  );
});

test('11) son kapı yine reddederse durum değişmiyor ve ayrışma kaydediliyor', async () => {
  const depo = sahteDepo({ transitionHatasi: 'Gecersiz basvuru durumu gecisi' });

  await yoklarken(
    async () => sonuc({ state: 'APPROVED' }),
    async () => {
      const r = await runApprovalTracking({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.newState, null);
      assert.equal(r.outcomes[0]?.errorCategory, 'DATABASE_ERROR');
      assert.equal(depo.completions.length, 1, 'ayrışma denetim izine yazılmalı');
    },
  );
});

// =========================================================================
// İDEMPOTENCY VE PENCERE
// =========================================================================
test('12) aynı pencerede ikinci yoklama ağa GİTMİYOR', async () => {
  const depo = sahteDepo();
  let cagrildi = 0;

  await yoklarken(
    async () => {
      cagrildi += 1;
      return sonuc({ state: 'PENDING' });
    },
    async () => {
      const tur = () =>
        runApprovalTracking({
          candidates: [aday()],
          fetcher: cagrilmamaliFetcher,
          repository: depo.repository,
          ...HIZLI,
        });

      const ilk = await tur();
      const ikinci = await tur();

      assert.equal(ilk.outcomes[0]?.status, 'unchanged');
      assert.equal(ikinci.outcomes[0]?.status, 'duplicate');
      assert.equal(cagrildi, 1, 'ağ bir pencerede bir kez yoklanmalı');
    },
  );
});

test('13) YENİ PENCERE yeniden yoklanabiliyor — başvurudan farkı bu', async () => {
  // Başvuru anahtarı sonsuza kadar aynıdır; yoklama tekrarlanmak ÜZERE
  // vardır. Aynı anahtar kullanılsaydı ilk yoklamadan sonra bir daha hiç
  // yoklanamazdı.
  const depo = sahteDepo();
  let cagrildi = 0;

  await yoklarken(
    async () => {
      cagrildi += 1;
      return sonuc({ state: 'PENDING' });
    },
    async () => {
      for (const pencere of ['2026-09-07', '2026-09-08', '2026-09-09']) {
        await runApprovalTracking({
          candidates: [aday()],
          fetcher: cagrilmamaliFetcher,
          repository: depo.repository,
          ...HIZLI,
          pollWindow: pencere,
        });
      }

      assert.equal(cagrildi, 3, 'her yeni pencerede yoklanabilmeli');
      assert.deepEqual(depo.claims.map((c) => c.idempotencyKey), [
        yoklamaAnahtari('awin', '158122', '2026-09-07'),
        yoklamaAnahtari('awin', '158122', '2026-09-08'),
        yoklamaAnahtari('awin', '158122', '2026-09-09'),
      ]);
    },
  );
});

test('14) yoklama BAŞVURU anahtarını yakmıyor', async () => {
  const depo = sahteDepo();

  await yoklarken(
    async () => sonuc({ state: 'PENDING' }),
    async () => {
      await runApprovalTracking({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.ok(!depo.anahtarlar.has('apply:awin:158122'), 'apply: anahtarı boş kalmalı');
      assert.ok(depo.anahtarlar.has(yoklamaAnahtari('awin', '158122', '2026-09-07')));
    },
  );
});

test('15) tekrarlayan engel turları denetim izini şişirmiyor', async () => {
  const depo = sahteDepo();

  for (let i = 0; i < 5; i += 1) {
    await runApprovalTracking({
      candidates: [aday()],
      fetcher: cagrilmamaliFetcher,
      repository: depo.repository,
      ...HIZLI,
    });
  }

  assert.equal(depo.claims.length, 1, 'aynı red aynı pencerede bir kez yazılmalı');
  assert.equal(
    depo.claims[0]?.idempotencyKey,
    yoklamaEngelAnahtari('awin', '158122', 'UNAVAILABLE', '2026-09-07'),
  );
});

// =========================================================================
// KAPSAM, HIZ SINIRI, GÜVENLİK
// =========================================================================
test('16) yoklanmaya değmeyen durumlarda ağa GİDİLMİYOR', async () => {
  const depo = sahteDepo();
  let cagrildi = 0;

  await yoklarken(
    async () => {
      cagrildi += 1;
      return sonuc();
    },
    async () => {
      const r = await runApprovalTracking({
        candidates: [
          aday({ programId: 'p1', applicationState: 'DISCOVERED' }),
          aday({ programId: 'p2', applicationState: 'REJECTED' }),
          aday({ programId: 'p3', applicationState: 'UNAVAILABLE' }),
        ],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(cagrildi, 0, 'sorulacak bir başvuru yok');
      assert.deepEqual(r.outcomes.map((o) => o.status), ['unchanged', 'unchanged', 'unchanged']);
      assert.equal(depo.claims.length, 0, 'boş yoklama denetim izi üretmemeli');
    },
  );
});

test('17) hız sınırı: tur kotası dolunca yoklama durur', async () => {
  const depo = sahteDepo();
  let cagrildi = 0;

  await yoklarken(
    async () => {
      cagrildi += 1;
      return sonuc({ state: 'PENDING' });
    },
    async () => {
      const r = await runApprovalTracking({
        candidates: [
          aday({ programId: 'p1', networkProgramId: '1' }),
          aday({ programId: 'p2', networkProgramId: '2' }),
          aday({ programId: 'p3', networkProgramId: '3' }),
        ],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        maxRequestsPerNetwork: 2,
        ...HIZLI,
      });

      assert.equal(cagrildi, 2);
      assert.equal(r.outcomes[2]?.status, 'rate_limited');
      assert.equal(r.outcomes[2]?.errorCategory, 'RATE_LIMITED');
    },
  );
});

test('18) üstel geri çekilme ve kalıcı hata ayrımı', async () => {
  const beklemeler: number[] = [];
  const depo = sahteDepo();

  await yoklarken(
    async () => {
      throw Object.assign(new Error('gecici'), { status: 503 });
    },
    async () => {
      await runApprovalTracking({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        maxRetries: 4,
        retryBaseMs: 100,
        minDelayMs: 0,
        pollWindow: '2026-09-07',
        sleep: async (ms) => {
          beklemeler.push(ms);
        },
      });

      assert.deepEqual(beklemeler, [100, 200, 400]);
    },
  );

  const depo2 = sahteDepo();
  let cagrildi = 0;
  await yoklarken(
    async () => {
      cagrildi += 1;
      throw Object.assign(new Error('reddedildi'), { status: 403 });
    },
    async () => {
      await runApprovalTracking({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo2.repository,
        maxRetries: 4,
        ...HIZLI,
      });
      assert.equal(cagrildi, 1, '4xx yeniden denenmemeli');
    },
  );
});

test('19) sır maskeleniyor: denetim izine ve loga sızmıyor', async () => {
  const SIR = 'awin-status-key-GERCEK-DEGIL-1234567890';
  clearSecretsForTest();
  registerSecret(SIR);

  const depo = sahteDepo();
  const kayitlar: string[] = [];

  try {
    await yoklarken(
      async () => {
        throw new Error(`yoklama reddedildi (anahtar: ${SIR})`);
      },
      async () => {
        const r = await runApprovalTracking({
          candidates: [aday()],
          fetcher: cagrilmamaliFetcher,
          repository: depo.repository,
          maxRetries: 1,
          ...HIZLI,
          log: (e, d) => kayitlar.push(`${e} ${JSON.stringify(d)}`),
        });

        const hepsi = JSON.stringify({ r, claims: depo.claims, completions: depo.completions, kayitlar });
        assert.ok(!hepsi.includes(SIR), 'sır hiçbir çıktı yoluna sızmamalı');
        assert.match(String(r.outcomes[0]?.detail), /\*\*\*/);
      },
    );
  } finally {
    clearSecretsForTest();
  }
});

test('20) motor fetch ÇAĞIRMIYOR: erişimin tek yolu ProviderContext', async () => {
  const depo = sahteDepo();
  const gercekFetch = globalThis.fetch;
  let globalCagrildi = false;
  globalThis.fetch = (() => {
    globalCagrildi = true;
    throw new Error('merkezi guvenlik atlandi');
  }) as unknown as typeof fetch;

  let verilen: ProviderContext | null = null;

  try {
    await yoklarken(
      async (ctx) => {
        verilen = ctx;
        return sonuc({ state: 'PENDING' });
      },
      async () => {
        await runApprovalTracking({
          candidates: [aday()],
          fetcher: cagrilmamaliFetcher,
          repository: depo.repository,
          ...HIZLI,
        });
      },
    );
  } finally {
    globalThis.fetch = gercekFetch;
  }

  assert.equal(globalCagrildi, false);
  assert.equal((verilen as unknown as ProviderContext).fetch, cagrilmamaliFetcher);
});

test('21) motor merchant_id YAZMIYOR: onay takibi onboarding değildir', async () => {
  const depo = sahteDepo();

  await yoklarken(
    async () => sonuc({ state: 'APPROVED' }),
    async () => {
      await runApprovalTracking({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      // Depo sözleşmesi merchant_id taşımıyor: yazılamaz olması tesadüf
      // değil, arayüzün kendisi bunu imkânsız kılıyor.
      assert.deepEqual(depo.transitions, [{ programId: 'prog-1', state: 'APPROVED' }]);
      assert.ok(!JSON.stringify(depo.claims).includes('merchant'));
    },
  );
});

test('22) denetim kaydı: pencere, ağ, program ve sonuç taşınıyor', async () => {
  const depo = sahteDepo();

  await yoklarken(
    async () => sonuc({ state: 'APPROVED' }),
    async () => {
      await runApprovalTracking({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        correlationId: 'yoklama-turu-1',
        now: () => '2026-09-07T12:00:00.000Z',
        ...HIZLI,
      });

      const c = depo.claims[0]!;
      assert.equal(c.network, 'awin');
      assert.equal(c.networkProgramId, '158122');
      assert.equal(c.idempotencyKey, 'status:awin:158122:2026-09-07');
      assert.equal(c.correlationId, 'yoklama-turu-1');

      const t = depo.completions[0]!;
      assert.equal(t.outcome.result, 'APPROVED');
      assert.equal(t.outcome.outcomeState, 'APPROVED');
      assert.equal(t.outcome.completedAt, '2026-09-07T12:00:00.000Z');
    },
  );
});

test('23) pencere verilmezse now() gününden türer', async () => {
  const depo = sahteDepo();

  await yoklarken(
    async () => sonuc({ state: 'PENDING' }),
    async () => {
      await runApprovalTracking({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        now: () => '2026-12-25T23:59:00.000Z',
        minDelayMs: 0,
        retryBaseMs: 0,
        sleep: async () => {},
      });

      assert.equal(depo.claims[0]?.idempotencyKey, 'status:awin:158122:2026-12-25');
    },
  );
});
