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
  'SKU-1,Sony WH-1000XM5 Kulaklık,11899.00,https://magaza.example/p/1,4548736134546,Sony',
  'SKU-2,Apple iPhone 15 128GB,53499.00,https://magaza.example/p/2,0195949038204,Apple',
].join('\n');

/** Çağrıları kaydeden sahte depo. */
function fakeRepository(overrides: Partial<IngestRepository> = {}) {
  const calls = {
    markStale: 0,
    upserted: [] as Array<NormalizedOffer & { groupId: string | null; fingerprint: string }>,
    /** upsertOffers'a hangi pazarın geçtiği — pazar izolasyonunun kanıtı. */
    upsertMarkets: [] as Array<SourceConfig['market']>,
    createdGroups: [] as string[],
    finished: [] as IngestSummary[],
  };

  const repository: IngestRepository = {
    async getFingerprints() {
      return new Map<string, string>();
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
        calls.createdGroups.push(group.signature);
        result.set(group.signature, `group-${index + 1}`);
      }
      return result;
    },
    async upsertOffers(_merchantId, _sourceId, rows, market) {
      calls.upserted.push(...rows);
      calls.upsertMarkets.push(market);
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


/*
 * PAZAR KAYNAKTAN TEKLİFE TAŞINIR.
 *
 * Pazar alanı eklendiğinde hattın onu yazmayı unutması, sütunun
 * varsayılanda ('TR') kalması demekti: Alman feed'inden gelen teklifler
 * sessizce Türk pazarına düşerdi. Şema, para birimi uyuşmadığı için
 * bunların çoğunu reddeder -- ama EUR fiyatlı bir Avusturya feed'i
 * sessizce Almanya'ya karışabilirdi. Bu yüzden taşıma AYRICA sınanıyor.
 */
test('kaynağın pazarı upsertOffers çağrısına geçirilir', async () => {
  const { repository, calls } = fakeRepository();

  await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository });

  assert.deepEqual(calls.upsertMarkets, ['TR']);
});

test('farklı pazardaki kaynak kendi pazarını taşır', async () => {
  const { repository, calls } = fakeRepository();

  await runSource(
    { ...SOURCE, market: 'DE', currency: 'EUR' },
    { fetcher: fakeFetcher(CSV), repository },
  );

  assert.deepEqual(calls.upsertMarkets, ['DE']);
  // Pazar değişti diye teklifler kaybolmamalı.
  assert.equal(calls.upserted.length, 2);
});

/* =========================================================================
 * DELTA SYNC — GERÇEK HAT ENTEGRASYONU
 * -------------------------------------------------------------------------
 * Buradaki testler `classifyDelta`'yı doğrudan çağırmıyor. Hepsi
 * `runSource` üzerinden geçiyor -- yani delta'nın gerçek yürütme yolunda
 * olduğunu sınıyorlar. İzole fonksiyonun doğru çalışması, hatta bağlı
 * olduğunu KANITLAMAZ.
 * ========================================================================= */

/** İlk turdan sonraki "bilinen durum"u taklit eden depo. */
function deltaRepository(onceki: Map<string, string>) {
  const { repository, calls } = fakeRepository({
    async getFingerprints() {
      return onceki;
    },
  });
  return { repository, calls };
}

test('DELTA: bilinmeyen kalemler yazılır (NEW)', async () => {
  const { repository, calls } = deltaRepository(new Map());

  const summary = await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository });

  assert.equal(calls.upserted.length, 2);
  assert.equal(summary.itemsUnchanged, 0);
  // Her yazılan satır bir sonraki tur için parmak izi taşımalı.
  assert.ok(calls.upserted.every((r) => typeof r.fingerprint === 'string' && r.fingerprint.length > 0));
});

/*
 * AYNI ANLIK GÖRÜNTÜ İKİ KEZ → İKİNCİSİNDE HİÇ YAZMA.
 *
 * Bu, delta'nın varlık sebebi. 50.000 üründe hiçbiri değişmediyse
 * 50.000 yazma, tetikleyici ve yeniden indeksleme yapılmamalı.
 */
