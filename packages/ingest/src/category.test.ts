/**
 * Kategori eslestirme testleri (E5).
 *
 * KOK NEDEN: feed'in kategori degeri okunuyordu ama `category_id` olarak
 * HICBIR ZAMAN yazilmiyordu. Alim basariyla biterdi, urunler veritabanina
 * girerdi, ama `/kategori/*` sayfalari `category_id` uzerinden
 * filtreledigi icin BOS kalirdi. Buradaki testlerin varlik sebebi, o
 * sessiz hatanin bir daha sessiz olmamasi.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  categorySlugKey,
  matchCanonicalGroups,
  resolveCategoryIds,
  runSource,
  type IngestRepository,
} from './pipeline.js';
import type { IngestSummary, NormalizedOffer, SourceConfig } from './types.js';

/** Uretimdeki 9 kategoriden ucu — testte tam liste gerekmiyor. */
const KATALOG = new Map<string, string>([
  ['elektronik', 'cat-elektronik'],
  ['ev-yasam', 'cat-ev-yasam'],
  ['telefon', 'cat-telefon'],
]);

const SOURCE: SourceConfig = {
  id: 'src-1',
  slug: 'kategori-feed',
  merchantId: 'merchant-1',
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
    category: 'category',
  },
};

function fakeFetcher(body: string) {
  return { get: async () => ({ body, contentType: 'text/csv' }) };
}

