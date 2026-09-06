import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runScheduledIngest } from './runner.js';
import type { Fetcher } from './pipeline.js';

/* =========================================================================
 * §48 — ZAMANLANMIŞ ALIM TURU (runner)
 * -------------------------------------------------------------------------
 * Sahtelenen tek şey DIŞ SINIR: Supabase istemcisi ve HTTP getirici.
 * Zincirin kendisi (schedule → kurtarma → worker) gerçek kodla koşuyor.
 *
 * Bu dosyanın kovaladığı tehlikeler, hepsi SESSİZ olanlar:
 *   • aynı turun iki kez yinelenen alım üretmesi
 *   • süre bütçesi dolduğunda işin yarıda kesilip kaybolması
 *   • zamanlayıcı arızasının "0 kaynak bulundu" gibi görünmesi
 *   • ağ erişiminin verilen getiriciyi ATLAYIP SSRF kapısını aşması
 * ========================================================================= */

/** Ağ erişimi olmayan getirici: çağrılırsa test DÜŞER. */
const cagrilmamaliFetcher: Fetcher = {
  fetch: async () => {
    throw new Error('Getirici çağrılmamalıydı: bu turda çalışacak iş yok.');
  },
} as unknown as Fetcher;

/**
 * Sahte Supabase — yalnızca runner'ın dokunduğu yüzey.
 *
 * `claim_jobs` boş dönerse worker hiç iş almaz; böylece turun iskeletini
 * (zamanlama + kurtarma + worker çağrısı) ağ olmadan ölçebiliyoruz.
 */
