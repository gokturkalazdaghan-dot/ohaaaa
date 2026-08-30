/**
 * Hat testleri — sahte depo ve sahte getirici ile.
 *
 * Buradaki en önemli test "boş feed kataloğu silmez"dir: gerçek hayatta
 * kataloğun tamamını kaybettiren senaryo tam olarak budur.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { canonicalSignature, runSource, type IngestRepository } from './pipeline.js';
import type { IngestSummary, NormalizedOffer, SourceConfig } from './types.js';

const SOURCE: SourceConfig = {
  id: 'src-1',
  slug: 'test-feed',
  merchantId: 'merchant-1',
  kind: 'feed_csv',
  endpointUrl: 'https://magaza.example/feed.csv',
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
  'SKU-1,Sony WH-1000XM5 Kulaklık,11899.00,https://magaza.example/p/1,4548736134546,Sony',
  'SKU-2,Apple iPhone 15 128GB,53499.00,https://magaza.example/p/2,0195949038204,Apple',
].join('\n');

/** Çağrıları kaydeden sahte depo. */
function fakeRepository(overrides: Partial<IngestRepository> = {}) {
  const calls = {
    markStale: 0,
    upserted: [] as Array<NormalizedOffer & { groupId: string | null }>,
    createdGroups: [] as string[],
    finished: [] as IngestSummary[],
  };

  const repository: IngestRepository = {
    async findGroupsByGtin() {
      return new Map();
    },
    async findGroupsBySignature() {
      return new Map();
    },
    async createGroups(groups) {
      const result = new Map<string, string>();
      for (const [index, group] of groups.entries()) {
        calls.createdGroups.push(group.signature);
        result.set(group.signature, `group-${index + 1}`);
      }
      return result;
    },
    async upsertOffers(_merchantId, _sourceId, rows) {
      calls.upserted.push(...rows);
      return { created: rows.length, updated: 0 };
    },
    async markStale() {
      calls.markStale += 1;
      return 0;
    },
    async startRun() {
      return 'run-1';
    },
    async finishRun(_runId, summary) {
      calls.finished.push(summary);
    },
    ...overrides,
  };

  return { repository, calls };
}

function fakeFetcher(body: string) {
  return { get: async () => ({ body, contentType: 'text/csv' }) };
}

test('geçerli feed işlenir ve teklifler yazılır', async () => {
  const { repository, calls } = fakeRepository();

  const summary = await runSource(SOURCE, {
    fetcher: fakeFetcher(CSV),
    repository,
  });

  assert.equal(summary.status, 'success');
  assert.equal(summary.itemsSeen, 2);
  assert.equal(summary.itemsCreated, 2);
  assert.equal(summary.itemsFailed, 0);

  assert.equal(calls.upserted.length, 2);
  assert.equal(calls.upserted[0]?.priceCents, 1_189_900);
  assert.ok(calls.upserted[0]?.groupId, 'kanonik ürüne bağlanmalı');
});

test('BOŞ FEED kataloğu silmez — bayatlatma çalıştırılmaz', async () => {
  const { repository, calls } = fakeRepository();

  const summary = await runSource(SOURCE, {
    fetcher: fakeFetcher('id,title,price,link\n'), // yalnızca başlık satırı
    repository,
  });

  assert.equal(summary.status, 'failed');
  assert.match(summary.error ?? '', /Feed boş/);

  // KRİTİK: markStale çağrılmamalı, aksi halde tüm katalog stoksuz olurdu.
  assert.equal(calls.markStale, 0, 'boş feed bayatlatma tetiklememeli');
  assert.equal(calls.upserted.length, 0);
});

test('ağ hatası kataloğu bozmaz ve çalışma "failed" kaydedilir', async () => {
  const { repository, calls } = fakeRepository();

  const summary = await runSource(SOURCE, {
    fetcher: {
      get: async () => {
        throw new Error('HTTP 503');
      },
    },
    repository,
  });

  assert.equal(summary.status, 'failed');
  assert.match(summary.error ?? '', /503/);
  assert.equal(calls.markStale, 0);
  assert.equal(calls.finished.length, 1, 'çalışma kaydı yine kapatılmalı');
});

