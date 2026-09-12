/**
 * Simple Project (MID 158122, feed F2281) alım testleri.
 *
 * ======================================================================
 * TEST VERİSİDİR. GERÇEK FEED DEĞİLDİR.
 * ======================================================================
 * `ui.awin.com` ve `productdata.awin.com` bu ortamın ağ politikasıyla
 * engelli; F2281 hiç indirilmedi. Aşağıdaki satırlar Awin'in yayınlanmış
 * datafeed şemasına göre yazılmış TEMSİLİ verilerdir. Ürün adları,
 * fiyatlar ve adresler uydurmadır.
 *
 * Kanıtlanan şey HATTIN DAVRANIŞIDIR (izolasyon, idempotentlik, anlık
 * görüntü, para birimi, sır maskeleme). Kanıtlanmayan şey F2281'in
 * gerçekten bu kolonlara sahip olduğudur -- o yalnızca gerçek bir
 * indirmede `verifyAwinMapping` ile kanıtlanabilir.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { runSource, type IngestRepository } from '../pipeline.js';
import { assertMerchantIsolation } from '../merchantIsolation.js';
import { IngestError } from '../errors.js';
import type { IngestSummary, NormalizedOffer, SourceConfig } from '../types.js';
import { AWIN_COLUMNS, AWIN_DATAFEED_SECRET_REF, AWIN_FIELD_MAPPING } from './awinDatafeed.js';

/** Operatör tarafından bildirilen doğrulanmış kimlikler. */
const MID = '158122';
const FEED_ID = '2281';
/** TEST VERİSİ -- gerçek ana sayfa DEPODA KAYITLI DEĞİL (blocker). */
const TEST_HOST = 'simpleproject-test.invalid';

/* TEST VERİSİ -- sahte kimlik bilgisi; gerçek anahtar değildir. */
process.env.AWIN_DATAFEED_API_KEY ??= 'TEST-ONLY-NOT-A-REAL-KEY';

const SOURCE: SourceConfig = {
  id: 'src-simple-project',
  slug: 'simple-project-awin-f2281',
  merchantId: 'merchant-simple-project',
  kind: 'feed_csv',
  endpointUrl:
    'https://ui.awin.com/productdata-darwin-download/publisher/3074081/'
    + '${AWIN_DATAFEED_API_KEY}/1/feed/F2281.csv.gz',
  marketCode: 'US',
  countryCode: 'US',
  currency: 'USD',
  allowedHosts: [TEST_HOST],
  fieldMapping: AWIN_FIELD_MAPPING,
  authType: 'query',
  authSecretRef: AWIN_DATAFEED_SECRET_REF,
  feedId: FEED_ID,
  expectedAdvertiserId: MID,
};

const KOLONLAR = [
  AWIN_COLUMNS.awProductId, AWIN_COLUMNS.productName, AWIN_COLUMNS.searchPrice,
  AWIN_COLUMNS.merchantDeepLink, AWIN_COLUMNS.ean, AWIN_COLUMNS.brandName,
  AWIN_COLUMNS.merchantImageUrl, AWIN_COLUMNS.description, AWIN_COLUMNS.inStock,
  AWIN_COLUMNS.merchantCategory, AWIN_COLUMNS.currency, AWIN_COLUMNS.merchantId,
];

function satir(i: number, over: Record<string, string> = {}): string {
  const v: Record<string, string> = {
    [AWIN_COLUMNS.awProductId]: `SP-${i}`,
    [AWIN_COLUMNS.productName]: `Test Urun ${i}`,
    [AWIN_COLUMNS.searchPrice]: '19.99',
    [AWIN_COLUMNS.merchantDeepLink]: `https://${TEST_HOST}/p/${i}`,
    [AWIN_COLUMNS.ean]: '',
    [AWIN_COLUMNS.brandName]: 'Simple Project',
    [AWIN_COLUMNS.merchantImageUrl]: `https://${TEST_HOST}/i/${i}.jpg`,
    [AWIN_COLUMNS.description]: 'Test aciklama',
    [AWIN_COLUMNS.inStock]: '1',
    [AWIN_COLUMNS.merchantCategory]: 'Elektronik',
    [AWIN_COLUMNS.currency]: 'USD',
    [AWIN_COLUMNS.merchantId]: MID,
    ...over,
  };
  return KOLONLAR.map((k) => v[k]!).join(',');
}