function sahteSupabase(opts: {
  scheduled?: Array<{ source_id: string; job_id: string; reason: string }>;
  scheduleError?: string;
  recoverError?: string;
  recovered?: number;
  claimed?: unknown[];
}) {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];

  const client = {
    rpc(name: string, args?: unknown) {
      rpcCalls.push({ name, args });

      if (name === 'schedule_due_sources') {
        return Promise.resolve(
          opts.scheduleError
            ? { data: null, error: { message: opts.scheduleError } }
            : { data: opts.scheduled ?? [], error: null },
        );
      }
      if (name === 'recover_orphaned_jobs') {
        return Promise.resolve(
          opts.recoverError
            ? { data: null, error: { message: opts.recoverError } }
            : { data: opts.recovered ?? 0, error: null },
        );
      }
      if (name === 'claim_jobs') {
        return Promise.resolve({ data: opts.claimed ?? [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { client: client as never, rpcCalls };
}

// --- 1) Zincir SIRAYLA çalışıyor -----------------------------------------
// Kurtarma zamanlamadan ÖNCE koşsaydı, o turda yeni açılan işler de
// "yetim" sanılabilirdi.
test('tur: zamanlama -> yetim kurtarma -> worker sirasiyla kosuyor', async () => {
  const { client, rpcCalls } = sahteSupabase({
    scheduled: [{ source_id: 'src-1', job_id: 'job-1', reason: 'plan_zamani_geldi' }],
  });

  const sonuc = await runScheduledIngest({ supabase: client, fetcher: cagrilmamaliFetcher });

  const sira = rpcCalls.map((c) => c.name);
  assert.equal(sira[0], 'schedule_due_sources');
  assert.equal(sira[1], 'recover_orphaned_jobs');
  assert.ok(sira.includes('claim_jobs'), 'worker calistirilmali');
  assert.equal(sonuc.scheduled.length, 1);
  assert.equal(sonuc.scheduled[0]?.sourceId, 'src-1');
});

// --- 2) ZAMANLAYICI ARIZASI SESSİZ KALMAZ --------------------------------
// "0 kaynak bulundu" ile "zamanlayıcı çalışmadı" aynı şey değildir.
// İkincisini birincisi gibi raporlamak, alım hattının aylarca durduğunu
// kimsenin fark etmemesi demekti -- bu depoda bir kez yaşanmış bir hata.
test('zamanlayici RPC duserse tur FIRLATIR (sessizce 0 raporlamaz)', async () => {
  const { client } = sahteSupabase({ scheduleError: 'izin reddedildi' });

  await assert.rejects(
    () => runScheduledIngest({ supabase: client, fetcher: cagrilmamaliFetcher }),
    /Zamanlama yapılamadı/,
  );
});

// --- 3) Yetim kurtarma arızası turu DÜŞÜRMEZ -----------------------------
// Kurtarma bir iyileştirmedir. Düşürseydi tek bir RPC arızası yüzünden
// sağlıklı işler de işlenmezdi.
test('yetim kurtarma duserse tur surer ve bunu raporlar', async () => {
  const { client, rpcCalls } = sahteSupabase({
    scheduled: [],
    recoverError: 'gecici hata',
  });

  const sonuc = await runScheduledIngest({ supabase: client, fetcher: cagrilmamaliFetcher });

  assert.equal(sonuc.orphansRecovered, null, 'arıza null ile bildirilmeli');
  assert.ok(rpcCalls.some((c) => c.name === 'claim_jobs'), 'worker yine de kosmali');
});

test('kurtarilan yetim sayisi raporlaniyor', async () => {
  const { client } = sahteSupabase({ recovered: 3 });
  const sonuc = await runScheduledIngest({ supabase: client, fetcher: cagrilmamaliFetcher });
  assert.equal(sonuc.orphansRecovered, 3);
});

// --- 4) SÜRE BÜTÇESİ -----------------------------------------------------
// Serverless çağrı süre sınırıyla ÖLDÜRÜLÜR. Bütçe dolduğunda yeni iş
// ALINMAMALI; alınsaydı çağrı ortasında kesilir ve iş kirası dolana kadar
// asılı kalırdı.
test('bütce dolunca yeni is ALINMAZ ve bu raporlanir', async () => {
  const { client, rpcCalls } = sahteSupabase({ scheduled: [] });

  // Saat, zamanlama bittikten hemen sonra bütçeyi aşmış görünüyor.
  let t = 0;
  const now = () => {
    t += 1000;
    return t;
  };

  const sonuc = await runScheduledIngest({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    budgetMs: 500,
    now,
  });

  assert.equal(sonuc.budgetExhausted, true, 'bütce dolmus olarak isaretlenmeli');
  assert.equal(
    rpcCalls.filter((c) => c.name === 'claim_jobs').length,
    0,
    'bütce dolduysa hic is alinmamali',
  );
});

test('bütce verilmezse sinir uygulanmaz', async () => {
  const { client, rpcCalls } = sahteSupabase({ scheduled: [] });
  const sonuc = await runScheduledIngest({ supabase: client, fetcher: cagrilmamaliFetcher });

  assert.equal(sonuc.budgetExhausted, false);
  assert.ok(rpcCalls.some((c) => c.name === 'claim_jobs'), 'sinirsizken is alinmali');
});

// --- 5) TEKRARLANABİLİRLİK -----------------------------------------------
// Runner kendi kilidini KURMAZ; korumayı veritabanına bırakır. Bu test o
// sözleşmeyi kilitler: aynı tur iki kez koştuğunda runner fazladan bir iş
// UYDURMAZ, yalnızca zamanlayıcının döndürdüğünü raporlar.
test('ikinci tur zamanlayici bos donerse fazladan is uretmez', async () => {
  const ilk = sahteSupabase({
    scheduled: [{ source_id: 'src-1', job_id: 'job-1', reason: 'plan_zamani_geldi' }],
  });
  const ilkSonuc = await runScheduledIngest({
    supabase: ilk.client,
    fetcher: cagrilmamaliFetcher,
  });

  // Açık iş varken `schedule_due_sources` o kaynağı ATLAR -> bos liste.
  const ikinci = sahteSupabase({ scheduled: [] });
  const ikinciSonuc = await runScheduledIngest({
    supabase: ikinci.client,
    fetcher: cagrilmamaliFetcher,
  });

  assert.equal(ilkSonuc.scheduled.length, 1);
  assert.equal(ikinciSonuc.scheduled.length, 0, 'ayni kaynak ikinci kez kuyruga alinmamali');
});

// --- 6) AĞ ERİŞİMİ YALNIZCA VERİLEN GETİRİCİDEN -------------------------
// Runner `fetch` çağırmaz; çağırsaydı SSRF kapısını, gövde boyutu sınırını
// ve nezaket gecikmesini ATLARDI. Çalışacak iş yokken getiricinin hiç
// dokunulmaması bunu gösterir (getirici çağrılırsa fırlatıyor).
test('calisacak is yokken getiriciye HIC dokunulmuyor', async () => {
  const { client } = sahteSupabase({ scheduled: [], claimed: [] });
  const sonuc = await runScheduledIngest({ supabase: client, fetcher: cagrilmamaliFetcher });

  assert.equal(sonuc.worker.claimed, 0);
  assert.equal(sonuc.summaries.length, 0);
});

// --- 7) Gözlemlenebilirlik -----------------------------------------------
test('olaylar log geri cagrisina yaziliyor', async () => {
  const { client } = sahteSupabase({ scheduled: [], recovered: 2 });
  const olaylar: string[] = [];

  await runScheduledIngest({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    log: (event) => olaylar.push(event),
  });

  assert.ok(olaylar.includes('ingest.scheduled'), 'zamanlama olayi yazilmali');
  assert.ok(olaylar.includes('ingest.orphans_recovered'), 'kurtarma olayi yazilmali');
});

test('sonuc sure ve worker ozetini tasiyor', async () => {
  const { client } = sahteSupabase({ scheduled: [] });
  const sonuc = await runScheduledIngest({ supabase: client, fetcher: cagrilmamaliFetcher });

  assert.equal(typeof sonuc.durationMs, 'number');
  assert.equal(typeof sonuc.worker.claimed, 'number');
  assert.equal(typeof sonuc.worker.failed, 'number');
});
