import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  awinProvider,
  directProvider,
  type AffiliateProvider,
  type ApplicationResult,
  type CapabilitySupport,
  type ProviderContext,
  type ProviderFetcher,
} from '@ohaaaa/shared/providers';

import {
  basvuruAnahtari,
  engelAnahtari,
  runProgramApplications,
  type ApplicationCandidate,
} from './programApplication.js';
import type {
  ApplicationRepository,
  AttemptClaim,
  AttemptOutcome,
} from './applicationRepository.js';
import { clearSecretsForTest, registerSecret } from './http/redact.js';

/* =========================================================================
 * AŞAMA 4 — BAŞVURU MOTORU
 * -------------------------------------------------------------------------
 * Kovalanan tehlikeler, hepsi SESSİZ olanlar:
 *   • aynı programa iki başvuru gitmesi (yarış ya da yeniden deneme)
 *   • onaylı bir programın geri çekilip yeniden başvurulması
 *   • sözleşmesi doğrulanmamış bir ağın "başvuru başarısız" gibi görünmesi
 *   • ağın bozuk yanıtının olmayan bir onayı varsayması
 *   • bir sırrın hata mesajıyla denetim izine ve loga sızması
 *   • sağlayıcının kendi fetch'ini kullanıp SSRF kapısını atlaması
 * ========================================================================= */

/** Ağa dokunulursa test DÜŞER. */
const cagrilmamaliFetcher: ProviderFetcher = {
  get: async () => {
    throw new Error('Getirici motordan cagrilmamaliydi.');
  },
};

/**
 * Benzersizlik kısıtını taklit eden bellek içi depo.
 *
 * Kısıt taklit EDİLMEZSE testler idempotency'yi kanıtlamaz -- yalnızca
 * kodun kendi kendine tutarlı olduğunu gösterir.
 */