function feed(...satirlar: string[]): string {
  return [KOLONLAR.join(','), ...satirlar].join('\n');
}

function fakeRepository() {
  const fingerprints = new Map<string, string>();
  const calls = {
    upserted: [] as Array<NormalizedOffer & { groupId: string | null }>,
    upsertCallCount: 0,
    markStaleCount: 0,
    finished: [] as IngestSummary[],
  };
  const repository: IngestRepository = {
    async getFingerprints() { return new Map(fingerprints); },
    async touchSeen() {},
    async saveRefreshPlan() {},
    async findCategoryIdsBySlug(slugs) {
      return new Map(slugs.filter((s) => s === 'elektronik').map((s) => [s, 'cat-1']));
    },
    async findGroupsByGtin() { return new Map(); },
    async findGroupsBySignature() { return new Map(); },
    async createGroups(groups) {
      return new Map(groups.map((g, i) => [g.signature, `group-${i + 1}`]));
    },
    async upsertOffers(_m, _s, rows) {
      calls.upsertCallCount += 1;
      calls.upserted.push(...rows);
      let created = 0; let updated = 0;
      for (const row of rows) {
        if (fingerprints.has(row.externalId)) updated += 1; else created += 1;
        fingerprints.set(row.externalId, row.fingerprint);
      }
      return { created, updated };
    },
    async markStale() { calls.markStaleCount += 1; return 0; },
    async startRun() { return 'run-sp'; },
    async finishRun(_r, s) { calls.finished.push(s); },
  };
  return { repository, calls };
}

const fetcherFor = (body: string) => ({
  get: async () => ({ body, contentType: 'text/csv' }),
});

// --- 1) Feed eşleşmesi: F2281 / 2281 -> MID 158122 --------------------------

test('feed 2281 kaynağı MID 158122 bekler', () => {
  assert.equal(SOURCE.feedId, '2281');
  assert.equal(SOURCE.expectedAdvertiserId, '158122');
  // Feed ID ile MID AYRI uzaylardır; eşitlenmeleri bir hata olurdu.
  assert.notEqual(SOURCE.feedId, SOURCE.expectedAdvertiserId);
});

test('eşleşen reklamveren doğrulamayı geçer', () => {
  const sonuc = assertMerchantIsolation(
    [{ [AWIN_COLUMNS.merchantId]: MID }, { [AWIN_COLUMNS.merchantId]: MID }],
    AWIN_FIELD_MAPPING,
    { advertiserId: MID, feedId: FEED_ID, sourceSlug: SOURCE.slug },
  );
  assert.equal(sonuc.checked, 2);
  assert.deepEqual(sonuc.advertiserIds, [MID]);
});

// --- 2) MAĞAZA İZOLASYONU ---------------------------------------------------

test('BİRLEŞİK feed: yabancı reklamveren alımı DURDURUR', async () => {
  /*
   * Asıl korunan senaryo. Birleşik indirme (215 feed) tek kaynağa
   * bağlanırsa, 215 mağazanın ürünü tek mağazaya yazılırdı.
   */
  const { repository, calls } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: fetcherFor(feed(
      satir(1),
      satir(2, { [AWIN_COLUMNS.merchantId]: '61655' }), // BTO -- bize ait değil
      satir(3, { [AWIN_COLUMNS.merchantId]: '25962' }),
    )),
    repository,
  });

  assert.equal(summary.status, 'failed');
  assert.equal(summary.errorClass, 'SECURITY_ERROR');
  assert.equal(summary.errorPermanent, true);
  assert.equal(calls.upsertCallCount, 0, 'hiçbir ürün yazılmamalı');
  assert.equal(calls.upserted.length, 0);
  assert.equal(calls.markStaleCount, 0, 'bayatlatma da yapılmamalı');
});

