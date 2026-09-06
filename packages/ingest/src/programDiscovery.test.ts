import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runProgramDiscovery } from './programDiscovery.js';
import type { ProviderFetcher } from '@ohaaaa/shared/providers';

/* =========================================================================
 * §50 — PROGRAM KEŞİF TURU
 * -------------------------------------------------------------------------
 * Kovalanan tehlikeler, hepsi SESSİZ olanlar:
 *   • sözleşmesi doğrulanmamış bir ağın "0 program" gibi görünmesi
 *   • aynı programın her turda yeniden eklenmesi (duplicate)
 *   • bozuk tek bir kaydın tüm turu düşürmesi
 *   • sağlayıcının kendi fetch'ini kullanıp SSRF kapısını atlaması
 * ========================================================================= */

/** Ağa dokunulursa test DÜŞER. */
const cagrilmamaliFetcher: ProviderFetcher = {
  get: async () => {
    throw new Error('Getirici cagrilmamaliydi: hicbir agin kesfi desteklenmiyor.');
  },
};

/** `programs` yazmalarını yakalayan sahte Supabase. */
function sahteSupabase(opts: { mevcut?: Array<{ network: string; id: string }> } = {}) {
  const upserts: unknown[][] = [];

  const client = {
    from(table: string) {
      assert.equal(table, 'programs', 'kesif yalnizca programs tablosuna yazmali');
      return {
        select() {
          const chain = {
            in() {
              return chain;
            },
            then(resolve: (v: unknown) => void) {
              resolve({
                data: (opts.mevcut ?? []).map((m) => ({
                  network: m.network,
                  network_program_id: m.id,
                })),
                error: null,
              });
            },
          };
          return chain;
        },
        upsert(rows: unknown[]) {
          upserts.push(rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { client: client as never, upserts };
}

// --- 1) SÖZLEŞMESİ DOĞRULANMAMIŞ AĞ "0 PROGRAM" DEĞİL -------------------
// Bu testin kilitlediği ayrım, bu aşamanın tamamının dayanağı: "bakmadık"
// ile "bakıp bir şey bulamadık" aynı sonuç DEĞİL.
test('kesfi desteklemeyen ag unavailable olarak raporlaniyor, 0 program degil', async () => {
  const { client, upserts } = sahteSupabase();

  const sonuc = await runProgramDiscovery({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    networks: ['awin'],
  });

  const awin = sonuc.outcomes.find((o) => o.network === 'awin');
  assert.equal(awin?.status, 'unavailable', 'awin kesfi dogrulanmadi -> unavailable');
  assert.equal(awin?.programCount, 0);
  assert.equal(upserts.length, 0, 'hicbir sey yazilmamali');
});

test('elle yapilan ag manual_required olarak raporlaniyor', async () => {
  const { client } = sahteSupabase();

  const sonuc = await runProgramDiscovery({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    networks: ['direct'],
  });

  assert.equal(sonuc.outcomes[0]?.status, 'manual_required');
});

// --- 2) İKİSİ AYRI SAYILIYOR --------------------------------------------
test('manual_required ile unavailable ayri statuler', async () => {
  const { client } = sahteSupabase();
  const sonuc = await runProgramDiscovery({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    networks: ['direct', 'awin'],
  });

  const durumlar = Object.fromEntries(sonuc.outcomes.map((o) => [o.network, o.status]));
  assert.equal(durumlar.direct, 'manual_required');
  assert.equal(durumlar.awin, 'unavailable');
});

// --- 3) BİLİNMEYEN AĞ FAIL-CLOSED ---------------------------------------
test('bilinmeyen ag varsayilana DUSMUYOR', async () => {
  const { client, upserts } = sahteSupabase();

  const sonuc = await runProgramDiscovery({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    networks: ['kayitsiz-ag'],
  });

  assert.equal(sonuc.outcomes[0]?.status, 'failed');
  assert.match(String(sonuc.outcomes[0]?.detail), /Taninmayan ortaklik agi/);
  assert.equal(upserts.length, 0);
});

// --- 4) BİR AĞIN DÜŞMESİ DİĞERLERİNİ DURDURMUYOR ------------------------
// Tek bir ağın API'si bozuk diye tüm turun iptal olması, çalışan ağların
// keşfini de kaybetmek olurdu.
test('bir ag duserse tur devam ediyor', async () => {
  const { client } = sahteSupabase();
  const sonuc = await runProgramDiscovery({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    networks: ['kayitsiz-ag', 'direct', 'awin'],
  });

  assert.equal(sonuc.outcomes.length, 3, 'uc agin da sonucu olmali');
});

// --- 5) AĞA HİÇ DOKUNULMUYOR --------------------------------------------
// Sağlayıcılar `ProviderContext` dışında ağa çıkamaz; hiçbiri keşfi
// desteklemediği için getirici hiç çağrılmamalı (çağrılırsa fırlatıyor).
test('desteklenmeyen aglarda getiriciye HIC dokunulmuyor', async () => {
  const { client } = sahteSupabase();
  const sonuc = await runProgramDiscovery({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    networks: knownAll(),
  });

  assert.equal(sonuc.totalPrograms, 0);
  assert.equal(sonuc.totalFirstSeen, 0);
});

// --- 6) Gözlemlenebilirlik ----------------------------------------------
test('atlanan aglar sebebiyle birlikte loglaniyor', async () => {
  const { client } = sahteSupabase();
  const olaylar: Array<{ event: string; data: Record<string, unknown> }> = [];

  await runProgramDiscovery({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    networks: ['awin'],
    log: (event, data) => olaylar.push({ event, data }),
  });

  const atlandi = olaylar.find((o) => o.event === 'discovery.skipped');
  assert.equal(atlandi?.data.reason, 'capability_unavailable');
});

test('tur suresi ve toplamlar raporlaniyor', async () => {
  const { client } = sahteSupabase();
  const sonuc = await runProgramDiscovery({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    networks: ['awin'],
  });

  assert.equal(typeof sonuc.durationMs, 'number');
  assert.equal(sonuc.totalPrograms, 0);
});

function knownAll(): string[] {
  return ['awin', 'direct'];
}