function sahteDepo(opts: { transitionHatasi?: string; claimHatasi?: string } = {}) {
  const anahtarlar = new Set<string>();
  const claims: AttemptClaim[] = [];
  const completions: Array<{ key: string; outcome: AttemptOutcome }> = [];
  const transitions: Array<{ programId: string; state: string }> = [];

  const repository: ApplicationRepository = {
    async claimAttempt(claim) {
      if (opts.claimHatasi) throw new Error(opts.claimHatasi);
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

function aday(patch: Partial<ApplicationCandidate> = {}): ApplicationCandidate {
  return {
    programId: 'prog-1',
    network: 'awin',
    networkProgramId: '158122',
    applicationState: 'DISCOVERED',
    ...patch,
  };
}

/**
 * Bir sağlayıcıyı GEÇİCİ olarak "destekliyor" hâline getirir.
 *
 * Kayda sahte bir ağ EKLENMİYOR: eklenirse üretim registry'si test için
 * kirlenir ve bir gün gerçek bir tur o sahte ağa başvurmaya kalkar.
 * Burada mevcut sağlayıcı ödünç alınıp `finally` ile geri veriliyor.
 */
async function destekliyorken(
  provider: AffiliateProvider,
  submit: AffiliateProvider['submitApplication'],
  govde: () => Promise<void>,
  destek: CapabilitySupport = 'supported',
): Promise<void> {
  const yetenekler = provider.capabilities as Record<string, CapabilitySupport>;
  const eskiDestek = yetenekler.application_submit as CapabilitySupport;
  const eskiMetot = provider.submitApplication;

  yetenekler.application_submit = destek;
  (provider as { submitApplication?: unknown }).submitApplication = submit;

  try {
    await govde();
  } finally {
    yetenekler.application_submit = eskiDestek;
    (provider as { submitApplication?: unknown }).submitApplication = eskiMetot;
  }
}

function sonuc(patch: Partial<ApplicationResult> = {}): ApplicationResult {
  return {
    state: 'PENDING',
    networkApplicationId: 'net-1',
    message: 'Basvuru alindi.',
    checkedAt: '2026-09-07T00:00:00.000Z',
    ...patch,
  };
}

const HIZLI = { minDelayMs: 0, retryBaseMs: 0, sleep: async () => {} };

// =========================================================================
// 1 — DESTEKLEYEN AĞ
// =========================================================================
test('1) destekleyen ag: basvuru gonderiliyor ve durum ilerliyor', async () => {
  const depo = sahteDepo();
  let cagrildi = 0;

  await destekliyorken(
    awinProvider,
    async () => {
      cagrildi += 1;
      return sonuc({ state: 'APPLIED' });
    },
    async () => {
      const r = await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(cagrildi, 1, 'saglayici tam bir kez cagrilmali');
      assert.equal(r.requestsSent, 1);
      assert.equal(r.outcomes[0]?.status, 'submitted');
      assert.equal(r.outcomes[0]?.newState, 'APPLIED');
      assert.deepEqual(depo.transitions, [{ programId: 'prog-1', state: 'APPLIED' }]);
    },
  );
});

// =========================================================================
// 2-6 — DESTEKLEMEYEN / BİLİNMEYEN / ELLE / BOŞLUK / KODSUZ
// =========================================================================
test('2) desteklemeyen ag (direct): elle yapilir, istek GONDERILMIYOR', async () => {
  const depo = sahteDepo();

  const r = await runProgramApplications({
    candidates: [aday({ network: 'direct', networkProgramId: 'kendi-magazamiz' })],
    fetcher: cagrilmamaliFetcher,
    repository: depo.repository,
    ...HIZLI,
  });

  assert.equal(r.outcomes[0]?.status, 'manual_required');
  assert.equal(r.outcomes[0]?.requestSent, false);
  assert.equal(r.requestsSent, 0);
});

test('3) bilinmeyen ag varsayilana DUSMUYOR ve durum ALMIYOR', async () => {
  const depo = sahteDepo();

  const r = await runProgramApplications({
    candidates: [aday({ network: 'kayitsiz-ag' })],
    fetcher: cagrilmamaliFetcher,
    repository: depo.repository,
    ...HIZLI,
  });

  assert.equal(r.outcomes[0]?.status, 'failed');
  assert.equal(r.outcomes[0]?.errorCategory, 'UNKNOWN_NETWORK');
  assert.match(String(r.outcomes[0]?.detail), /Taninmayan ortaklik agi/);
  assert.equal(
    depo.transitions.length,
    0,
    'tanimadigimiz bir ag hakkinda karar vermis gibi gorunmemeli',
  );
});

test('4) manual_required BIR HATA DEGIL: gecerli bir son durum', async () => {
  const depo = sahteDepo();

  const r = await runProgramApplications({
    candidates: [aday({ network: 'direct' })],
    fetcher: cagrilmamaliFetcher,
    repository: depo.repository,
    ...HIZLI,
  });

  assert.equal(r.outcomes[0]?.newState, 'MANUAL_REQUIRED');
  assert.equal(depo.claims[0]?.result, 'MANUAL_REQUIRED');
  assert.equal(depo.claims[0]?.errorCategory, 'MANUAL_REQUIRED');
});

test('5) unavailable: sozlesme dogrulanmadi, istek GONDERILMEDI', async () => {
  const depo = sahteDepo();

  const r = await runProgramApplications({
    candidates: [aday()], // awin: application_submit = 'unavailable'
    fetcher: cagrilmamaliFetcher,
    repository: depo.repository,
    ...HIZLI,
  });

  assert.equal(r.outcomes[0]?.status, 'unavailable');
  assert.equal(r.outcomes[0]?.newState, 'UNAVAILABLE');
  assert.equal(r.outcomes[0]?.requestSent, false);
  assert.equal(depo.claims[0]?.result, 'UNAVAILABLE');
});

test('5b) unavailable ile manual_required AYRI durumlar', async () => {
  const depo = sahteDepo();

  const r = await runProgramApplications({
    candidates: [
      aday({ programId: 'p-awin', network: 'awin' }),
      aday({ programId: 'p-direct', network: 'direct' }),
    ],
    fetcher: cagrilmamaliFetcher,
    repository: depo.repository,
    ...HIZLI,
  });

  const durumlar = Object.fromEntries(r.outcomes.map((o) => [o.network, o.status]));
  assert.equal(durumlar.awin, 'unavailable', 'BOSLUK: bakilmadi');
  assert.equal(durumlar.direct, 'manual_required', 'KARAR: elle yapilir');
  assert.notEqual(durumlar.awin, durumlar.direct);
});

test('6) not_implemented: beyan supported ama kod yok -> BIZIM hatamiz', async () => {
  const depo = sahteDepo();

  await destekliyorken(awinProvider, undefined, async () => {
    const r = await runProgramApplications({
      candidates: [aday()],
      fetcher: cagrilmamaliFetcher,
      repository: depo.repository,
      ...HIZLI,
    });

    assert.equal(r.outcomes[0]?.status, 'not_implemented');
    assert.equal(r.outcomes[0]?.newState, 'NOT_IMPLEMENTED');
    assert.equal(r.outcomes[0]?.errorCategory, 'CAPABILITY_NOT_IMPLEMENTED');
    assert.equal(r.outcomes[0]?.requestSent, false);
  });
});

// =========================================================================
// 7-10 — DURUM GEÇİŞLERİ
// =========================================================================
test('7) approved gecisi kaydediliyor', async () => {
  const depo = sahteDepo();

  await destekliyorken(
    awinProvider,
    async () => sonuc({ state: 'APPROVED' }),
    async () => {
      const r = await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.status, 'approved');
      assert.deepEqual(depo.transitions, [{ programId: 'prog-1', state: 'APPROVED' }]);
      assert.equal(depo.completions[0]?.outcome.result, 'APPROVED');
    },
  );
});

test('8) rejected gecisi kaydediliyor', async () => {
  const depo = sahteDepo();

  await destekliyorken(
    awinProvider,
    async () => sonuc({ state: 'REJECTED', message: 'Trafik yetersiz.' }),
    async () => {
      const r = await runProgramApplications({
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

test('9) gecersiz gecis: veritabani reddedince durum DEGISMIYOR ama iz kaliyor', async () => {
  // Geçiş kapısının reddi bir HATA değil, bir SAVUNMA: ağ "onaylandi" dese
  // bile geçersiz bir geçiş yazılmıyor. Başvuru gerçekten gittiği için
  // denetim satırı yine de tamamlanıyor.
  const depo = sahteDepo({ transitionHatasi: 'Gecersiz basvuru durumu gecisi: APPROVED -> PENDING' });

  await destekliyorken(
    awinProvider,
    async () => sonuc({ state: 'PENDING' }),
    async () => {
      const r = await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.newState, null, 'gecis reddedildi: durum degismemeli');
      assert.equal(r.outcomes[0]?.errorCategory, 'DATABASE_ERROR');
      assert.equal(r.outcomes[0]?.requestSent, true, 'istek gercekten gitti');
      assert.equal(depo.completions.length, 1, 'denetim izi yine de tamamlanmali');
    },
  );
});

test('10) ONAYLI programa yeniden BASVURULMUYOR', async () => {
  const depo = sahteDepo();
  let cagrildi = 0;

  await destekliyorken(
    awinProvider,
    async () => {
      cagrildi += 1;
      return sonuc();
    },
    async () => {
      const r = await runProgramApplications({
        candidates: [aday({ applicationState: 'APPROVED' })],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.status, 'already_approved');
      assert.equal(cagrildi, 0, 'onayli programa aga istek GITMEMELI');
      assert.equal(depo.claims.length, 0);
      assert.equal(depo.transitions.length, 0, 'onay geri cekilmemeli');
    },
  );
});

// =========================================================================
// 11-12 — EŞZAMANLILIK VE YENİDEN DENEME
// =========================================================================
test('11) es zamanli iki tur: aga TEK istek gidiyor', async () => {
  const depo = sahteDepo();
  let cagrildi = 0;

  await destekliyorken(
    awinProvider,
    async () => {
      cagrildi += 1;
      // İkinci turun talebi, birincisi ağdayken denensin.
      await new Promise((r) => setTimeout(r, 10));
      return sonuc({ state: 'APPLIED' });
    },
    async () => {
      const tur = () =>
        runProgramApplications({
          candidates: [aday()],
          fetcher: cagrilmamaliFetcher,
          repository: depo.repository,
          ...HIZLI,
        });

      const [a, b] = await Promise.all([tur(), tur()]);

      const statuler = [a.outcomes[0]?.status, b.outcomes[0]?.status].sort();
      assert.deepEqual(statuler, ['duplicate', 'submitted']);
      assert.equal(cagrildi, 1, 'ayni programa iki basvuru gitmemeli');
      assert.equal(a.requestsSent + b.requestsSent, 1);
      assert.equal(depo.claims.length, 1, 'ikinci denetim satiri da acilmamali');
    },
  );
});

test('12) yeniden deneme AYNI basvuruyu tekrar URETMIYOR', async () => {
  const depo = sahteDepo();
  let cagrildi = 0;

  await destekliyorken(
    awinProvider,
    async () => {
      cagrildi += 1;
      return sonuc({ state: 'APPLIED' });
    },
    async () => {
      const tur = () =>
        runProgramApplications({
          candidates: [aday()],
          fetcher: cagrilmamaliFetcher,
          repository: depo.repository,
          ...HIZLI,
        });

      const ilk = await tur();
      const ikinci = await tur();

      assert.equal(ilk.outcomes[0]?.status, 'submitted');
      assert.equal(ikinci.outcomes[0]?.status, 'duplicate');
      assert.equal(ikinci.outcomes[0]?.requestSent, false);
      assert.equal(cagrildi, 1);

      // Anahtar turdan bağımsız: aynı niyet, aynı anahtar.
      assert.equal(depo.claims[0]?.idempotencyKey, basvuruAnahtari('awin', '158122'));
    },
  );
});

test('12b) yetenek reddi apply: anahtarini YAKMIYOR', async () => {
  // Bugün sözleşmesi doğrulanmamış bir program için yazılan satır, sözleşme
  // yarın doğrulandığında gerçek başvuruyu engellememeli.
  const depo = sahteDepo();

  await runProgramApplications({
    candidates: [aday()],
    fetcher: cagrilmamaliFetcher,
    repository: depo.repository,
    ...HIZLI,
  });

  assert.equal(depo.claims[0]?.idempotencyKey, engelAnahtari('awin', '158122', 'UNAVAILABLE'));
  assert.ok(!depo.anahtarlar.has(basvuruAnahtari('awin', '158122')), 'apply: anahtari BOS kalmali');

  // Sözleşme doğrulandı: gerçek başvuru artık yapılabiliyor.
  let cagrildi = 0;
  await destekliyorken(
    awinProvider,
    async () => {
      cagrildi += 1;
      return sonuc({ state: 'APPLIED' });
    },
    async () => {
      const r = await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });
      assert.equal(r.outcomes[0]?.status, 'submitted');
      assert.equal(cagrildi, 1);
    },
  );
});

test('12c) tekrarlayan engel turlari denetim izini SISIRMIYOR', async () => {
  const depo = sahteDepo();

  for (let i = 0; i < 5; i += 1) {
    await runProgramApplications({
      candidates: [aday()],
      fetcher: cagrilmamaliFetcher,
      repository: depo.repository,
      ...HIZLI,
    });
  }

  assert.equal(depo.claims.length, 1, 'ayni red bes kez yazilmamali');
  assert.equal(depo.transitions.length, 1, 'ayni gecis bes kez denenmemeli');
});

// =========================================================================
// 13-15 — ZAMAN AŞIMI, HIZ SINIRI, BOZUK YANIT
// =========================================================================
test('13) zaman asimi: asili basvuru turu bloke ETMIYOR', async () => {
  const depo = sahteDepo();

  await destekliyorken(
    awinProvider,
    // Hiç çözülmeyen söz: sağlayıcının kendi zaman aşımına güvenilmiyor.
    () => new Promise<ApplicationResult>(() => {}),
    async () => {
      const r = await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        timeoutMs: 20,
        maxRetries: 2,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.status, 'failed');
      assert.equal(r.outcomes[0]?.errorCategory, 'TIMEOUT');
      assert.equal(r.outcomes[0]?.attempts, 2, 'zaman asimi GECICI: yeniden denenmeli');
      assert.equal(depo.completions[0]?.outcome.result, 'FAILED');
    },
  );
});

test('13b) ustel geri cekilme: bekleme sureleri ikiye katlaniyor', async () => {
  const depo = sahteDepo();
  const beklemeler: number[] = [];

  await destekliyorken(
    awinProvider,
    async () => {
      throw Object.assign(new Error('gecici'), { status: 503 });
    },
    async () => {
      await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        maxRetries: 4,
        retryBaseMs: 100,
        minDelayMs: 0,
        sleep: async (ms) => {
          beklemeler.push(ms);
        },
      });

      assert.deepEqual(beklemeler, [100, 200, 400], '1x, 2x, 4x');
    },
  );
});

test('13c) kalici hata YENIDEN DENENMIYOR', async () => {
  const depo = sahteDepo();
  let cagrildi = 0;

  await destekliyorken(
    awinProvider,
    async () => {
      cagrildi += 1;
      throw Object.assign(new Error('reddedildi'), { status: 403 });
    },
    async () => {
      const r = await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        maxRetries: 4,
        ...HIZLI,
      });

      assert.equal(cagrildi, 1, '4xx tekrar denenmemeli: sunucu bosuna yorulur');
      assert.equal(r.outcomes[0]?.errorCategory, 'HTTP_ERROR');
    },
  );
});

test('14) hiz siniri: tur kotasi dolunca istek GONDERILMIYOR', async () => {
  const depo = sahteDepo();
  let cagrildi = 0;

  await destekliyorken(
    awinProvider,
    async () => {
      cagrildi += 1;
      return sonuc({ state: 'APPLIED' });
    },
    async () => {
      const r = await runProgramApplications({
        candidates: [
          aday({ programId: 'p1', networkProgramId: '1' }),
          aday({ programId: 'p2', networkProgramId: '2' }),
          aday({ programId: 'p3', networkProgramId: '3' }),
        ],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        maxRequestsPerNetwork: 1,
        ...HIZLI,
      });

      assert.equal(cagrildi, 1, 'kota asilmamali');
      assert.equal(r.requestsSent, 1);
      assert.deepEqual(
        r.outcomes.map((o) => o.status),
        ['submitted', 'rate_limited', 'rate_limited'],
      );
      assert.equal(r.outcomes[1]?.errorCategory, 'RATE_LIMITED');
    },
  );
});

test('14b) 429 GECICI sayilir ve geri cekilerek denenir', async () => {
  const depo = sahteDepo();

  await destekliyorken(
    awinProvider,
    async () => {
      throw Object.assign(new Error('cok fazla istek'), { status: 429 });
    },
    async () => {
      const r = await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        maxRetries: 3,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.errorCategory, 'RATE_LIMITED');
      assert.equal(r.outcomes[0]?.attempts, 3);
    },
  );
});

