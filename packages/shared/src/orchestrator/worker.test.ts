import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PermanentJobError,
  runWorkerOnce,
  type QueueJob,
  type QueueRepository,
} from './worker.js';

function sahteDepo(isler: QueueJob[]) {
  const cagrilar = {
    completed: [] as string[],
    failed: [] as Array<{ id: string; error: string; permanent: boolean }>,
  };
  const repository: QueueRepository = {
    async claim(limit) {
      return isler.splice(0, limit);
    },
    async complete(id) {
      cagrilar.completed.push(id);
    },
    async fail(id, error, permanent) {
      cagrilar.failed.push({ id, error, permanent });
    },
  };
  return { repository, cagrilar };
}

const is = (over: Partial<QueueJob> & { id: string }): QueueJob => ({
  kind: 'yenile',
  payload: {},
  attempt: 1,
  market: 'TR',
  sourceId: null,
  ...over,
});

test('başarılı iş tamamlandı olarak işaretlenir', async () => {
  const { repository, cagrilar } = sahteDepo([is({ id: 'j1' })]);
  const ozet = await runWorkerOnce({
    repository,
    handlers: { yenile: async () => {} },
  });

  assert.equal(ozet.claimed, 1);
  assert.equal(ozet.completed, 1);
  assert.deepEqual(cagrilar.completed, ['j1']);
  assert.equal(cagrilar.failed.length, 0);
});

test('geçici hata GEÇİCİ olarak bildirilir (yeniden denenecek)', async () => {
  const { repository, cagrilar } = sahteDepo([is({ id: 'j1' })]);
  const ozet = await runWorkerOnce({
    repository,
    handlers: {
      yenile: async () => {
        throw new Error('503');
      },
    },
  });

  assert.equal(ozet.failed, 1);
  assert.equal(cagrilar.failed[0]!.permanent, false);
});

test('PermanentJobError yeniden denenmemek üzere bildirilir', async () => {
  const { repository, cagrilar } = sahteDepo([is({ id: 'j1' })]);
  const ozet = await runWorkerOnce({
    repository,
    handlers: {
      yenile: async () => {
        throw new PermanentJobError('404 bulunamadi');
      },
    },
  });

  assert.equal(ozet.permanentlyFailed, 1);
  assert.equal(cagrilar.failed[0]!.permanent, true);
});

/*
 * İşleyicisi olmayan iş KALICI hatadır: geçici sayıp yeniden denemek,
 * kod dağıtılana kadar kuyrukta sonsuza dek dönen bir kayıt bırakırdı.
 */
test('işleyicisi olmayan iş kalıcı hata sayılır', async () => {
  const { repository, cagrilar } = sahteDepo([is({ id: 'j1', kind: 'bilinmeyen' })]);
  const ozet = await runWorkerOnce({ repository, handlers: {} });

  assert.equal(ozet.unhandled, 1);
  assert.equal(cagrilar.failed[0]!.permanent, true);
  assert.match(cagrilar.failed[0]!.error, /isleyici yok/);
});

/*
 * Tek bir bozuk kayıt arkasındaki tüm kuyruğu rehin almamalı.
 */
test('bir işin çökmesi turdaki diğer işleri engellemez', async () => {
  const { repository, cagrilar } = sahteDepo([
    is({ id: 'j1' }),
    is({ id: 'j2', kind: 'bozuk' }),
    is({ id: 'j3' }),
  ]);

  const ozet = await runWorkerOnce({
    repository,
    handlers: {
      yenile: async () => {},
      bozuk: async () => {
        throw new Error('patladi');
      },
    },
  });

  assert.equal(ozet.claimed, 3);
  assert.equal(ozet.completed, 2);
  assert.equal(ozet.failed, 1);
  assert.deepEqual(cagrilar.completed, ['j1', 'j3']);
});

test('zaman aşımına uğrayan iş geçici hata olarak bildirilir', async () => {
  const { repository, cagrilar } = sahteDepo([is({ id: 'j1' })]);
  const ozet = await runWorkerOnce({
    repository,
    jobTimeoutMs: 20,
    handlers: {
      yenile: async () => {
        await new Promise((res) => setTimeout(res, 200));
      },
    },
  });

  assert.equal(ozet.failed, 1);
  assert.match(cagrilar.failed[0]!.error, /zaman_asimi/);
  // Zaman aşımı KALICI değil: kaynak toparlanabilir.
  assert.equal(cagrilar.failed[0]!.permanent, false);
});