test('yabancı MID hata metninde adıyla anılır, ürün satırı sızmaz', async () => {
  const { repository } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: fetcherFor(feed(satir(1), satir(2, { [AWIN_COLUMNS.merchantId]: '61655' }))),
    repository,
  });
  assert.match(summary.error!, /61655/);
  assert.match(summary.error!, /158122/);
  assert.ok(!summary.error!.includes('Test Urun'), 'ürün adı hata metnine girmemeli');
});

test('merchant_id kolonu boşsa FAIL CLOSED', async () => {
  const { repository, calls } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: fetcherFor(feed(satir(1, { [AWIN_COLUMNS.merchantId]: '' }))),
    repository,
  });
  assert.equal(summary.errorClass, 'SECURITY_ERROR');
  assert.equal(calls.upsertCallCount, 0);
});

test('iddia var ama merchant_id EŞLENMEMİŞSE alım durur', () => {
  const { merchant_id: _atilan, ...eksikEsleme } = AWIN_FIELD_MAPPING;
  assert.throws(
    () => assertMerchantIsolation([{ x: '1' }], eksikEsleme, {
      advertiserId: MID, feedId: FEED_ID, sourceSlug: SOURCE.slug,
    }),
    (e: unknown) => {
      assert.ok(e instanceof IngestError);
      assert.equal(e.errorClass, 'CONFIG_ERROR');
      assert.equal(e.permanent, true);
      return true;
    },
  );
});

test('expectedAdvertiserId YOKSA denetim çalışmaz (geriye dönük uyumluluk)', async () => {
  const { expectedAdvertiserId: _yok, ...eskiKaynak } = SOURCE;
  const { repository, calls } = fakeRepository();
  const summary = await runSource(eskiKaynak as SourceConfig, {
    fetcher: fetcherFor(feed(satir(1), satir(2, { [AWIN_COLUMNS.merchantId]: '99999' }))),
    repository,
  });
  // Denetim yok -> eski davranış: iki satır da yazılır.
  assert.equal(summary.itemsCreated, 2);
  assert.equal(calls.upsertCallCount, 1);
});

// --- 3) UPSERT / duplicate --------------------------------------------------

test('aynı feed iki kez: duplicate oluşmaz', async () => {
  const { repository, calls } = fakeRepository();
  const icerik = feed(satir(1), satir(2), satir(3));

  const birinci = await runSource(SOURCE, { fetcher: fetcherFor(icerik), repository });
  assert.equal(birinci.itemsCreated, 3);

  const ikinci = await runSource(SOURCE, { fetcher: fetcherFor(icerik), repository });
  assert.equal(ikinci.itemsCreated, 0);
  assert.equal(ikinci.itemsUpdated, 0);
  assert.equal(ikinci.itemsUnchanged, 3);
  assert.equal(calls.upsertCallCount, 1, 'ikinci turda yazma çağrısı olmamalı');
});

// --- 4) ANLIK GÖRÜNTÜ (659 ürün 50.000 sınırına takılmaz) -------------------

test('659 ürünlük feed tamamlanır ve snapshotComplete=true olur', async () => {
  const { repository, calls } = fakeRepository();
  const satirlar = Array.from({ length: 659 }, (_, i) => satir(i + 1));

  const summary = await runSource(SOURCE, {
    fetcher: fetcherFor(feed(...satirlar)),
    repository,
  });

  assert.equal(summary.itemsSeen, 659);
  assert.equal(summary.itemsCreated, 659);
  assert.equal(summary.itemsFailed, 0);
  assert.equal(summary.snapshotComplete, true);
  assert.equal(calls.markStaleCount, 1, 'tam görüntüde bayatlatma ÇALIŞIR');
});

// --- 5) YARIM ALIM GÜVENLİĞİ ------------------------------------------------