test('15) bozuk yanit: OLMAYAN BIR ONAY varsayilmiyor', async () => {
  const bozukYanitlar: unknown[] = [
    null,
    'onaylandi',
    { state: 'ONAYLANDI' },
    { state: 'APPROVED' }, // checkedAt yok
    { state: 'APPROVED', networkApplicationId: null, message: null, checkedAt: 'dun' },
    { state: 'APPROVED', networkApplicationId: 42, message: null, checkedAt: '2026-09-07T00:00:00Z' },
  ];

  for (const bozuk of bozukYanitlar) {
    const depo = sahteDepo();

    await destekliyorken(
      awinProvider,
      async () => bozuk as ApplicationResult,
      async () => {
        const r = await runProgramApplications({
          candidates: [aday()],
          fetcher: cagrilmamaliFetcher,
          repository: depo.repository,
          ...HIZLI,
        });

        assert.equal(r.outcomes[0]?.errorCategory, 'MALFORMED_RESPONSE', JSON.stringify(bozuk));
        assert.equal(r.outcomes[0]?.newState, null, 'anlasilmayan yanit durum DEGISTIRMEMELI');
        assert.equal(depo.transitions.length, 0);
      },
    );
  }
});

// =========================================================================
// 16-17 — GÜVENLİK
// =========================================================================
test('16) sir maskeleniyor: denetim izine ve loga sizmiyor', async () => {
  const SIR = 'awin-api-key-GERCEK-DEGIL-1234567890';
  clearSecretsForTest();
  registerSecret(SIR);

  const depo = sahteDepo();
  const kayitlar: string[] = [];

  try {
    await destekliyorken(
      awinProvider,
      async () => {
        throw new Error(`istek reddedildi (anahtar: ${SIR})`);
      },
      async () => {
        const r = await runProgramApplications({
          candidates: [aday()],
          fetcher: cagrilmamaliFetcher,
          repository: depo.repository,
          maxRetries: 1,
          ...HIZLI,
          log: (event, data) => kayitlar.push(`${event} ${JSON.stringify(data)}`),
        });

        const hepsi = JSON.stringify({
          outcome: r.outcomes[0],
          claims: depo.claims,
          completions: depo.completions,
          kayitlar,
        });

        assert.ok(!hepsi.includes(SIR), 'sir hicbir cikti yoluna sizmamali');
        assert.match(String(r.outcomes[0]?.detail), /\*\*\*/, 'maskelenmis olmali');
      },
    );
  } finally {
    clearSecretsForTest();
  }
});