test('boş kuyrukta tur sessizce biter', async () => {
  const { repository } = sahteDepo([]);
  const ozet = await runWorkerOnce({ repository, handlers: {} });
  assert.equal(ozet.claimed, 0);
  assert.equal(ozet.completed, 0);
});

test('telemetri her işin sonucunu kaydeder', async () => {
  const { repository } = sahteDepo([is({ id: 'j1' }), is({ id: 'j2', kind: 'bozuk' })]);
  const olaylar: string[] = [];

  await runWorkerOnce({
    repository,
    log: (event) => olaylar.push(event),
    handlers: {
      yenile: async () => {},
      bozuk: async () => {
        throw new Error('x');
      },
    },
  });

  assert.ok(olaylar.includes('job_completed'));
  assert.ok(olaylar.includes('job_failed'));
  assert.ok(olaylar.includes('worker_run_completed'));
});

// --- Eşzamanlılık ---------------------------------------------------------

/*
 * Varsayılan eşzamanlılık 1 ve bu KASITLI: paralel istek, kaynağın
 * nezaket ayarlarını (requests_per_minute) anlamsız kılabilir.
 */
test('varsayılan olarak işler SIRAYLA işlenir', async () => {
  const { repository } = sahteDepo([is({ id: 'j1' }), is({ id: 'j2' }), is({ id: 'j3' })]);
  let esZamanli = 0;
  let enYuksek = 0;

  await runWorkerOnce({
    repository,
    handlers: {
      yenile: async () => {
        esZamanli += 1;
        enYuksek = Math.max(enYuksek, esZamanli);
        await new Promise((r) => setTimeout(r, 10));
        esZamanli -= 1;
      },
    },
  });

  assert.equal(enYuksek, 1);
});

test('eşzamanlılık havuzu sınırı AŞMIYOR', async () => {
  const { repository } = sahteDepo(
    Array.from({ length: 6 }, (_, i) => is({ id: `j${i}` })),
  );
  let esZamanli = 0;
  let enYuksek = 0;

  const ozet = await runWorkerOnce({
    repository,
    concurrency: 2,
    handlers: {
      yenile: async () => {
        esZamanli += 1;
        enYuksek = Math.max(enYuksek, esZamanli);
        await new Promise((r) => setTimeout(r, 10));
        esZamanli -= 1;
      },
    },
  });

  assert.equal(ozet.completed, 6);
  // Hepsini birden başlatmak 6 paralel istek demek olurdu.
  assert.equal(enYuksek, 2);
});

// --- Düzgün kapanma -------------------------------------------------------

test('kapanma sinyali varken YENİ iş alınmaz', async () => {
  const { repository, cagrilar } = sahteDepo([is({ id: 'j1' })]);
  let calisti = false;

  const ozet = await runWorkerOnce({
    repository,
    shouldStop: () => true,
    handlers: {
      yenile: async () => {
        calisti = true;
      },
    },
  });

  assert.equal(ozet.claimed, 0);
  assert.equal(calisti, false);
  assert.equal(cagrilar.completed.length, 0);
});

// --- Kira uzatma ----------------------------------------------------------

test('uzun süren iş sırasında kira uzatılır', async () => {
  const uzatmalar: string[] = [];
  const { repository } = sahteDepo([is({ id: 'j1' })]);
  repository.extendLease = async (id) => {
    uzatmalar.push(id);
  };

  await runWorkerOnce({
    repository,
    leaseRenewMs: 10,
    leaseSeconds: 60,
    handlers: {
      yenile: async () => {
        await new Promise((r) => setTimeout(r, 45));
      },
    },
  });

  assert.ok(uzatmalar.length >= 2, `beklenen >=2 uzatma, gelen ${uzatmalar.length}`);
  assert.ok(uzatmalar.every((id) => id === 'j1'));
});

/*
 * Uzatma başarısızlığı işi DÜŞÜRMEZ: kira dolarsa iş zaten kurtarılır.
 * Burada patlamak, çalışan bir işi boşuna iptal etmek olurdu.
 */
test('kira uzatma hatası çalışan işi düşürmez', async () => {
  const { repository, cagrilar } = sahteDepo([is({ id: 'j1' })]);
  repository.extendLease = async () => {
    throw new Error('ag hatasi');
  };

  const ozet = await runWorkerOnce({
    repository,
    leaseRenewMs: 5,
    handlers: {
      yenile: async () => {
        await new Promise((r) => setTimeout(r, 30));
      },
    },
  });

  assert.equal(ozet.completed, 1);
  assert.deepEqual(cagrilar.completed, ['j1']);
});
