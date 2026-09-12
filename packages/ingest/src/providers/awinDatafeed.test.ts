/**
 * Awin datafeed testleri — SABİT VERİYLE (fixture), canlı feed olmadan.
 *
 * ======================================================================
 * BURADAKİ HİÇBİR ŞEY CANLI AWIN'E KARŞI DOĞRULANMADI.
 * ======================================================================
 * `productdata.awin.com` ve `api.awin.com` bu ortamın ağ politikasıyla
 * engelli. Aşağıdaki fixture'lar, Awin'in yayınlanmış datafeed şemasına
 * GÖRE yazılmış TEMSİLİ TEST VERİSİDİR; gerçek bir feed'in kopyası
 * DEĞİLDİR. Ürün adları, fiyatlar, kimlikler ve alan adları uydurmadır ve
 * hiçbir gerçek mağazayı, ürünü ya da fiyatı temsil etmez.
 *
 * Testlerin kanıtladığı şey: HATTIN DAVRANIŞI (ayrıştırma, açma,
 * doğrulama, eleme, idempotentlik). Kanıtlamadığı şey: Awin'in kolon
 * adlarının gerçekten böyle olduğu. İkincisi yalnızca gerçek bir
 * indirmede `verifyAwinMapping` ile kanıtlanabilir.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { runSource, type IngestRepository } from '../pipeline.js';
import type { IngestSummary, NormalizedOffer, SourceConfig } from '../types.js';
import { parseStock } from '../normalize.js';
import {
  AWIN_COLUMNS,
  AWIN_RETAIL_FIELD_MAPPING,
  AWIN_DATAFEED_SECRET_REF,
  AWIN_FIELD_MAPPING,
  checkCommercialActivation,
  verifyAwinMapping,
} from './awinDatafeed.js';

/** TEST VERİSİ — uydurma mağaza alan adı. */
const TEST_HOST = 'test-magaza.invalid';

/*
 * TEST VERİSİ — SAHTE kimlik bilgisi.
 *
 * Adres şablonundaki `${AWIN_DATAFEED_API_KEY}` yer tutucusu ortamdan
 * çözülür; değişken yoksa hat KALICI `CONFIG_ERROR` verir (doğru davranış).
 * Testin ölçtüğü şey o değil, o yüzden burada bilerek sahte bir değer
 * konuyor. GERÇEK ANAHTAR DEĞİLDİR ve hiçbir yere gönderilmez --
 * getirici sahte, ağ erişimi yok.
 */
process.env.AWIN_DATAFEED_API_KEY ??= 'TEST-ONLY-NOT-A-REAL-KEY';

const SOURCE: SourceConfig = {
  id: 'src-awin-test',
  slug: 'awin-test-feed',
  merchantId: 'merchant-awin-test',
  kind: 'feed_csv',
  // TEST VERİSİ. Gerçek Awin adresi DEĞİL; `.invalid` ayrılmış bir TLD'dir.
  endpointUrl: 'https://productdata.invalid/feed.csv?apikey=${AWIN_DATAFEED_API_KEY}',
  marketCode: 'EU',
  countryCode: 'GB',
  currency: 'GBP',
  allowedHosts: [TEST_HOST],
  fieldMapping: AWIN_FIELD_MAPPING,
  authType: 'query',
  authSecretRef: AWIN_DATAFEED_SECRET_REF,
};

const BASLIK = [
  AWIN_COLUMNS.awProductId,
  AWIN_COLUMNS.productName,
  AWIN_COLUMNS.searchPrice,
  AWIN_COLUMNS.merchantDeepLink,
  AWIN_COLUMNS.awDeepLink,
  AWIN_COLUMNS.ean,
  AWIN_COLUMNS.brandName,
  AWIN_COLUMNS.merchantImageUrl,
  AWIN_COLUMNS.description,
  AWIN_COLUMNS.inStock,
  AWIN_COLUMNS.rrpPrice,
  AWIN_COLUMNS.merchantCategory,
  AWIN_COLUMNS.deliveryCost,
  AWIN_COLUMNS.currency,
  AWIN_COLUMNS.merchantId,
].join(',');

