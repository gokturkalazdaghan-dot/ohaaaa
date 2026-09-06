import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  awinProvider,
  type CapabilitySupport,
  type DiscoveryPage,
  type NormalizedProgram,
  type ProviderContext,
  type ProviderFetcher,
} from '@ohaaaa/shared/providers';

import { kesifAnahtari, runProgramDiscovery } from './programDiscovery.js';
import type {
  DiscoveryRepository,
  DiscoveryRunClaim,
  DiscoveryRunOutcome,
} from './discoveryRepository.js';
import { clearSecretsForTest, registerSecret } from './http/redact.js';

/* =========================================================================
 * AŞAMA 8 — KEŞİF ÖLÇEĞİ
 * -------------------------------------------------------------------------
 * Kovalanan tehlikeler, hepsi yalnız ÖLÇEKTE görünenler:
 *   • her turun yalnız ilk sayfayı taraması (imleç yok)
 *   • yarıda kalan turda imlecin ilerlemesi -> sayfalar sonsuza kadar atlanır
 *   • tek dev INSERT: düştüğünde hiçbir şey yazılmamış olur
 *   • iki zamanlayıcının aynı anda aynı ağa gitmesi
 *   • bozuk satırların sessizce kaybolması
 * ========================================================================= */

const cagrilmamaliFetcher: ProviderFetcher = {
  get: async () => {
    throw new Error('Getirici motordan cagrilmamaliydi.');
  },
};

function program(id: string): NormalizedProgram {
  return {
    network: 'awin',
    networkProgramId: id,
    merchantName: `Program ${id}`,
    homepageUrl: null,
    countryCode: null,
    marketCode: null,
    currency: null,
    commissionRate: null,
    cookieWindowDays: null,
    feedAvailable: null,
    productCount: null,
    applicationSupported: null,
    deeplinkSupported: null,
    terms: null,
    networkStatus: null,
    lastVerifiedAt: '2026-09-07T00:00:00.000Z',
  };
}