test('16b) saglayicinin mesaji da suzgecten geciyor', async () => {
  const SIR = 'postback-secret-GERCEK-DEGIL-abcdef';
  clearSecretsForTest();
  registerSecret(SIR);

  const depo = sahteDepo();

  try {
    await destekliyorken(
      awinProvider,
      async () => sonuc({ state: 'REJECTED', message: `ret: ${SIR}` }),
      async () => {
        const r = await runProgramApplications({
          candidates: [aday()],
          fetcher: cagrilmamaliFetcher,
          repository: depo.repository,
          ...HIZLI,
        });

        assert.ok(!String(r.outcomes[0]?.detail).includes(SIR));
        assert.ok(!JSON.stringify(depo.completions).includes(SIR));
      },
    );
  } finally {
    clearSecretsForTest();
  }
});

test('17) motor fetch CAGIRMIYOR: erisimin tek yolu ProviderContext', async () => {
  const depo = sahteDepo();
  const gercekFetch = globalThis.fetch;
  let globalFetchCagrildi = false;
  globalThis.fetch = (() => {
    globalFetchCagrildi = true;
    throw new Error('merkezi guvenlik atlandi');
  }) as unknown as typeof fetch;

  let verilenCtx: ProviderContext | null = null;

  try {
    await destekliyorken(
      awinProvider,
      async (ctx) => {
        verilenCtx = ctx;
        return sonuc({ state: 'APPLIED' });
      },
      async () => {
        await runProgramApplications({
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

  assert.equal(globalFetchCagrildi, false, 'motor global fetch kullanmamali');
  assert.ok(verilenCtx, 'saglayiciya baglam verilmeli');
  assert.equal(
    (verilenCtx as ProviderContext).fetch,
    cagrilmamaliFetcher,
    'saglayiciya YALNIZCA korumali getirici verilmeli',
  );
});

test('17b) sir DEGERI degil, ORTAM DEGISKENI ADI cozuluyor', async () => {
  const depo = sahteDepo();
  const istenenAdlar: string[] = [];

  await destekliyorken(
    awinProvider,
    async (ctx) => {
      ctx.secret('AWIN_API_KEY');
      return sonuc({ state: 'APPLIED' });
    },
    async () => {
      await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        secret: (ad) => {
          istenenAdlar.push(ad);
          return null; // tanımsız -> sağlayıcı kapalı başarısız olur
        },
        ...HIZLI,
      });
    },
  );

  assert.deepEqual(istenenAdlar, ['AWIN_API_KEY'], 'saglayici yalnizca AD isteyebilir');
});

// =========================================================================
// 18-20 — DENETİM, ONBOARDING SINIRI, KİMLİK
// =========================================================================
test('18) denetim kaydi: ag, program, anahtar, sonuc ve zaman tasiniyor', async () => {
  const depo = sahteDepo();

  await destekliyorken(
    awinProvider,
    async () => sonuc({ state: 'PENDING' }),
    async () => {
      await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        correlationId: 'tur-2026-09-07',
        now: () => '2026-09-07T12:00:00.000Z',
        ...HIZLI,
      });

      const claim = depo.claims[0]!;
      assert.equal(claim.network, 'awin');
      assert.equal(claim.networkProgramId, '158122');
      assert.equal(claim.programId, 'prog-1');
      assert.equal(claim.idempotencyKey, 'apply:awin:158122');
      assert.equal(claim.correlationId, 'tur-2026-09-07');
      assert.equal(claim.result, 'SUBMITTED', 'talep, ISTEK GITMEDEN once yazilmali');
      assert.equal(claim.message, null, 'talep aninda mesaj YOK');

      const tamamlama = depo.completions[0]!;
      assert.equal(tamamlama.key, 'apply:awin:158122');
      assert.equal(tamamlama.outcome.result, 'PENDING');
      assert.equal(tamamlama.outcome.outcomeState, 'PENDING');
      assert.equal(tamamlama.outcome.completedAt, '2026-09-07T12:00:00.000Z');
    },
  );
});

test('18b) veritabani talebi yazamazsa aga ISTEK GITMIYOR', async () => {
  // Kapalı başarısız: denetim izi tutulamıyorsa geri alınamaz bir dış
  // eylem yapılmaz.
  const depo = sahteDepo({ claimHatasi: 'baglanti koptu' });
  let cagrildi = 0;

  await destekliyorken(
    awinProvider,
    async () => {
      cagrildi += 1;
      return sonuc();
    },
    async () => {
      const r = await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: depo.repository,
        ...HIZLI,
      });

      assert.equal(cagrildi, 0, 'denetim izi olmadan basvuru yapilmamali');
      assert.equal(r.outcomes[0]?.status, 'failed');
      assert.equal(r.outcomes[0]?.errorCategory, 'DATABASE_ERROR');
      assert.equal(r.outcomes[0]?.requestSent, false);
    },
  );
});

