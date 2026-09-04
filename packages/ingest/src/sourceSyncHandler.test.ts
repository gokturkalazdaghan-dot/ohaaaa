import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PermanentJobError,
  runWorkerOnce,
  type QueueJob,
  type QueueRepository,
} from '@ohaaaa/shared';

import { createSourceSyncHandler } from './sourceSyncHandler.js';
import type { IngestRepository, Fetcher } from './pipeline.js';
import type { IngestSummary, NormalizedOffer, SourceConfig } from './types.js';

/* =========================================================================
 * §47 — SCHEDULER → QUEUE → WORKER → runSource
 * -------------------------------------------------------------------------
 * Bu testler sahte bir worker ya da sahte bir runSource kullanmıyor.
 * Gerçek `runWorkerOnce` gerçek `createSourceSyncHandler` işleyicisini
 * çağırıyor, o da gerçek `runSource`'u çalıştırıyor. Sahtelenen tek şey
 * DIŞ SINIR: HTTP getirici ve veritabanı deposu.
 * ========================================================================= */

const SOURCE: SourceConfig = {
  id: 'src-tr',
  slug: 'tr-feed',
  merchantId: 'merchant-tr',
  kind: 'feed_csv',
  endpointUrl: 'https://magaza.example/feed.csv',
  market: 'TR',
  currency: 'TRY',
  allowedHosts: ['magaza.example'],
  fieldMapping: {
    external_id: 'id',
    title: 'title',
    price: 'price',
    url: 'link',
    gtin: 'gtin',
    brand: 'brand',
  },
};

const CSV = [
  'id,title,price,link,gtin,brand',
  'SKU-1,Sony WH-1000XM5 Kulaklik,11899.00,https://magaza.example/p/1,4548736134546,Sony',
  'SKU-2,Apple iPhone 15 128GB,53499.00,https://magaza.example/p/2,0195949038204,Apple',
].join('\n');

/** Alım deposu — dış sınır. */
function ingestRepository() {
  const calls = {
    upserted: [] as Array<
      NormalizedOffer & {
        groupId: string | null;
        fingerprint: string;
        categoryId: string | null;
      }
    >,
    refreshPlans: [] as Array<{ sourceId: string; nextRefreshAt: Date; freshnessClass: string }>,
    finished: [] as IngestSummary[],
  };

  const repository: IngestRepository = {
    async getFingerprints() {
      return new Map<string, string>();
    },
    async touchSeen() {},
    async findCategoryIdsBySlug() {
      return new Map<string, string>();
    },
    async findGroupsByGtin() {
      return new Map();
    },
    async findGroupsBySignature() {
      return new Map();
    },
    async createGroups(groups) {
      return new Map(groups.map((g, i) => [g.signature, `group-${i}`]));
    },
    async upsertOffers(_m, _s, rows) {
      calls.upserted.push(...rows);
      return { created: rows.length, updated: 0 };
    },
    async markStale() {
      return 0;
    },
    async saveRefreshPlan(sourceId, plan) {
      calls.refreshPlans.push({ sourceId, ...plan });
    },
    async startRun() {
      return 'run-1';
    },
    async finishRun(_id, summary) {
      calls.finished.push(summary);
    },
  };

  return { repository, calls };
}

/** Kuyruk deposu — SQL fonksiyonlarının yerinde duran sınır. */
function queue(jobs: QueueJob[]) {
  const calls = {
    completed: [] as string[],
    failed: [] as Array<{ id: string; error: string; permanent: boolean }>,
  };

  const repository: QueueRepository = {
    async claim(limit) {
      return jobs.splice(0, limit);
    },
    async complete(id) {
      calls.completed.push(id);
    },
    async fail(id, error, permanent) {
      calls.failed.push({ id, error, permanent });
    },
  };

  return { repository, calls };
}

const job = (over: Partial<QueueJob> = {}): QueueJob => ({
  id: 'job-1',
  kind: 'SOURCE_SYNC',
  payload: { source_id: 'src-tr' },
  attempt: 1,
  market: 'TR',
  sourceId: 'src-tr',
  ...over,
});

const fetcher = (body: string): Fetcher => ({
  get: async () => ({ body, contentType: 'text/csv' }),
});

/* --- Uçtan uca: kuyruk → worker → runSource ----------------------------- */

/*
 * EN ÖNEMLİ TEST.
 *
 * Zincirin tamamı gerçek fonksiyonlarla geçiliyor: runWorkerOnce işi
 * alıyor, gerçek işleyici kaynağı çözüyor, gerçek runSource alımı
 * yapıyor ve sonunda yenileme planı kaynağa yazılıyor.
 */