/** TEST VERİSİ — tek satır kurucu. */
function satir(over: Partial<Record<string, string>> = {}): string {
  const v: Record<string, string> = {
    [AWIN_COLUMNS.awProductId]: 'AWTEST-1',
    [AWIN_COLUMNS.productName]: 'Test Kablosuz Kulaklik',
    [AWIN_COLUMNS.searchPrice]: '99.99',
    [AWIN_COLUMNS.merchantDeepLink]: `https://${TEST_HOST}/p/1`,
    [AWIN_COLUMNS.awDeepLink]: 'https://www.awin1.com/cread.php?awinmid=0&ued=x',
    [AWIN_COLUMNS.ean]: '4548736134546',
    [AWIN_COLUMNS.brandName]: 'TestBrand',
    [AWIN_COLUMNS.merchantImageUrl]: `https://${TEST_HOST}/i/1.jpg`,
    [AWIN_COLUMNS.description]: 'Test aciklamasi',
    [AWIN_COLUMNS.inStock]: '1',
    [AWIN_COLUMNS.rrpPrice]: '129.99',
    [AWIN_COLUMNS.merchantCategory]: 'Elektronik',
    [AWIN_COLUMNS.deliveryCost]: '4.99',
    [AWIN_COLUMNS.currency]: 'GBP',
    [AWIN_COLUMNS.merchantId]: '158122',
    ...over,
  };
  return [
    v[AWIN_COLUMNS.awProductId], v[AWIN_COLUMNS.productName], v[AWIN_COLUMNS.searchPrice],
    v[AWIN_COLUMNS.merchantDeepLink], v[AWIN_COLUMNS.awDeepLink], v[AWIN_COLUMNS.ean],
    v[AWIN_COLUMNS.brandName], v[AWIN_COLUMNS.merchantImageUrl], v[AWIN_COLUMNS.description],
    v[AWIN_COLUMNS.inStock], v[AWIN_COLUMNS.rrpPrice], v[AWIN_COLUMNS.merchantCategory],
    v[AWIN_COLUMNS.deliveryCost], v[AWIN_COLUMNS.currency],
    v[AWIN_COLUMNS.merchantId],
  ].join(',');
}

function feed(...satirlar: string[]): string {
  return [BASLIK, ...satirlar].join('\n');
}

/**
 * Sahte depo — parmak izlerini TURLAR ARASINDA saklar.
 *
 * Idempotentlik testinin can alıcı noktası bu: kalıcı bir parmak izi
 * deposu olmadan ikinci tur her şeyi yeniden NEW sayardı ve test
 * idempotentliği değil yalnızca "iki kez çalıştı"yı kanıtlardı.
 */
function fakeRepository() {
  const fingerprints = new Map<string, string>();
  const calls = {
    upserted: [] as Array<NormalizedOffer & { groupId: string | null; fingerprint: string }>,
    upsertCallCount: 0,
    finished: [] as IngestSummary[],
  };

  const repository: IngestRepository = {
    async getFingerprints() {
      return new Map(fingerprints);
    },
    async touchSeen() {},
    async saveRefreshPlan() {},
    async findCategoryIdsBySlug(slugs) {
      return new Map(
        slugs.filter((s) => s === 'elektronik').map((s) => [s, 'cat-elektronik']),
      );
    },
    async findGroupsByGtin() {
      return new Map();
    },
    async findGroupsBySignature() {
      return new Map();
    },
    async createGroups(groups) {
      return new Map(groups.map((g, i) => [g.signature, `group-${i + 1}`]));
    },
    async upsertOffers(_m, _s, rows) {
      calls.upsertCallCount += 1;
      calls.upserted.push(...rows);

      let created = 0;
      let updated = 0;
      for (const row of rows) {
        if (fingerprints.has(row.externalId)) updated += 1;
        else created += 1;
        fingerprints.set(row.externalId, row.fingerprint);
      }
      return { created, updated };
    },
    async markStale() {
      return 0;
    },
    async startRun() {
      return 'run-test';
    },
    async finishRun(_r, summary) {
      calls.finished.push(summary);
    },
  };

  return { repository, calls };
}