test('19) motor merchant_id YAZMIYOR: onboarding basvuru turunun isi degil', async () => {
  const yazilanAlanlar: string[] = [];
  const depo = sahteDepo();

  const izleyen: ApplicationRepository = {
    ...depo.repository,
    async transition(programId, state) {
      yazilanAlanlar.push('application_state');
      return depo.repository.transition(programId, state);
    },
  };

  await destekliyorken(
    awinProvider,
    async () => sonuc({ state: 'APPROVED' }),
    async () => {
      await runProgramApplications({
        candidates: [aday()],
        fetcher: cagrilmamaliFetcher,
        repository: izleyen,
        ...HIZLI,
      });
    },
  );

  // Depo sözleşmesi merchant_id'yi zaten TAŞIMIYOR: yazılamaz olması
  // tesadüf değil, arayüzün kendisi bunu imkânsız kılıyor.
  assert.deepEqual(yazilanAlanlar, ['application_state']);
  assert.ok(
    !JSON.stringify(depo.claims).includes('merchant_id'),
    'denetim izi merchant bagi tasimamali',
  );
});

test('20) anahtar ag ve program kimligini BIRLIKTE tasiyor', async () => {
  // Aynı program kimliği farklı ağlarda farklı programdır. Anahtar yalnızca
  // program kimliği olsaydı, bir ağa yapılan başvuru diğerini engellerdi.
  assert.notEqual(basvuruAnahtari('awin', '158122'), basvuruAnahtari('direct', '158122'));
  assert.equal(basvuruAnahtari('awin', '158122'), 'apply:awin:158122');

  const depo = sahteDepo();
  let cagrildi = 0;

  await destekliyorken(
    awinProvider,
    async () => {
      cagrildi += 1;
      return sonuc({ state: 'APPLIED' });
    },
    async () => {
      await destekliyorken(
        directProvider,
        async () => {
          cagrildi += 1;
          return sonuc({ state: 'APPLIED' });
        },
        async () => {
          const r = await runProgramApplications({
            candidates: [
              aday({ programId: 'p-awin', network: 'awin', networkProgramId: '158122' }),
              aday({ programId: 'p-direct', network: 'direct', networkProgramId: '158122' }),
            ],
            fetcher: cagrilmamaliFetcher,
            repository: depo.repository,
            ...HIZLI,
          });

          assert.equal(cagrildi, 2, 'ayni kimlik farkli agda AYRI programdir');
          assert.deepEqual(
            r.outcomes.map((o) => o.status),
            ['submitted', 'submitted'],
          );
          assert.deepEqual(depo.claims.map((c) => c.idempotencyKey).sort(), [
            'apply:awin:158122',
            'apply:direct:158122',
          ]);
        },
      );
    },
  );
});