test('E2E: kuyruktaki SOURCE_SYNC işi gerçek runSource zincirini çalıştırır', async () => {
  const ingest = ingestRepository();
  const q = queue([job()]);

  const ozet = await runWorkerOnce({
    repository: q.repository,
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async (id) => (id === SOURCE.id ? SOURCE : null),
        repository: ingest.repository,
        fetcher: fetcher(CSV),
      }),
    },
  });

  assert.equal(ozet.claimed, 1);
  assert.equal(ozet.completed, 1);
  assert.deepEqual(q.calls.completed, ['job-1']);

  // Gerçek alım çalıştı: teklifler yazıldı ve parmak izi taşıyor.
  assert.equal(ingest.calls.upserted.length, 2);
  assert.ok(ingest.calls.upserted.every((r) => r.fingerprint.length > 0));

  // §46 zinciri bozulmadı: yenileme planı yeniden hesaplandı.
  assert.equal(ingest.calls.refreshPlans.length, 1);
  assert.equal(ingest.calls.refreshPlans[0]!.sourceId, 'src-tr');
  assert.ok(ingest.calls.refreshPlans[0]!.nextRefreshAt.getTime() > Date.now());

  // Çalışma kaydı kapandı.
  assert.equal(ingest.calls.finished.length, 1);
  assert.equal(ingest.calls.finished[0]!.status, 'success');
});

test('E2E: delta zinciri korunuyor — ikinci tur hiçbir şey yazmaz', async () => {
  const ingest = ingestRepository();

  // İlk tur: her kalem NEW.
  await runWorkerOnce({
    repository: queue([job()]).repository,
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async () => SOURCE,
        repository: ingest.repository,
        fetcher: fetcher(CSV),
      }),
    },
  });

  const bilinen = new Map(ingest.calls.upserted.map((r) => [r.externalId, r.fingerprint]));
  ingest.calls.upserted.length = 0;
  ingest.repository.getFingerprints = async () => bilinen;

  await runWorkerOnce({
    repository: queue([job({ id: 'job-2' })]).repository,
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async () => SOURCE,
        repository: ingest.repository,
        fetcher: fetcher(CSV),
      }),
    },
  });

  assert.equal(ingest.calls.upserted.length, 0, 'değişmeyen kalem yazılmamalı');
  assert.equal(ingest.calls.finished[1]!.itemsUnchanged, 2);
});

/* --- Hata yolları -------------------------------------------------------- */

/*
 * BAŞARISIZ ALIM, BAŞARISIZ İŞTİR.
 *
 * `runSource` hata fırlatmaz, durumu özete yazar. İşleyici bunu işe
 * yansıtmasaydı kuyruk onu "tamamlandı" sayar ve yeniden deneme
 * mekanizması sessizce devre dışı kalırdı.
 */
test('E2E: alım başarısız olursa iş de başarısız olur (yeniden denenebilir)', async () => {
  const ingest = ingestRepository();
  const q = queue([job()]);

  const ozet = await runWorkerOnce({
    repository: q.repository,
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async () => SOURCE,
        repository: ingest.repository,
        fetcher: {
          get: async () => {
            throw new Error('kaynak 503');
          },
        },
      }),
    },
  });

  assert.equal(ozet.completed, 0);
  assert.equal(ozet.failed, 1);
  assert.equal(q.calls.completed.length, 0);
  // Geçici hata: yeniden denenebilir olmalı.
  assert.equal(q.calls.failed[0]!.permanent, false);
});

/*
 * KISMİ TUR BAŞARISIZ SAYILMAZ.
 *
 * Veri yazıldı, katalog korundu ve bir sonraki plan zaten geri çekilme
 * uyguladı. Yeniden denemek, zaten yavaşlatılmış bir kaynağı hemen
 * tekrar dövmek olurdu.
 */
test('E2E: kısmi tur iş olarak BAŞARILI sayılır', async () => {
  const ingest = ingestRepository();
  const q = queue([job()]);

  const bozukCsv = [
    'id,title,price,link,gtin,brand',
    'SKU-1,Gecerli,100.00,https://magaza.example/p/1,4548736134546,Sony',
    'SKU-2,Bozuk,100.00,https://baska.gecersiz/p/2,,X',
    'SKU-3,Bozuk,100.00,https://baska.gecersiz/p/3,,X',
    'SKU-4,Bozuk,100.00,https://baska.gecersiz/p/4,,X',
  ].join('\n');

  await runWorkerOnce({
    repository: q.repository,
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async () => SOURCE,
        repository: ingest.repository,
        fetcher: fetcher(bozukCsv),
      }),
    },
  });

  assert.equal(ingest.calls.finished[0]!.status, 'partial');
  assert.deepEqual(q.calls.completed, ['job-1']);
});

/*
 * SİLİNMİŞ KAYNAK KALICI HATADIR.
 *
 * Yeniden denemek hiçbir şeyi değiştirmez; ölü mektuba düşüp sebebiyle
 * birlikte görünür kalması doğru davranış.
 */