function fetcherFor(body: string) {
  return { get: async () => ({ body, contentType: 'text/csv' }) };
}

/** Gerçek getiricinin yaptığı gibi HAM BAYT taşıyan sahte getirici. */
function gzipFetcherFor(body: string) {
  const bytes = new Uint8Array(gzipSync(Buffer.from(body, 'utf8')));
  return {
    get: async () => ({
      body: new TextDecoder('utf-8').decode(bytes), // bozuk metin — bilerek
      contentType: 'application/octet-stream',
      bytes,
    }),
  };
}

// --- Eşleme doğrulaması -----------------------------------------------------

test('verifyAwinMapping: tam başlıkta hiçbir eksik bulunmaz', () => {
  const sonuc = verifyAwinMapping(BASLIK.split(','));
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.missingRequired, []);
  assert.deepEqual(sonuc.missingOptional, []);
});

test('verifyAwinMapping: eksik ZORUNLU kolon isimle bildirilir', () => {
  const eksik = BASLIK.split(',').filter((c) => c !== AWIN_COLUMNS.merchantDeepLink);
  const sonuc = verifyAwinMapping(eksik);

  assert.equal(sonuc.ok, false);
  assert.equal(sonuc.missingRequired.length, 1);
  assert.match(sonuc.missingRequired[0]!, /url -> merchant_deep_link/);
  assert.match(sonuc.summary, /kaynak açılmamalı/);
});

test('verifyAwinMapping: eksik İSTEĞE BAĞLI kolon kaynağı durdurmaz', () => {
  const eksik = BASLIK.split(',').filter((c) => c !== AWIN_COLUMNS.ean);
  const sonuc = verifyAwinMapping(eksik);

  assert.deepEqual(sonuc.missingRequired, []);
  assert.equal(sonuc.missingOptional.length, 1);
  assert.match(sonuc.missingOptional[0]!, /gtin -> ean/);
});

test('verifyAwinMapping: eşlenmeyen kolonlar raporlanır', () => {
  const sonuc = verifyAwinMapping([...BASLIK.split(','), 'commission_group', 'colour']);

  /*
   * `aw_deep_link` BİLEREK eşlenmemiştir (sarılmış ortaklık adresi;
   * `AWIN_FIELD_MAPPING` üzerindeki nota bakın) ve bu yüzden burada
   * görünmesi doğrudur -- rapor "gözden kaçan veri" değil, "eşlenmeyen
   * kolon" listesidir.
   */
  assert.deepEqual(sonuc.unmapped, ['aw_deep_link', 'commission_group', 'colour']);
});

test('verifyAwinMapping: kolon adı karşılaştırması büyük/küçük harf duyarsız', () => {
  const sonuc = verifyAwinMapping(BASLIK.split(',').map((c) => c.toUpperCase()));
  assert.equal(sonuc.ok, true);
});

// --- Ticari kapı (BTO / MID 61655) ------------------------------------------

test('ticari kapı: onaysız program yayına ALINAMAZ', () => {
  /*
   * Depo kaydı (07/09/2026): MID 61655 "Back to the Office"
   * status=prospect, application_status=not_started.
   */
  const sonuc = checkCommercialActivation({
    slug: 'back-to-the-office',
    applicationStatus: 'not_started',
    approvedAt: null,
    networkAdvertiserId: '61655',
    deeplinkTemplate: null,
  });

  assert.equal(sonuc.activatable, false);
  assert.ok(sonuc.blockers.some((b) => /onaylı değil/.test(b)));
  assert.ok(sonuc.blockers.some((b) => /Deeplink şablonu boş/.test(b)));
});

test('ticari kapı: MID VAR ama onay YOKsa yine kapalı', () => {
  // "MID biliniyor" ile "program onaylı" ayrı şeyler; kapı bunu ayırmalı.
  const sonuc = checkCommercialActivation({
    slug: 'ravin-crossbows',
    applicationStatus: 'not_started',
    approvedAt: null,
    networkAdvertiserId: '115809',
    deeplinkTemplate: 'https://www.awin1.com/cread.php?awinmid=115809&awinaffid=3074081&ued={url_encoded}',
  });
  assert.equal(sonuc.activatable, false);
});

