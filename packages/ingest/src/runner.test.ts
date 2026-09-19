import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runScheduledIngest, VARSAYILAN_IS_ZAMAN_ASIMI_MS } from './runner.js';
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

/* =========================================================================
 * §49 — İŞ ZAMAN AŞIMI
 * -------------------------------------------------------------------------
 * ÜRETİMDE YAŞANAN ARIZANIN KİLİDİ.
 *
 * `runWorkerOnce`'ın kendi varsayılanı 30 sn ve bu çağrı onu GEÇMİYORDU.
 * Ölçülen tam senkron ise 373,6 sn (ingest_runs, 2026-09-12 16:30, 35.762
 * kalem). Sonuç: her deneme 30. saniyede `is_zaman_asimi` ile düştü, iş
 * beş denemede ölü mektuba gitti ve katalog altı gün dondu.
 *
 * Aşağıdaki testler DEĞERİN AKTARILDIĞINI davranışla ölçüyor, "bir şey
 * geçiliyor mu" diye bakmıyor: yalnızca çözülen sayıyı loglayan bir test
 * yazıldı ve `runWorkerOnce` çağrısından `jobTimeoutMs` silinince YİNE
 * GEÇTİ -- yani hiçbir şey korumuyordu. Ölçüt, işin HANGİ SEBEPLE
 * düştüğü olmalı.
 * ========================================================================= */

/**
 * Kaynak okuması YAVAŞ olan sahte Supabase.
 *
 * Gecikme `from('sources')` tarafında: handler kaynağı çözmeden hiçbir şey
 * yapamaz, dolayısıyla işin süresi buradan kontrol edilebiliyor ve ağa
 * hiç çıkılmıyor.
 */
function sahteYavasSupabase(gecikmeMs: number) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const kaynakSorgusu = () => {
    // PostgREST oluşturucusu "thenable"dır: zincirin sonunda await edilir.
    const zincir = {
      select: () => zincir,
      eq: () => zincir,
      then: (
        cozum: (v: { data: unknown[]; error: null }) => unknown,
      ) => new Promise((r) => setTimeout(r, gecikmeMs)).then(() =>
        // Boş dizi = "kaynak bulunamadı": handler PermanentJobError atar.
        // Zaman aşımından FARKLI bir mesaj, ayrımı ölçebilmemizin sebebi bu.
        cozum({ data: [], error: null }),
      ),
    };
    return zincir;
  };

  const client = {
    rpc(name: string, args?: Record<string, unknown>) {
      rpcCalls.push({ name, args: args ?? {} });

      if (name === 'schedule_due_sources') return Promise.resolve({ data: [], error: null });
      if (name === 'recover_orphaned_jobs') return Promise.resolve({ data: 0, error: null });
      if (name === 'claim_jobs') {
        return Promise.resolve({
          data: [
            {
              id: 'job-yavas',
              kind: 'SOURCE_SYNC',
              payload: { source_id: 'src-yavas' },
              attempt: 1,
              source_id: 'src-yavas',
              market_code: 'UK',
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(tablo: string) {
      if (tablo === 'sources') return kaynakSorgusu();
      throw new Error(`Beklenmeyen tablo: ${tablo}`);
    },
  };

  /** İşin başarısız işaretlenme SEBEBİ. */
  const dusmeSebebi = () =>
    String(rpcCalls.find((c) => c.name === 'fail_job')?.args.p_error ?? '');

  return { client: client as never, rpcCalls, dusmeSebebi };
}

// Tavanın ALTINDA kalan iş, zaman aşımına UĞRAMAMALI.
// Bu test, düzeltme geri alındığında düşen testtir: `jobTimeoutMs`
// aktarılmazsa 30 sn varsayılanı geçerli olur ve 20 ms'lik tavan hiç
// uygulanmaz.
test('is zaman asimi worker\'a AKTARILIYOR: dar tavan isi kesiyor', async () => {
  const { client, dusmeSebebi } = sahteYavasSupabase(120);

  const sonuc = await runScheduledIngest({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    jobTimeoutMs: 20,
  });

  assert.equal(sonuc.worker.failed, 1, 'is basarisiz sayilmali');
  assert.match(
    dusmeSebebi(),
    /is_zaman_asimi/,
    '20 ms tavan 120 ms suren isi KESMELIYDI -- kesmediyse tavan worker\'a hic ulasmiyor',
  );
});

// Aynı iş, GENİŞ tavanla zaman aşımına uğramamalı: yoksa yukarıdaki test
// "her hâlükârda zaman aşımı" diye de geçerdi ve hiçbir şey kanıtlamazdı.
test('genis tavanda ayni is zaman asimina UGRAMIYOR', async () => {
  const { client, dusmeSebebi } = sahteYavasSupabase(120);

  await runScheduledIngest({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    jobTimeoutMs: 5_000,
  });

  const sebep = dusmeSebebi();
  assert.doesNotMatch(sebep, /is_zaman_asimi/, 'genis tavanda zaman asimi olmamali');
  assert.match(sebep, /Kaynak bulunamadı/, 'is kendi gercek sebebiyle dusmeli');
});

// Bütçesiz çağıran (CLI / GitHub Actions) ölçülen senkrona yeten tavanı alır.
test('butcesiz cagiran olculen senkrona yeten varsayilani aliyor', async () => {
  const { client } = sahteSupabase({ scheduled: [] });
  const olaylar: Array<Record<string, unknown>> = [];

  await runScheduledIngest({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    log: (_event, veri) => olaylar.push(veri),
  });

  const baslatma = olaylar.find((o) => 'jobTimeoutMs' in o);
  assert.ok(baslatma, 'worker baslatma olayi zaman asimini yazmali');
  assert.equal(baslatma.jobTimeoutMs, VARSAYILAN_IS_ZAMAN_ASIMI_MS);

  // Ölçülen tam senkron 373,6 sn. Tavan bunun altına inerse alım yine
  // sessizce ölür; sayıyı doğrudan sınırlıyoruz.
  assert.ok(
    VARSAYILAN_IS_ZAMAN_ASIMI_MS > 374_000,
    'varsayilan, olculen tam senkrondan (373,6 sn) uzun olmali',
  );
});

// Serverless çağıran için tavan BÜTÇE olmalı: aksi halde iş, kendisini
// çalıştıran fonksiyondan uzun yaşar, çağrı öldürülür ve iş kira dolana
// kadar asılı kalır.
test('butce bildiren cagiranda is butceyi asamiyor', async () => {
  const { client } = sahteSupabase({ scheduled: [] });
  const olaylar: Array<Record<string, unknown>> = [];

  await runScheduledIngest({
    supabase: client,
    fetcher: cagrilmamaliFetcher,
    budgetMs: 45_000,
    log: (_event, veri) => olaylar.push(veri),
  });

  assert.equal(olaylar.find((o) => 'jobTimeoutMs' in o)?.jobTimeoutMs, 45_000);
});