test('DELTA: aynı feed ikinci kez alınırsa hiçbir şey yazılmaz (UNCHANGED)', async () => {
  const ilk = deltaRepository(new Map());
  await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository: ilk.repository });

  // İlk turun yazdığı parmak izleri artık "bilinen durum".
  const bilinen = new Map(ilk.calls.upserted.map((r) => [r.externalId, r.fingerprint]));

  const ikinci = deltaRepository(bilinen);
  const summary = await runSource(SOURCE, {
    fetcher: fakeFetcher(CSV),
    repository: ikinci.repository,
  });

  assert.equal(ikinci.calls.upserted.length, 0);
  assert.equal(summary.itemsUnchanged, 2);
  assert.equal(summary.itemsCreated, 0);
  assert.equal(summary.itemsUpdated, 0);
});

test('DELTA: yalnızca fiyatı değişen kalem yazılır (CHANGED)', async () => {
  const ilk = deltaRepository(new Map());
  await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository: ilk.repository });
  const bilinen = new Map(ilk.calls.upserted.map((r) => [r.externalId, r.fingerprint]));

  // SKU-1'in fiyatı düştü; SKU-2 aynı.
  const degisenCsv = CSV.replace('11899.00', '9999.00');

  const ikinci = deltaRepository(bilinen);
  const summary = await runSource(SOURCE, {
    fetcher: fakeFetcher(degisenCsv),
    repository: ikinci.repository,
  });

  assert.equal(ikinci.calls.upserted.length, 1);
  assert.equal(ikinci.calls.upserted[0]!.externalId, 'SKU-1');
  assert.equal(summary.itemsUnchanged, 1);
});

/*
 * KIRPILMIŞ FEED BAYATLATMA YAPMAZ.
 *
 * ÖLÇÜLEN GERÇEK ARIZA: bu bayrak eklenmeden önce `markStale` kırpılmış
 * bir turdan sonra da çalışıyordu. 60.000 kalemlik bir feed'de sınırın
 * ötesindeki teklifler HER TURDA "görülmedi" sayılıp stoksuz
 * işaretleniyordu -- kısmi anlık görüntüden toplu geçersizleştirme.
 */
test('DELTA: geçiş oranı düşükse anlık görüntü EKSİK sayılır ve bayatlatma atlanır', async () => {
  // Dört satırın üçü geçersiz adres taşıyor: geçiş oranı %25.
  const bozukCsv = [
    'id,title,price,link,gtin,brand',
    'SKU-1,Gecerli Urun,100.00,https://magaza.example/p/1,4548736134546,Sony',
    'SKU-2,Bozuk Urun,100.00,https://baska-site.gecersiz/p/2,,Marka',
    'SKU-3,Bozuk Urun,100.00,https://baska-site.gecersiz/p/3,,Marka',
    'SKU-4,Bozuk Urun,100.00,https://baska-site.gecersiz/p/4,,Marka',
  ].join('\n');

  const { repository, calls } = deltaRepository(new Map());
  const summary = await runSource(SOURCE, {
    fetcher: fakeFetcher(bozukCsv),
    repository,
  });

  assert.equal(summary.snapshotComplete, false);
  // Katalog korundu: bayatlatma HİÇ çağrılmadı.
  assert.equal(calls.markStale, 0);
  assert.equal(summary.status, 'partial');
});

test('DELTA: tam anlık görüntüde bayatlatma çalışır', async () => {
  const { repository, calls } = deltaRepository(new Map());
  const summary = await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository });

  assert.equal(summary.snapshotComplete, true);
  assert.equal(calls.markStale, 1);
});

/*
 * Feed hiç indirilemezse anlık görüntü asla "tam" olmamalı. Güvenli
 * varsayılan sayesinde hata yolunda buraya hiç gelinmese bile
 * bayatlatma yapılmaz.
 */
test('DELTA: alım başarısız olursa anlık görüntü tam sayılmaz', async () => {
  const { repository, calls } = deltaRepository(new Map());

  const summary = await runSource(SOURCE, {
    fetcher: {
      get: async () => {
        throw new Error('ag hatasi');
      },
    },
    repository,
  });

  assert.equal(summary.status, 'failed');
  assert.equal(summary.snapshotComplete, false);
  assert.equal(calls.markStale, 0);
});