function fakeRepository(overrides: Partial<IngestRepository> = {}) {
  const calls = {
    upserted: [] as Array<
      NormalizedOffer & {
        groupId: string | null;
        fingerprint: string;
        categoryId: string | null;
      }
    >,
    createdGroups: [] as Array<{ signature: string; categoryId: string | null }>,
    /** findCategoryIdsBySlug'a HANGI slug'larin sorulduğu. */
    askedSlugs: [] as string[][],
    finished: [] as IngestSummary[],
  };

  const repository: IngestRepository = {
    async getFingerprints() {
      return new Map<string, string>();
    },
    async touchSeen() {},
    async saveRefreshPlan() {},
    async findCategoryIdsBySlug(slugs) {
      calls.askedSlugs.push([...slugs]);
      return new Map(
        slugs
          .filter((slug) => KATALOG.has(slug))
          .map((slug) => [slug, KATALOG.get(slug) as string]),
      );
    },
    async findGroupsByGtin() {
      return new Map();
    },
    async findGroupsBySignature() {
      return new Map();
    },
    async createGroups(groups) {
      const result = new Map<string, string>();
      for (const [index, group] of groups.entries()) {
        calls.createdGroups.push({ signature: group.signature, categoryId: group.categoryId });
        result.set(group.signature, `group-${index + 1}`);
      }
      return result;
    },
    async upsertOffers(_merchantId, _sourceId, rows) {
      calls.upserted.push(...rows);
      return { created: rows.length, updated: 0 };
    },
    async markStale() {
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

// ---------------------------------------------------------------------------
// 1) Slug normalizasyonu
// ---------------------------------------------------------------------------

test('kategori slug anahtari Turkce karakter ve noktalamayi normalize eder', () => {
  assert.equal(categorySlugKey('Elektronik'), 'elektronik');
  assert.equal(categorySlugKey('  ELEKTRONİK  '), 'elektronik');
  assert.equal(categorySlugKey('Ev & Yaşam'), 'ev-yasam');
  assert.equal(categorySlugKey('Spor & Outdoor'), 'spor-outdoor');
});

test('bos, null ve anlamsiz kategori degeri null uretir', () => {
  assert.equal(categorySlugKey(null), null);
  assert.equal(categorySlugKey(undefined), null);
  assert.equal(categorySlugKey('   '), null);
  // Yalnizca noktalama: slug'a indirgenince bos kalir.
  assert.equal(categorySlugKey('--- & ---'), null);
});

test('BULANIK eslesme YOK -- alt kategori adi ust kategoriye dusmez', () => {
  // "telefon-aksesuar" katalogda yok. Onemli olan "telefon" ile
  // KARISTIRILMAMASI: yanlis kategoriye atama, hic atamamaktan zararlidir.
  const key = categorySlugKey('Telefon Aksesuar');
  assert.equal(key, 'telefon-aksesuar');
  assert.equal(KATALOG.has(key as string), false);
});

// ---------------------------------------------------------------------------
// 2) Cozumleme: yalnizca tekil slug'lar sorulur
// ---------------------------------------------------------------------------

test('cozumleme slug listesini tekillestirir ve tek sorguda sorar', async () => {
  const { repository, calls } = fakeRepository();

  const offers = [
    { categorySlug: 'Elektronik' },
    { categorySlug: 'elektronik' },
    { categorySlug: 'Ev & Yaşam' },
    { categorySlug: null },
  ] as NormalizedOffer[];

  const map = await resolveCategoryIds(offers, repository);

  assert.equal(calls.askedSlugs.length, 1);
  assert.deepEqual([...(calls.askedSlugs[0] ?? [])].sort(), ['elektronik', 'ev-yasam']);
  assert.equal(map.get('elektronik'), 'cat-elektronik');
  assert.equal(map.get('ev-yasam'), 'cat-ev-yasam');
});

test('hic kategori degeri yoksa veritabanina HIC sorulmaz', async () => {
  const { repository, calls } = fakeRepository();

  const map = await resolveCategoryIds([{ categorySlug: null }] as NormalizedOffer[], repository);

  assert.equal(calls.askedSlugs.length, 0);
  assert.equal(map.size, 0);
});

// ---------------------------------------------------------------------------
// 3) Uctan uca: category_id GERCEKTEN yaziliyor mu?
// ---------------------------------------------------------------------------

test('gecerli kategori feedi -> products.category_id dogru yaziliyor', async () => {
  const { repository, calls } = fakeRepository();

  const csv = [
    'id,title,price,link,gtin,brand,category',
    'SKU-1,Sony WH-1000XM5,11899.00,https://magaza.example/p/1,4548736134546,Sony,Elektronik',
    'SKU-2,Philips Airfryer,4299.00,https://magaza.example/p/2,8710103947xyz,Philips,Ev & Yaşam',
  ].join('\n');

  const summary = await runSource(SOURCE, { fetcher: fakeFetcher(csv), repository });

  assert.equal(summary.status, 'success');
  assert.equal(summary.itemsSeen, 2);
  assert.equal(summary.itemsUnclassified, 0);

  const byExternalId = new Map(calls.upserted.map((row) => [row.externalId, row]));
  assert.equal(byExternalId.get('SKU-1')?.categoryId, 'cat-elektronik');
  assert.equal(byExternalId.get('SKU-2')?.categoryId, 'cat-ev-yasam');
});

test('kanonik urun (product_group) da siniflandiriliyor', async () => {
  const { repository, calls } = fakeRepository();

  const csv = [
    'id,title,price,link,gtin,brand,category',
    'SKU-1,Sony WH-1000XM5,11899.00,https://magaza.example/p/1,4548736134546,Sony,Elektronik',
  ].join('\n');

  await runSource(SOURCE, { fetcher: fakeFetcher(csv), repository });

  assert.equal(calls.createdGroups.length, 1);
  assert.equal(calls.createdGroups[0]?.categoryId, 'cat-elektronik');
});

// ---------------------------------------------------------------------------
// 4) FAIL-SAFE: bilinmeyen kategori
// ---------------------------------------------------------------------------

test('bilinmeyen kategori urunu DUSURMEZ, null yazar ve sayilir', async () => {
  const { repository, calls } = fakeRepository();

  const csv = [
    'id,title,price,link,gtin,brand,category',
    'SKU-1,Sony WH-1000XM5,11899.00,https://magaza.example/p/1,4548736134546,Sony,Elektronik',
    'SKU-2,Bosch Testere,2599.00,https://magaza.example/p/2,4059952xyz001,Bosch,Hirdavat',
  ].join('\n');

  const summary = await runSource(SOURCE, { fetcher: fakeFetcher(csv), repository });

  // Alim BASARILI: bilinmeyen kategori bir arizaya donusturulmez.
  assert.equal(summary.status, 'success');
  assert.equal(summary.itemsFailed, 0);
  assert.equal(summary.itemsSeen, 2);
  // Urun YAZILIR -- katalogdan dusmez.
  assert.equal(calls.upserted.length, 2);

  const byExternalId = new Map(calls.upserted.map((row) => [row.externalId, row]));
  assert.equal(byExternalId.get('SKU-1')?.categoryId, 'cat-elektronik');
  // Yanlis kategoriye ATANMAZ: null kalir.
  assert.equal(byExternalId.get('SKU-2')?.categoryId, null);

  // Ve SESSIZ kalmaz: olculebilir.
  assert.equal(summary.itemsUnclassified, 1);
});

test('kategori alani hic olmayan feed calismaya devam eder', async () => {
  const { repository, calls } = fakeRepository();

  const csv = [
    'id,title,price,link,gtin,brand',
    'SKU-1,Sony WH-1000XM5,11899.00,https://magaza.example/p/1,4548736134546,Sony',
  ].join('\n');

  const kategorisiz: SourceConfig = {
    ...SOURCE,
    fieldMapping: { ...SOURCE.fieldMapping, category: undefined },
  };

  const summary = await runSource(kategorisiz, { fetcher: fakeFetcher(csv), repository });

  assert.equal(summary.status, 'success');
  assert.equal(calls.upserted.length, 1);
  assert.equal(calls.upserted[0]?.categoryId, null);
  assert.equal(summary.itemsUnclassified, 1);
  // Kategori degeri hic yoksa veritabanina sorulmaz.
  assert.equal(calls.askedSlugs.length, 0);
});

// ---------------------------------------------------------------------------
// 5) Mevcut davranis bozulmadi
// ---------------------------------------------------------------------------

test('categoryIds gecilmezse eski davranis aynen korunur', async () => {
  const { repository } = fakeRepository();

  const offers = [
    { externalId: 'A', title: 'Sony WH-1000XM5', brand: 'Sony', gtin: null, imageUrls: [], categorySlug: 'Elektronik' },
  ] as unknown as NormalizedOffer[];

  // Ucuncu argumani BILEREK gecmiyoruz: varsayilan bos harita.
  const sonuc = await matchCanonicalGroups(offers, repository);

  assert.equal(sonuc.length, 1);
  assert.equal(sonuc[0]?.categoryId, null);
  // Kanonik eslestirme etkilenmedi.
  assert.equal(typeof sonuc[0]?.groupId, 'string');
});