test('hiçbir kalem doğrulamayı geçemezse harita hatası bildirilir', async () => {
  const { repository, calls } = fakeRepository();

  // Alan haritası yanlış: kolon adları eşleşmiyor.
  const summary = await runSource(
    { ...SOURCE, fieldMapping: { ...SOURCE.fieldMapping, price: 'fiyat_yok' } },
    { fetcher: fakeFetcher(CSV), repository },
  );

  assert.equal(summary.status, 'failed');
  assert.match(summary.error ?? '', /field_mapping|Alan haritası/);
  assert.equal(calls.markStale, 0);
});

test('kısmi başarısızlık "partial" olarak raporlanır ve geçerliler yazılır', async () => {
  const { repository, calls } = fakeRepository();

  const mixed = [
    'id,title,price,link,gtin,brand',
    'SKU-1,Geçerli Ürün,1199.00,https://magaza.example/p/1,,Marka',
    'SKU-2,Bozuk Fiyat,fiyat-sorunuz,https://magaza.example/p/2,,Marka',
    'SKU-3,Yabancı Adres,999.00,https://baska.example/p/3,,Marka',
  ].join('\n');

  const summary = await runSource(SOURCE, {
    fetcher: fakeFetcher(mixed),
    repository,
  });

  assert.equal(summary.status, 'partial');
  assert.equal(summary.itemsSeen, 3);
  assert.equal(summary.itemsFailed, 2);
  assert.equal(calls.upserted.length, 1, 'geçerli kalem yine yazılmalı');

  // Hata örnekleri panelde görünmeli.
  assert.ok(summary.sampleErrors.length >= 2);
  assert.ok(summary.sampleErrors.some((e) => e.externalId === 'SKU-2'));
});

test('geçerli feed sonrası bayatlatma çalışır', async () => {
  const { repository, calls } = fakeRepository();

  await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository });

  assert.equal(calls.markStale, 1);
});

test('GTIN eşleşmesi imzaya tercih edilir', async () => {
  const { repository, calls } = fakeRepository({
    async findGroupsByGtin(gtins) {
      // İlk ürünün barkodu zaten katalogda.
      return new Map(
        gtins.includes('4548736134546') ? [['4548736134546', 'mevcut-grup']] : [],
      );
    },
  });

  await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository });

  const sony = calls.upserted.find((o) => o.externalId === 'SKU-1');
  assert.equal(sony?.groupId, 'mevcut-grup', 'GTIN ile mevcut gruba bağlanmalı');

  // Yalnızca eşleşmeyen için yeni grup açılmalı.
  assert.equal(calls.createdGroups.length, 1);
});

test('aynı beslemedeki tekrar eden ürün için tek kanonik kayıt açılır', async () => {
  const { repository, calls } = fakeRepository();

  const duplicated = [
    'id,title,price,link,gtin,brand',
    'SKU-1,Sony WH-1000XM5 Kulaklık,11899.00,https://magaza.example/p/1,,Sony',
    'SKU-2,Kulaklık Sony WH-1000XM5,11999.00,https://magaza.example/p/2,,Sony',
  ].join('\n');

  await runSource(SOURCE, { fetcher: fakeFetcher(duplicated), repository });

  // Kelime sırası farklı ama aynı ürün → tek kanonik kayıt.
  assert.equal(calls.createdGroups.length, 1);
  assert.equal(calls.upserted[0]?.groupId, calls.upserted[1]?.groupId);
});

test('imza kelime sırasına ve Türkçe karaktere duyarsızdır', () => {
  assert.equal(
    canonicalSignature('Sony WH-1000XM5 Kulaklık', 'Sony'),
    canonicalSignature('Kulaklık WH-1000XM5 Sony', 'Sony'),
  );

  assert.equal(
    canonicalSignature('Süpürge Dyson', 'Dyson'),
    canonicalSignature('Supurge Dyson', 'DYSON'),
  );

  // Farklı ürünler farklı imza üretmeli.
  assert.notEqual(
    canonicalSignature('iPhone 15 128GB', 'Apple'),
    canonicalSignature('iPhone 15 256GB', 'Apple'),
  );
});

test('çalışma kaydı her durumda kapatılır', async () => {
  for (const body of [CSV, '', 'bozuk']) {
    const { repository, calls } = fakeRepository();
    await runSource(SOURCE, { fetcher: fakeFetcher(body), repository });
    assert.equal(calls.finished.length, 1, `kapatılmadı: "${body.slice(0, 10)}"`);
  }
});