test('ticari kapı: onaylı + MID + şablon varsa açılır', () => {
  const sonuc = checkCommercialActivation({
    slug: 'simple-project',
    applicationStatus: 'approved',
    approvedAt: '2026-09-06T00:00:00Z',
    networkAdvertiserId: '158122',
    deeplinkTemplate: 'https://www.awin1.com/cread.php?awinmid=158122&awinaffid=3074081&ued={url_encoded}',
  });
  assert.equal(sonuc.activatable, true);
  assert.deepEqual(sonuc.blockers, []);
});

// --- Hat davranışı ----------------------------------------------------------

test('geçerli Awin satırı teklife çevrilir', async () => {
  const { repository, calls } = fakeRepository();
  const summary = await runSource(SOURCE, { fetcher: fetcherFor(feed(satir())), repository });

  assert.equal(summary.itemsSeen, 1);
  assert.equal(summary.itemsCreated, 1);
  assert.equal(summary.itemsFailed, 0);

  const teklif = calls.upserted[0]!;
  assert.equal(teklif.externalId, 'AWTEST-1');
  assert.equal(teklif.priceCents, 9999);
  assert.equal(teklif.compareAtPriceCents, 12999);
  assert.equal(teklif.currency, 'GBP');
  assert.equal(teklif.gtin, '4548736134546');
  assert.equal(teklif.brand, 'TestBrand');
  assert.equal(teklif.shippingFeeCents, 499);
});

test('DEEPLINK: aw_deep_link DEĞİL merchant_deep_link saklanır', async () => {
  /*
   * Atfın sessizce bozulduğu tek nokta. `aw_deep_link` zaten sarılmış bir
   * ortaklık adresidir; onu saklamak `/git/[offerId]`in üzerine bir kez
   * daha sarması demekti (awin1.com içinde awin1.com) ve tıklama bizim
   * clickref'imizle atfedilmezdi.
   */
  const { repository, calls } = fakeRepository();
  await runSource(SOURCE, { fetcher: fetcherFor(feed(satir())), repository });

  const url = calls.upserted[0]!.productUrl;
  assert.equal(url, `https://${TEST_HOST}/p/1`);
  assert.ok(!url.includes('awin1.com'), 'ortaklık sarmalayıcısı katalogda saklanmamalı');
});

test('eksik isteğe bağlı alanlar null kalır, satır elenmez', async () => {
  const { repository, calls } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: fetcherFor(
      feed(satir({ [AWIN_COLUMNS.ean]: '', [AWIN_COLUMNS.brandName]: '', [AWIN_COLUMNS.rrpPrice]: '' })),
    ),
    repository,
  });

  assert.equal(summary.itemsCreated, 1);
  assert.equal(calls.upserted[0]!.gtin, null);
  assert.equal(calls.upserted[0]!.brand, null);
  assert.equal(calls.upserted[0]!.compareAtPriceCents, null);
});

test('geçersiz fiyat satırı elenir, geçerli satır yazılır', async () => {
  const { repository, calls } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: fetcherFor(
      feed(
        satir({ [AWIN_COLUMNS.awProductId]: 'AWTEST-OK' }),
        satir({ [AWIN_COLUMNS.awProductId]: 'AWTEST-BAD', [AWIN_COLUMNS.searchPrice]: 'N/A' }),
        satir({ [AWIN_COLUMNS.awProductId]: 'AWTEST-ZERO', [AWIN_COLUMNS.searchPrice]: '0.00' }),
      ),
    ),
    repository,
  });

  assert.equal(summary.itemsSeen, 3);
  assert.equal(summary.itemsFailed, 2);
  assert.equal(calls.upserted.length, 1);
  assert.equal(calls.upserted[0]!.externalId, 'AWTEST-OK');
});

test('bozuk satır (kolon sayısı tutmuyor) atlanır ve uyarı üretir', async () => {
  const { repository } = fakeRepository();
  const bozuk = [BASLIK, satir(), 'AWTEST-2,eksik,kolonlar'].join('\n');

  const summary = await runSource(SOURCE, { fetcher: fetcherFor(bozuk), repository });

  assert.equal(summary.itemsSeen, 1);
  assert.ok(summary.itemsSkipped >= 1);
  assert.equal(summary.status, 'partial');
});