/** `programs` yazmalarını ve partileri yakalayan sahte Supabase. */
function sahteSupabase() {
  const partiler: unknown[][] = [];
  const mevcut = new Set<string>();

  const client = {
    from() {
      return {
        select() {
          const chain = {
            in: () => chain,
            then(resolve: (v: unknown) => void) {
              resolve({ data: [...mevcut].map((k) => {
                const [network, id] = k.split('|');
                return { network, network_program_id: id };
              }), error: null });
            },
          };
          return chain;
        },
        upsert(rows: Array<Record<string, unknown>>) {
          partiler.push(rows);
          for (const r of rows) mevcut.add(`${String(r.network)}|${String(r.network_program_id)}`);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { client: client as never, partiler };
}

function sahteDiscoveryDepo(opts: { claimHatasi?: string } = {}) {
  const anahtarlar = new Set<string>();
  const claims: DiscoveryRunClaim[] = [];
  const completions: Array<{ key: string; outcome: DiscoveryRunOutcome }> = [];
  const cursors: Array<{ network: string; cursor: string | null }> = [];

  const repository: DiscoveryRepository = {
    async claimRun(claim) {
      if (opts.claimHatasi) throw new Error(opts.claimHatasi);
      if (anahtarlar.has(claim.idempotencyKey)) return false;
      anahtarlar.add(claim.idempotencyKey);
      claims.push(claim);
      return true;
    },
    async completeRun(key, outcome) {
      completions.push({ key, outcome });
    },
    async saveCursor(network, cursor) {
      cursors.push({ network, cursor });
    },
  };

  return { repository, claims, completions, cursors, anahtarlar };
}

async function kesifDestekliyorken(
  fn: NonNullable<typeof awinProvider.discoverProgramsPage>,
  govde: () => Promise<void>,
  destek: CapabilitySupport = 'supported',
): Promise<void> {
  const y = awinProvider.capabilities as Record<string, CapabilitySupport>;
  const eskiDestek = y.program_discovery as CapabilitySupport;
  const eskiMetot = awinProvider.discoverProgramsPage;

  y.program_discovery = destek;
  (awinProvider as { discoverProgramsPage?: unknown }).discoverProgramsPage = fn;

  try {
    await govde();
  } finally {
    y.program_discovery = eskiDestek;
    (awinProvider as { discoverProgramsPage?: unknown }).discoverProgramsPage = eskiMetot;
  }
}

const HIZLI = { minDelayMs: 0, retryBaseMs: 0, sleep: async () => {} };

// =========================================================================
// SAYFALAMA VE İMLEÇ
// =========================================================================
test('1) SAYFA SAYFA taranıyor; imleç her sayfada ilerliyor', async () => {
  const { client, partiler } = sahteSupabase();
  const depo = sahteDiscoveryDepo();
  const gorulenImlecler: Array<string | null> = [];

  await kesifDestekliyorken(
    async (_ctx, cursor): Promise<DiscoveryPage> => {
      gorulenImlecler.push(cursor);
      if (cursor === null) return { programs: [program('1'), program('2')], nextCursor: 's2' };
      if (cursor === 's2') return { programs: [program('3')], nextCursor: 's3' };
      return { programs: [program('4')], nextCursor: null };
    },
    async () => {
      const r = await runProgramDiscovery({
        supabase: client,
        discoveryRepository: depo.repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        ...HIZLI,
      });

      assert.deepEqual(gorulenImlecler, [null, 's2', 's3']);
      assert.equal(r.outcomes[0]?.status, 'discovered');
      assert.equal(r.outcomes[0]?.pagesFetched, 3);
      assert.equal(r.outcomes[0]?.programCount, 4);
      assert.equal(r.outcomes[0]?.cursorEnd, null, 'katalogun sonuna ulaşıldı');
      assert.equal(partiler.flat().length, 4);
    },
  );
});

test('2) SAYFA KOTASI dolunca tur PARTIAL; imleç saklanıyor', async () => {
  // Kota olmasaydı milyonlarca sayfalı bir ağ turu süresiz bloke ederdi.
  const { client } = sahteSupabase();
  const depo = sahteDiscoveryDepo();

  await kesifDestekliyorken(
    async (_ctx, cursor) => ({
      programs: [program(String(cursor ?? '0'))],
      nextCursor: `s${Number(cursor ?? 0) + 1}`,
    }),
    async () => {
      const r = await runProgramDiscovery({
        supabase: client,
        discoveryRepository: depo.repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        maxPagesPerNetwork: 3,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.status, 'partial');
      assert.equal(r.outcomes[0]?.pagesFetched, 3);
      assert.notEqual(r.outcomes[0]?.cursorEnd, null, 'kaldığı yer saklanmalı');
      assert.equal(depo.completions[0]?.outcome.status, 'partial');
    },
  );
});

test('3) İMLEÇ SAYFA YAZILDIKTAN SONRA ilerliyor', async () => {
  // Önce ilerletilseydi, yazma düştüğünde o sayfa sonsuza kadar atlanırdı.
  const { client } = sahteSupabase();
  const depo = sahteDiscoveryDepo();

  await kesifDestekliyorken(
    async (_ctx, cursor) => (cursor === null
      ? { programs: [program('1')], nextCursor: 's2' }
      : { programs: [program('2')], nextCursor: null }),
    async () => {
      await runProgramDiscovery({
        supabase: client,
        discoveryRepository: depo.repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        ...HIZLI,
      });

      assert.deepEqual(depo.cursors, [
        { network: 'awin', cursor: 's2' },
        { network: 'awin', cursor: null },
      ]);
    },
  );
});

test('4) verilen imleçten devam ediliyor — baştan başlanmıyor', async () => {
  const { client } = sahteSupabase();
  const depo = sahteDiscoveryDepo();
  let ilkImlec: string | null | undefined;

  await kesifDestekliyorken(
    async (_ctx, cursor) => {
      ilkImlec ??= cursor;
      return { programs: [program('1')], nextCursor: null };
    },
    async () => {
      await runProgramDiscovery({
        supabase: client,
        discoveryRepository: depo.repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        cursors: { awin: 'kaldigim-yer' },
        ...HIZLI,
      });

      assert.equal(ilkImlec, 'kaldigim-yer');
      assert.equal(depo.claims[0]?.cursorStart, 'kaldigim-yer');
    },
  );
});

// =========================================================================
// PARTİ VE İDEMPOTENCY
// =========================================================================
test('5) yazma PARTİLERE bölünüyor — tek dev INSERT yok', async () => {
  const { client, partiler } = sahteSupabase();
  const depo = sahteDiscoveryDepo();
  const cok = Array.from({ length: 25 }, (_, i) => program(`p${i}`));

  await kesifDestekliyorken(
    async () => ({ programs: cok, nextCursor: null }),
    async () => {
      const r = await runProgramDiscovery({
        supabase: client,
        discoveryRepository: depo.repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        writeBatchSize: 10,
        ...HIZLI,
      });

      assert.deepEqual(partiler.map((p) => p.length), [10, 10, 5]);
      assert.equal(r.outcomes[0]?.programCount, 25, 'hiçbir satır kaybolmamalı');
    },
  );
});

test('6) EŞZAMANLI iki tur: ağa TEK tarama gidiyor', async () => {
  const { client } = sahteSupabase();
  const depo = sahteDiscoveryDepo();
  let cagrildi = 0;

  await kesifDestekliyorken(
    async () => {
      cagrildi += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { programs: [program('1')], nextCursor: null };
    },
    async () => {
      const tur = () =>
        runProgramDiscovery({
          supabase: client,
          discoveryRepository: depo.repository,
          fetcher: cagrilmamaliFetcher,
          networks: ['awin'],
          now: () => '2026-09-07T12:00:00.000Z',
          ...HIZLI,
        });

      const [a, b] = await Promise.all([tur(), tur()]);
      const statuler = [a.outcomes[0]?.status, b.outcomes[0]?.status].sort();

      assert.deepEqual(statuler, ['discovered', 'duplicate']);
      assert.equal(cagrildi, 1, 'aynı ağa iki tarama gitmemeli');
      assert.equal(depo.claims.length, 1);
    },
  );
});

test('7) tur anahtarı ağ + imleç + pencere taşıyor', () => {
  assert.equal(kesifAnahtari('awin', null, '2026-09-07T12'), 'discover:awin:bas:2026-09-07T12');
  assert.notEqual(kesifAnahtari('awin', 's2', 'p'), kesifAnahtari('awin', 's3', 'p'));
  assert.notEqual(kesifAnahtari('awin', null, 'p'), kesifAnahtari('cj', null, 'p'));
});

test('8) veritabanı turu talep edemezse ağa istek GİTMİYOR', async () => {
  const { client } = sahteSupabase();
  const depo = sahteDiscoveryDepo({ claimHatasi: 'baglanti koptu' });
  let cagrildi = 0;

  await kesifDestekliyorken(
    async () => {
      cagrildi += 1;
      return { programs: [], nextCursor: null };
    },
    async () => {
      const r = await runProgramDiscovery({
        supabase: client,
        discoveryRepository: depo.repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        ...HIZLI,
      });

      assert.equal(cagrildi, 0, 'denetim izi olmadan tarama yapılmamalı');
      assert.equal(r.outcomes[0]?.status, 'failed');
      assert.equal(r.outcomes[0]?.errorCategory, 'DATABASE_ERROR');
    },
  );
});

// =========================================================================
// HATA, RETRY, HIZ SINIRI
// =========================================================================
test('9) 429 ve 5xx GEÇİCİ: üstel geri çekilmeyle yeniden deneniyor', async () => {
  const { client } = sahteSupabase();
  const beklemeler: number[] = [];

  await kesifDestekliyorken(
    async () => {
      throw Object.assign(new Error('cok istek'), { status: 429 });
    },
    async () => {
      const r = await runProgramDiscovery({
        supabase: client,
        discoveryRepository: sahteDiscoveryDepo().repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        maxRetries: 4,
        retryBaseMs: 100,
        minDelayMs: 0,
        sleep: async (ms) => {
          beklemeler.push(ms);
        },
      });

      assert.deepEqual(beklemeler, [100, 200, 400]);
      assert.equal(r.outcomes[0]?.errorCategory, 'RATE_LIMITED');
      assert.equal(r.outcomes[0]?.status, 'failed');
    },
  );
});

test('10) 4xx KALICI: yeniden denenmiyor', async () => {
  const { client } = sahteSupabase();
  let cagrildi = 0;

  await kesifDestekliyorken(
    async () => {
      cagrildi += 1;
      throw Object.assign(new Error('yasak'), { status: 403 });
    },
    async () => {
      await runProgramDiscovery({
        supabase: client,
        discoveryRepository: sahteDiscoveryDepo().repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        maxRetries: 4,
        ...HIZLI,
      });
      assert.equal(cagrildi, 1);
    },
  );
});

test('11) ZAMAN AŞIMI: asılı sayfa turu bloke etmiyor', async () => {
  const { client } = sahteSupabase();

  await kesifDestekliyorken(
    () => new Promise<DiscoveryPage>(() => {}),
    async () => {
      const r = await runProgramDiscovery({
        supabase: client,
        discoveryRepository: sahteDiscoveryDepo().repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        timeoutMs: 20,
        maxRetries: 2,
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.errorCategory, 'TIMEOUT');
    },
  );
});

test('12) NEZAKET GECİKMESİ sayfalar arasında uygulanıyor', async () => {
  const { client } = sahteSupabase();
  const beklemeler: number[] = [];

  await kesifDestekliyorken(
    async (_ctx, cursor) => (cursor === null
      ? { programs: [program('1')], nextCursor: 's2' }
      : { programs: [program('2')], nextCursor: null }),
    async () => {
      await runProgramDiscovery({
        supabase: client,
        discoveryRepository: sahteDiscoveryDepo().repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        minDelayMs: 250,
        retryBaseMs: 0,
        sleep: async (ms) => {
          beklemeler.push(ms);
        },
      });

      assert.deepEqual(beklemeler, [250], 'ilk sayfadan sonra bir kez beklendi');
    },
  );
});

// =========================================================================
// SESSİZ KAYIP VE YETENEK AYRIMI
// =========================================================================
test('13) bozuk satırlar SAYILIYOR — sessiz kayıp yok', async () => {
  const { client } = sahteSupabase();
  const depo = sahteDiscoveryDepo();

  await kesifDestekliyorken(
    async () => ({
      programs: [
        program('iyi'),
        { ...program('kotu'), networkProgramId: '   ' },
        { ...program('kotu2'), merchantName: '' },
      ],
      nextCursor: null,
    }),
    async () => {
      const r = await runProgramDiscovery({
        supabase: client,
        discoveryRepository: depo.repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        ...HIZLI,
      });

      assert.equal(r.outcomes[0]?.malformedDropped, 2);
      assert.equal(r.outcomes[0]?.programCount, 1, 'bozuk satır tüm partiyi düşürmemeli');
      assert.equal(r.totalMalformedDropped, 2);
      assert.equal(depo.completions[0]?.outcome.malformedDropped, 2);
    },
  );
});

test('14) bozuk SAYFA yanıtı durum değiştirmiyor', async () => {
  const { client } = sahteSupabase();

  for (const bozuk of [null, 'sayfa', { programs: 'x', nextCursor: null }, { nextCursor: 5 }]) {
    await kesifDestekliyorken(
      async () => bozuk as unknown as DiscoveryPage,
      async () => {
        const r = await runProgramDiscovery({
          supabase: client,
          discoveryRepository: sahteDiscoveryDepo().repository,
          fetcher: cagrilmamaliFetcher,
          networks: ['awin'],
          ...HIZLI,
        });

        assert.equal(r.outcomes[0]?.errorCategory, 'MALFORMED_RESPONSE', JSON.stringify(bozuk));
        assert.equal(r.outcomes[0]?.programCount, 0);
      },
    );
  }
});

test('15) üç yetenek durumu AYRI raporlanıyor ve turu düşürmüyor', async () => {
  const { client } = sahteSupabase();
  const depo = sahteDiscoveryDepo();

  const r = await runProgramDiscovery({
    supabase: client,
    discoveryRepository: depo.repository,
    fetcher: cagrilmamaliFetcher,
    networks: ['awin', 'direct', 'kayitsiz-ag', 'cj'],
    ...HIZLI,
  });

  const d = Object.fromEntries(r.outcomes.map((o) => [o.network, o.status]));
  assert.equal(d.awin, 'unavailable');
  assert.equal(d.direct, 'manual_required');
  assert.equal(d.cj, 'unavailable');
  assert.equal(d['kayitsiz-ag'], 'failed');
  assert.equal(r.outcomes.length, 4, 'bir ağın düşmesi diğerlerini durdurmamalı');

  // Engel de denetim izine yazılıyor: "hiç denenmedi" ile "denendi ve
  // olmadı" ayrımı kayıtta kalmalı.
  assert.equal(depo.completions.length, 4);
  assert.equal(
    depo.completions.find((c) => c.key.includes(':direct:'))?.outcome.status,
    'manual_required',
  );
});

test('16) sağlayıcıya YALNIZ korumalı getirici veriliyor; motor fetch çağırmıyor', async () => {
  const { client } = sahteSupabase();
  const gercek = globalThis.fetch;
  let globalCagrildi = false;
  globalThis.fetch = (() => {
    globalCagrildi = true;
    throw new Error('merkezi guvenlik atlandi');
  }) as unknown as typeof fetch;

  let verilen: ProviderContext | null = null;

  try {
    await kesifDestekliyorken(
      async (ctx) => {
        verilen = ctx;
        return { programs: [], nextCursor: null };
      },
      async () => {
        await runProgramDiscovery({
          supabase: client,
          discoveryRepository: sahteDiscoveryDepo().repository,
          fetcher: cagrilmamaliFetcher,
          networks: ['awin'],
          ...HIZLI,
        });
      },
    );
  } finally {
    globalThis.fetch = gercek;
  }

  assert.equal(globalCagrildi, false);
  assert.equal((verilen as unknown as ProviderContext).fetch, cagrilmamaliFetcher);
});

test('17) sır denetim izine ve loga sızmıyor', async () => {
  const SIR = 'discovery-key-GERCEK-DEGIL-9876543210';
  clearSecretsForTest();
  registerSecret(SIR);

  const { client } = sahteSupabase();
  const depo = sahteDiscoveryDepo();
  const kayitlar: string[] = [];

  try {
    await kesifDestekliyorken(
      async () => {
        throw new Error(`kesif reddedildi (anahtar: ${SIR})`);
      },
      async () => {
        const r = await runProgramDiscovery({
          supabase: client,
          discoveryRepository: depo.repository,
          fetcher: cagrilmamaliFetcher,
          networks: ['awin'],
          maxRetries: 1,
          ...HIZLI,
          log: (e, d) => kayitlar.push(`${e} ${JSON.stringify(d)}`),
        });

        const hepsi = JSON.stringify({ r, depo: depo.completions, kayitlar });
        assert.ok(!hepsi.includes(SIR), 'sır hiçbir çıktı yoluna sızmamalı');
      },
    );
  } finally {
    clearSecretsForTest();
  }
});

test('18) denetim izi sayaçları raporla TUTUYOR', async () => {
  const { client } = sahteSupabase();
  const depo = sahteDiscoveryDepo();

  await kesifDestekliyorken(
    async (_ctx, cursor) => (cursor === null
      ? { programs: [program('1'), program('2')], nextCursor: 's2' }
      : { programs: [program('3')], nextCursor: null }),
    async () => {
      await runProgramDiscovery({
        supabase: client,
        discoveryRepository: depo.repository,
        fetcher: cagrilmamaliFetcher,
        networks: ['awin'],
        correlationId: 'tur-1',
        ...HIZLI,
      });

      const o = depo.completions[0]!.outcome;
      assert.equal(o.status, 'completed');
      assert.equal(o.pagesFetched, 2);
      assert.equal(o.programsSeen, 3);
      assert.equal(o.programsWritten, 3);
      assert.equal(o.cursorEnd, null);
      assert.equal(depo.claims[0]?.correlationId, 'tur-1');
    },
  );
});

test('19) sayfasız sağlayıcı (discoverPrograms) hâlâ çalışıyor', async () => {
  // Geriye uyum: küçük ağlar tek dizi döndürmeye devam edebilir.
  const { client } = sahteSupabase();
  const y = awinProvider.capabilities as Record<string, CapabilitySupport>;
  const eskiDestek = y.program_discovery as CapabilitySupport;
  const eskiMetot = awinProvider.discoverPrograms;

  y.program_discovery = 'supported';
  (awinProvider as { discoverPrograms?: unknown }).discoverPrograms = async () => [
    program('tek'),
  ];

  try {
    const r = await runProgramDiscovery({
      supabase: client,
      discoveryRepository: sahteDiscoveryDepo().repository,
      fetcher: cagrilmamaliFetcher,
      networks: ['awin'],
      ...HIZLI,
    });

    assert.equal(r.outcomes[0]?.status, 'discovered');
    assert.equal(r.outcomes[0]?.programCount, 1);
    assert.equal(r.outcomes[0]?.cursorEnd, null);
  } finally {
    y.program_discovery = eskiDestek;
    (awinProvider as { discoverPrograms?: unknown }).discoverPrograms = eskiMetot;
  }
});