test('E2E: kaynak bulunamazsa iş KALICI başarısız olur', async () => {
  const ingest = ingestRepository();
  const q = queue([job({ payload: { source_id: 'yok-boyle' } })]);

  await runWorkerOnce({
    repository: q.repository,
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async () => null,
        repository: ingest.repository,
        fetcher: fetcher(CSV),
      }),
    },
  });

  assert.equal(q.calls.failed[0]!.permanent, true);
  assert.match(q.calls.failed[0]!.error, /Kaynak bulunamadı/);
});

test('E2E: bozuk yük KALICI başarısız olur, alım hiç başlamaz', async () => {
  const ingest = ingestRepository();
  const q = queue([job({ payload: {} })]);
  let yuklendi = false;

  await runWorkerOnce({
    repository: q.repository,
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async () => {
          yuklendi = true;
          return SOURCE;
        },
        repository: ingest.repository,
        fetcher: fetcher(CSV),
      }),
    },
  });

  assert.equal(q.calls.failed[0]!.permanent, true);
  assert.equal(yuklendi, false, 'geçersiz yükte kaynak hiç yüklenmemeli');
  assert.equal(ingest.calls.finished.length, 0, 'alım hiç başlamamalı');
});

/* --- Pazar izolasyonu ---------------------------------------------------- */

/*
 * Bir kaynağın işi YALNIZCA kendi kaynağını çalıştırır ve yalnızca kendi
 * planını yazar. Kaynak, iş yükündeki kimlikten çözülüyor -- başka bir
 * pazarın kaynağına dokunması mimari olarak mümkün değil.
 */
test('E2E: TR işi yalnızca TR kaynağını çalıştırır', async () => {
  const ingest = ingestRepository();
  const yuklenenler: string[] = [];

  const DE: SourceConfig = { ...SOURCE, id: 'src-de', slug: 'de-feed', market: 'DE', currency: 'EUR' };

  await runWorkerOnce({
    repository: queue([job()]).repository,
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async (id) => {
          yuklenenler.push(id);
          return id === 'src-tr' ? SOURCE : DE;
        },
        repository: ingest.repository,
        fetcher: fetcher(CSV),
      }),
    },
  });

  assert.deepEqual(yuklenenler, ['src-tr']);
  assert.deepEqual(
    ingest.calls.refreshPlans.map((p) => p.sourceId),
    ['src-tr'],
  );
});

/* --- Bilinmeyen tür ------------------------------------------------------ */

test('E2E: SOURCE_SYNC dışı bir tür bu işleyiciye düşmez', async () => {
  const ingest = ingestRepository();
  const q = queue([job({ kind: 'BASKA_IS' })]);
  let calisti = false;

  await runWorkerOnce({
    repository: q.repository,
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async () => {
          calisti = true;
          return SOURCE;
        },
        repository: ingest.repository,
        fetcher: fetcher(CSV),
      }),
    },
  });

  assert.equal(calisti, false);
  // İşleyicisi olmayan iş kalıcı hatadır.
  assert.equal(q.calls.failed[0]!.permanent, true);
});

test('PermanentJobError doğru tipte fırlatılıyor', () => {
  const hata = new PermanentJobError('x');
  assert.equal(hata.name, 'PermanentJobError');
  assert.ok(hata instanceof Error);
});

/* --- Hata sınıfı → kuyruk kararı ---------------------------------------- */

/*
 * BU TESTLERİN VAR OLMA SEBEBİ ÖLÇÜLEBİLİR BİR KUSURDU.
 *
 * İşleyici her başarısız turu düz `Error` olarak fırlatıyordu ve kuyruk
 * hepsini GEÇİCİ sayıyordu. Yani düzelmesi imkânsız bir hata -- eksik ortam
 * değişkeni, yanlış alan haritası, 401 -- üstel geri çekilmeyle beş kez
 * deneniyor, kaynak saatlerce "yeniden denenecek" görünüyor ve ancak sonunda
 * ölü mektuba düşüyordu. 401 durumunda bu, sağlayıcıya dört kez daha
 * kimliksiz istek göndermek demekti.
 *
 * Testler `fail(..., permanent)` bayrağına bakıyor çünkü kuyruğun yeniden
 * deneyip denemeyeceğini belirleyen tek şey odur.
 */

/** Belirli bir hatayı fırlatan getirici. */
const patlayanFetcher = (hata: unknown): Fetcher => ({
  get: async () => {
    throw hata;
  },
});

async function turCalistir(fetcherOverride: Fetcher, sourceOverride: SourceConfig = SOURCE) {
  const ingest = ingestRepository();
  const q = queue([job()]);

  await runWorkerOnce({
    repository: q.repository,
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async () => sourceOverride,
        repository: ingest.repository,
        fetcher: fetcherOverride,
      }),
    },
  });

  return { q, ingest };
}