test('stokta olmayan ürün yazılır, stock=0 olur', async () => {
  // Stoksuz ürün ELENMEZ: fiyat geçmişi ve "tekrar stokta" bildirimi için
  // kaydın durması gerekir.
  const { repository, calls } = fakeRepository();
  await runSource(SOURCE, {
    fetcher: fetcherFor(feed(satir({ [AWIN_COLUMNS.inStock]: '0' }))),
    repository,
  });

  assert.equal(calls.upserted.length, 1);
  assert.equal(calls.upserted[0]!.stock, 0);
});

test('para birimi feed kolonundan okunur, kaynak varsayılanını ezer', async () => {
  const { repository, calls } = fakeRepository();
  await runSource(SOURCE, {
    fetcher: fetcherFor(feed(satir({ [AWIN_COLUMNS.currency]: 'eur' }))),
    repository,
  });
  assert.equal(calls.upserted[0]!.currency, 'EUR');
});

test('para birimi kolonu boşsa kaynağın varsayılanı kullanılır', async () => {
  const { repository, calls } = fakeRepository();
  await runSource(SOURCE, {
    fetcher: fetcherFor(feed(satir({ [AWIN_COLUMNS.currency]: '' }))),
    repository,
  });
  assert.equal(calls.upserted[0]!.currency, 'GBP');
});

test('izinli alan adı dışındaki ürün adresi REDDEDİLİR', async () => {
  // Güvenlik: feed'in verdiği adres mağazanın alan adına ait olmalı.
  const { repository } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: fetcherFor(
      feed(satir({ [AWIN_COLUMNS.merchantDeepLink]: 'https://saldirgan.invalid/p/1' })),
    ),
    repository,
  });

  assert.equal(summary.itemsFailed, 1);
  assert.equal(summary.status, 'failed');
});

test('GZIP: sıkıştırılmış feed açılır ve işlenir', async () => {
  const { repository, calls } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: gzipFetcherFor(feed(satir())),
    repository,
  });

  assert.equal(summary.itemsSeen, 1);
  assert.equal(summary.itemsCreated, 1);
  assert.equal(calls.upserted[0]!.externalId, 'AWTEST-1');
});

test('IDEMPOTENTLİK: ikinci tur hiçbir şey yazmaz', async () => {
  /*
   * Beklenen model, hattın DELTA tasarımından gelir ve "ikinci turda
   * hepsi UPDATE" beklentisinden DAHA İYİdir: parmak izi değişmeyen
   * kalemler hiç yazılmaz.
   *
   *   1. tur: created = N, unchanged = 0
   *   2. tur: created = 0, updated = 0, unchanged = N, yazma çağrısı YOK
   */
  const { repository, calls } = fakeRepository();
  const icerik = feed(
    satir({ [AWIN_COLUMNS.awProductId]: 'AWTEST-1' }),
    satir({ [AWIN_COLUMNS.awProductId]: 'AWTEST-2' }),
    satir({ [AWIN_COLUMNS.awProductId]: 'AWTEST-3' }),
  );

  const birinci = await runSource(SOURCE, { fetcher: fetcherFor(icerik), repository });
  assert.equal(birinci.itemsCreated, 3);
  assert.equal(birinci.itemsNew, 3);

  const ikinci = await runSource(SOURCE, { fetcher: fetcherFor(icerik), repository });
  assert.equal(ikinci.itemsCreated, 0);
  assert.equal(ikinci.itemsUpdated, 0);
  assert.equal(ikinci.itemsUnchanged, 3);
  assert.equal(ikinci.itemsChanged, 0);
  assert.equal(calls.upsertCallCount, 1, 'ikinci turda hiç yazma çağrısı olmamalı');
});