test('boş feed sağlıklı ürünleri bayatlatmaz', async () => {
  const { repository, calls } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: fetcherFor(KOLONLAR.join(',')), // yalnızca başlık
    repository,
  });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.snapshotComplete, false);
  assert.equal(calls.markStaleCount, 0, 'katalog korunmalı');
});

test('indirme hatasında hiçbir şey bayatlatılmaz', async () => {
  const { repository, calls } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: { get: async () => { throw new Error('baglanti koptu'); } },
    repository,
  });
  assert.equal(summary.status, 'failed');
  assert.equal(calls.markStaleCount, 0);
  assert.equal(calls.upsertCallCount, 0);
});

// --- 6) KİMLİK BİLGİSİ GÜVENLİĞİ --------------------------------------------

test('kimlik bilgisi hata metnine SIZMAZ', async () => {
  const sir = 'SUPER-GIZLI-TEST-ANAHTARI-123456';
  process.env.AWIN_DATAFEED_API_KEY = sir;

  const { repository } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: {
      // Gerçek istemci gibi: hata metni çözülmüş adresi taşıyor.
      get: async (url: string) => { throw new Error(`indirme basarisiz: ${url}`); },
    },
    repository,
  });

  const hepsi = JSON.stringify(summary);
  assert.ok(!hepsi.includes(sir), 'sır hiçbir alanda görünmemeli');
  assert.equal(summary.status, 'failed');

  process.env.AWIN_DATAFEED_API_KEY = 'TEST-ONLY-NOT-A-REAL-KEY';
});

test('kaynak yapılandırmasında sırrın DEĞERİ değil ADI durur', () => {
  assert.equal(SOURCE.authSecretRef, 'AWIN_DATAFEED_API_KEY');
  assert.ok(SOURCE.endpointUrl!.includes('${AWIN_DATAFEED_API_KEY}'));
  // Adres şablonu çözülmemiş hâlde saklanır; gerçek anahtar içermez.
  assert.ok(!SOURCE.endpointUrl!.includes('TEST-ONLY'));
});

// --- 7) AFFILIATE ZİNCİRİ ---------------------------------------------------

test('affiliate: katalogda mağaza adresi durur, awin1.com sarmalayıcısı DEĞİL', async () => {
  /*
   * `/git/[offerId]` rotası `merchants.deeplink_template` ile TEK SEFER
   * sarar. Katalogda sarılmış adres saklamak çift sarmalama üretir ve
   * tıklama bizim clickref'imizle atfedilmez.
   */
  const { repository, calls } = fakeRepository();
  await runSource(SOURCE, { fetcher: fetcherFor(feed(satir(1))), repository });

  const url = calls.upserted[0]!.productUrl;
  assert.equal(url, `https://${TEST_HOST}/p/1`);
  assert.ok(!url.includes('awin1.com'));
});

// --- 8) PARA BİRİMİ ---------------------------------------------------------

test('USD ürünleri TRY olarak KAYDEDİLMEZ', async () => {
  const { repository, calls } = fakeRepository();
  await runSource(SOURCE, { fetcher: fetcherFor(feed(satir(1))), repository });

  assert.equal(calls.upserted[0]!.currency, 'USD');
  assert.notEqual(calls.upserted[0]!.currency, 'TRY');
});

test('para birimi hücresi boşsa kaynağın USD varsayılanına düşer, TRY olmaz', async () => {
  const { repository, calls } = fakeRepository();
  await runSource(SOURCE, {
    fetcher: fetcherFor(feed(satir(1, { [AWIN_COLUMNS.currency]: '' }))),
    repository,
  });
  assert.equal(calls.upserted[0]!.currency, 'USD');
});

test('pazar US olarak yazılır', async () => {
  const { repository } = fakeRepository();
  const summary = await runSource(SOURCE, { fetcher: fetcherFor(feed(satir(1))), repository });
  assert.equal(summary.status, 'success');
  assert.equal(SOURCE.marketCode, 'US');
});