test('DELTA: boş feed bayatlatma yapmaz ve hata verir', async () => {
  const { repository, calls } = deltaRepository(new Map());
  const summary = await runSource(SOURCE, {
    fetcher: fakeFetcher('id,title,price,link\n'),
    repository,
  });

  assert.equal(summary.status, 'failed');
  assert.equal(calls.markStale, 0);
});

/*
 * PAZAR PARMAK İZİNE GİRER.
 *
 * Aynı dış kimliğe sahip TR ve DE teklifi aynı entity gibi
 * karşılaştırılmamalı; aksi halde Alman feed'i Türk kataloğunu
 * "değişmedi" diye atlatabilirdi.
 */
test('DELTA: pazar değişince aynı kalem CHANGED sayılır', async () => {
  const tr = deltaRepository(new Map());
  await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository: tr.repository });
  const trIzler = new Map(tr.calls.upserted.map((r) => [r.externalId, r.fingerprint]));

  // Aynı dış kimlikler, farklı pazar.
  const de = deltaRepository(trIzler);
  await runSource(
    { ...SOURCE, market: 'DE', currency: 'EUR' },
    { fetcher: fakeFetcher(CSV), repository: de.repository },
  );

  // TR parmak izleri DE turunda eşleşmemeli.
  assert.equal(de.calls.upserted.length, 2);
});

test('DELTA: parmak izi aynı girdi için kararlı', async () => {
  const a = deltaRepository(new Map());
  await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository: a.repository });

  const b = deltaRepository(new Map());
  await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository: b.repository });

  const izlerA = a.calls.upserted.map((r) => r.fingerprint).sort();
  const izlerB = b.calls.upserted.map((r) => r.fingerprint).sort();
  assert.deepEqual(izlerA, izlerB);
});

test('DELTA: özet sayaçları tutarlı', async () => {
  const ilk = deltaRepository(new Map());
  await runSource(SOURCE, { fetcher: fakeFetcher(CSV), repository: ilk.repository });
  const bilinen = new Map(ilk.calls.upserted.map((r) => [r.externalId, r.fingerprint]));

  const ikinci = deltaRepository(bilinen);
  const summary = await runSource(SOURCE, {
    fetcher: fakeFetcher(CSV.replace('11899.00', '8888.00')),
    repository: ikinci.repository,
  });

  assert.equal(summary.itemsSeen, 2);
  assert.equal(summary.itemsUnchanged + summary.itemsCreated, 2);
});

/*
 * KIRPMA YOLU DOĞRUDAN SINANIYOR.
 *
 * Bulunan asıl arıza buydu: 50.000 sınırında kırpılan bir feed'de
 * `markStale` yine de çalışıyor ve sınırın ötesindeki HER teklif
 * "bu beslemede görülmedi" sayılıp stoksuz işaretleniyordu. Sıralama
 * değişirse her turda başka bir dilim gidip geliyordu.
 *
 * Test 50.001 satır üretiyor -- pahalı ama bu kapının gerçekten
 * kapandığını başka türlü kanıtlamak mümkün değil.
 */
test('DELTA: KIRPILMIŞ feed bayatlatma yapmaz', async () => {
  const satirlar = ['id,title,price,link,gtin,brand'];
  for (let i = 0; i < 50_001; i += 1) {
    satirlar.push(`SKU-${i},Urun ${i},100.00,https://magaza.example/p/${i},,Marka`);
  }

  const { repository, calls } = deltaRepository(new Map());
  const summary = await runSource(SOURCE, {
    fetcher: fakeFetcher(satirlar.join('\n')),
    repository,
  });

  assert.equal(summary.itemsSeen, 50_000, 'kırpma gerçekten uygulandı');
  assert.equal(summary.snapshotComplete, false, 'kırpılmış görüntü tam sayılmamalı');
  // Katalog korundu.
  assert.equal(calls.markStale, 0);
  assert.equal(summary.status, 'partial');
});