test('IDEMPOTENTLİK: yalnızca fiyatı değişen kalem yazılır', async () => {
  const { repository, calls } = fakeRepository();
  const tur1 = feed(
    satir({ [AWIN_COLUMNS.awProductId]: 'AWTEST-1' }),
    satir({ [AWIN_COLUMNS.awProductId]: 'AWTEST-2' }),
  );
  await runSource(SOURCE, { fetcher: fetcherFor(tur1), repository });

  const tur2 = feed(
    satir({ [AWIN_COLUMNS.awProductId]: 'AWTEST-1', [AWIN_COLUMNS.searchPrice]: '89.99' }),
    satir({ [AWIN_COLUMNS.awProductId]: 'AWTEST-2' }),
  );
  const ikinci = await runSource(SOURCE, { fetcher: fetcherFor(tur2), repository });

  assert.equal(ikinci.itemsChanged, 1);
  assert.equal(ikinci.itemsUnchanged, 1);
  assert.equal(ikinci.itemsUpdated, 1);
  assert.equal(ikinci.itemsCreated, 0);
});

test('AYNI dış kimlik iki kez gelirse tek kanonik ürün açılır', async () => {
  const { repository, calls } = fakeRepository();
  const summary = await runSource(SOURCE, {
    fetcher: fetcherFor(feed(satir(), satir())),
    repository,
  });

  assert.equal(summary.itemsSeen, 2);
  // Delta dış kimliğe göre tekilleştirir: iki satır tek kalem olur.
  const kimlikler = new Set(calls.upserted.map((o) => o.externalId));
  assert.equal(kimlikler.size, 1);
});

test('boş feed kataloğu KORUR — bayatlatma yapılmaz', async () => {
  const { repository } = fakeRepository();
  const summary = await runSource(SOURCE, { fetcher: fetcherFor(BASLIK), repository });

  assert.equal(summary.status, 'failed');
  assert.equal(summary.snapshotComplete, false);
  assert.equal(summary.errorClass, 'PARSER_ERROR');
});

test('kimlik bilgisi eksikse hata DEĞİŞKEN ADINI söyler, değerini değil', () => {
  // `query` yönteminde başlık üretilmez; sır adres şablonunda taşınır ve
  // `expandSecretPlaceholders` çözer. Burada kanıtlanan: sabit bir AD,
  // asla bir DEĞER.
  assert.equal(AWIN_DATAFEED_SECRET_REF, 'AWIN_DATAFEED_API_KEY');
  assert.ok(!/[=:]/.test(AWIN_DATAFEED_SECRET_REF));
});

// --- Google Shopping biçimli Awin "retail" feed'i ---------------------------
// Bu bloktaki kolon adları GERÇEK bir feed dosyasına karşı doğrulandı
// (advertiser 99013, 636 satır, 62 kolon) -- klasik şemanın aksine tahmin değil.

test('retail eşlemesi gerçek feed başlığını eksiksiz karşılar', () => {
  const gercekBaslik = [
    'advertiser_id', 'advertiser_name', 'id', 'title', 'description', 'link',
    'image_link', 'additional_image_link', 'mobile_link', 'aw_deep_link',
    'google_product_category', 'product_type', 'gtin', 'mpn', 'brand',
    'availability', 'price', 'sale_price', 'condition', 'item_group_id', 'shipping',
  ];
  const sonuc = verifyAwinMapping(gercekBaslik, AWIN_RETAIL_FIELD_MAPPING);
  assert.equal(sonuc.ok, true);
  assert.deepEqual(sonuc.missingRequired, []);
  assert.deepEqual(sonuc.missingOptional, []);
});

test('retail eşlemesi izolasyonu advertiser_id ile yapar', () => {
  // Klasik şemada `merchant_id`, Google Shopping şemasında `advertiser_id`.
  assert.equal(AWIN_RETAIL_FIELD_MAPPING.merchant_id, 'advertiser_id');
  // Katalogda mağaza adresi durur, Awin sarmalayıcısı değil.
  assert.equal(AWIN_RETAIL_FIELD_MAPPING.url, 'link');
  assert.notEqual(AWIN_RETAIL_FIELD_MAPPING.url, 'aw_deep_link');
});

test('availability alt çizgili biçimde okunur', () => {
  // 'in_stock' eksikken STOKTAKİ HER ÜRÜN stoksuz yazılıyordu (636'da 476).
  assert.ok(parseStock('in_stock') > 0);
  assert.equal(parseStock('out_of_stock'), 0);
});