test('401 KALICI olarak başarısız olur — sağlayıcıya tekrar kimliksiz istek gitmez', async () => {
  const { PermanentHttpError } = await import('./http/politeClient.js');
  const { q, ingest } = await turCalistir(
    patlayanFetcher(new PermanentHttpError(401, 'https://magaza.example/feed.csv')),
  );

  assert.equal(q.calls.failed.length, 1);
  assert.equal(q.calls.failed[0]!.permanent, true);
  assert.match(q.calls.failed[0]!.error, /AUTH_ERROR/);
  // Sınıf özete ve oradan veritabanına gider.
  assert.equal(ingest.calls.finished.at(-1)!.errorClass, 'AUTH_ERROR');
});

test('eksik ortam değişkeni KALICI — secret eklenmeden hiçbir deneme geçemez', async () => {
  const { q, ingest } = await turCalistir(fetcher(CSV), {
    ...SOURCE,
    endpointUrl: 'https://magaza.example/feed.csv?token=${OHAAAA_YOK_BOYLE_BIR_DEGISKEN}',
  });

  assert.equal(q.calls.failed[0]!.permanent, true);
  assert.match(q.calls.failed[0]!.error, /CONFIG_ERROR/);
  // Değişken ADI görünür (güvenli), değeri değil.
  assert.match(q.calls.failed[0]!.error, /OHAAAA_YOK_BOYLE_BIR_DEGISKEN/);
  assert.equal(ingest.calls.finished.at(-1)!.errorClass, 'CONFIG_ERROR');
});

test('yanlış alan haritası KALICI — aynı feed beş kez indirilmez', async () => {
  const { q, ingest } = await turCalistir(fetcher(CSV), {
    ...SOURCE,
    fieldMapping: { ...SOURCE.fieldMapping, price: 'boyle_bir_kolon_yok' },
  });

  assert.equal(q.calls.failed[0]!.permanent, true);
  assert.match(q.calls.failed[0]!.error, /VALIDATION_ERROR/);
  assert.equal(ingest.calls.finished.at(-1)!.errorClass, 'VALIDATION_ERROR');
});

test('robots yasağı KALICI — yasak yeniden denenerek yok sayılmaz', async () => {
  const { RobotsDisallowedError } = await import('./http/politeClient.js');
  const { q } = await turCalistir(
    patlayanFetcher(new RobotsDisallowedError('https://magaza.example/feed.csv')),
  );

  assert.equal(q.calls.failed[0]!.permanent, true);
  assert.match(q.calls.failed[0]!.error, /SECURITY_ERROR/);
});

/*
 * KARŞI YÖN AYNI DERECEDE ÖNEMLİ.
 *
 * Her şeyi kalıcı yapan bir düzeltme, düzelebilecek arızalarda kaynağı ilk
 * denemede öldürürdü. Bu testler geri çekilmenin hâlâ çalıştığını kanıtlıyor.
 */
test('ağ hatası GEÇİCİ kalır — yeniden deneme çalışmaya devam eder', async () => {
  const { q, ingest } = await turCalistir(patlayanFetcher(new Error('ECONNRESET')));

  assert.equal(q.calls.failed[0]!.permanent, false);
  assert.match(q.calls.failed[0]!.error, /NETWORK_ERROR/);
  assert.equal(ingest.calls.finished.at(-1)!.errorClass, 'NETWORK_ERROR');
});

test('5xx GEÇİCİ kalır — sunucu toparlanabilir', async () => {
  const { q } = await turCalistir(patlayanFetcher(new Error('HTTP 503')));

  assert.equal(q.calls.failed[0]!.permanent, false);
  assert.match(q.calls.failed[0]!.error, /HTTP_ERROR/);
});

test('tanınmayan hata GEÇİCİ kalır — temkinli varsayım', async () => {
  const { q } = await turCalistir(patlayanFetcher(new Error('bilinmeyen bir şey')));

  assert.equal(q.calls.failed[0]!.permanent, false);
  assert.match(q.calls.failed[0]!.error, /UNKNOWN_ERROR/);
});

/*
 * Boş feed GEÇİCİ: sağlayıcının yarım yayınladığı dosya yaygındır ve bir
 * sonraki turda düzelir. Katalog zaten korunuyor (bayatlatma çalışmıyor).
 */
test('boş feed GEÇİCİ — katalog korunur ama kaynak öldürülmez', async () => {
  const { q, ingest } = await turCalistir(fetcher('id,title,price,link\n'));

  assert.equal(q.calls.failed[0]!.permanent, false);
  assert.match(q.calls.failed[0]!.error, /PARSER_ERROR/);
  assert.equal(ingest.calls.finished.at(-1)!.errorClass, 'PARSER_ERROR');
});
