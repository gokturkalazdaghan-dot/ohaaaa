import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SYNC_DEFAULTS,
  SyncPlanError,
  applySyncOutcome,
  batches,
  planSync,
  type SyncOutcome,
  type SyncState,
} from './incrementalSync.js';

/* =========================================================================
 * ARTIMLI SENKRONİZASYON
 * -------------------------------------------------------------------------
 * Kovalanan tehlikeler, hepsi SESSİZ olanlar:
 *   • yarıda kalmış turda su işaretinin ilerlemesi -> işlenmemiş satırlar
 *     SONSUZA KADAR atlanır
 *   • yalnız artımlı koşmak -> silinen ürünler katalogda sonsuza kadar kalır
 *   • dayanaksız artımlı kip -> kaynak sessizce boşalır
 * ========================================================================= */

const SIMDI = new Date('2026-09-07T12:00:00Z');

function durum(patch: Partial<SyncState> = {}): SyncState {
  return {
    syncMode: 'incremental',
    syncCursor: null,
    syncWatermark: '2026-09-07T06:00:00Z',
    httpEtag: null,
    httpLastModified: null,
    batchSize: 1000,
    lastFullSyncAt: '2026-09-07T00:00:00Z',
    ...patch,
  };
}

test('1) YARIDA KALMIŞ TUR her şeyden önce: kaldığı yerden', () => {
  // Yeni bir tam tarama başlatmak, o turun yaptığı işi çöpe atmak ve büyük
  // feed'lerde hiç bitmeyen bir döngüye girmektir.
  const p = planSync(durum({ syncCursor: 'sayfa-42' }), { now: SIMDI });

  assert.equal(p.strategy, 'resume');
  assert.equal(p.resumeCursor, 'sayfa-42');
});

test('1b) imleç tam tarama kipinde bile önceliklidir', () => {
  const p = planSync(durum({ syncMode: 'full', syncCursor: 'sayfa-7' }), { now: SIMDI });
  assert.equal(p.strategy, 'resume');
});

test('2) full kipte davranış BUGÜNKÜYLE AYNI', () => {
  const p = planSync(durum({ syncMode: 'full' }), { now: SIMDI });
  assert.equal(p.strategy, 'full');
});

test('3) SİLİNENLER için periyodik tam tarama', () => {
  // Artımlı feed kaldırılan ürünü hiç göndermez; yalnız artımlı koşulursa
  // katalog satılmayan ürünlerle sonsuza kadar dolu kalır.
  const bayat = planSync(durum({ lastFullSyncAt: '2026-09-05T00:00:00Z' }), {
    now: SIMDI,
    fullSyncIntervalHours: 24,
  });

  assert.equal(bayat.strategy, 'full');
  assert.match(bayat.reason, /SILINEN/);

  const taze = planSync(durum({ lastFullSyncAt: '2026-09-07T06:00:00Z' }), {
    now: SIMDI,
    fullSyncIntervalHours: 24,
  });
  assert.equal(taze.strategy, 'incremental');
});

test('3b) hiç tam tarama yapılmamışsa tam tarama', () => {
  const p = planSync(durum({ lastFullSyncAt: null }), { now: SIMDI });
  assert.equal(p.strategy, 'full');
});

test('4) KOŞULLU İSTEK en ucuzu: 304 alan tur hiçbir şey ayrıştırmaz', () => {
  const p = planSync(durum({ httpEtag: 'W/"abc"', httpLastModified: 'Mon, 07 Sep 2026 06:00:00 GMT' }), {
    now: SIMDI,
  });

  assert.equal(p.strategy, 'conditional');
  assert.deepEqual(p.conditionalHeaders, {
    'if-none-match': 'W/"abc"',
    'if-modified-since': 'Mon, 07 Sep 2026 06:00:00 GMT',
  });
  assert.equal(p.since, '2026-09-07T06:00:00Z', 'su işareti yine taşınmalı');
});

test('5) DAYANAKSIZ ARTIMLI KİP tam taramaya düşüyor (kapalı başarısız)', () => {
  // Dayanak yoksa "değişenleri getir" diyecek bir şey kalmaz ve tur
  // pratikte HİÇBİR ŞEY getirmez -- kaynak sessizce boşalır.
  const p = planSync(durum({ syncWatermark: null, httpEtag: null, httpLastModified: null }), {
    now: SIMDI,
  });

  assert.equal(p.strategy, 'full');
  assert.match(p.reason, /sessizce bosalmasi/);
});

test('6) su işareti varsa artımlı', () => {
  const p = planSync(durum(), { now: SIMDI });
  assert.equal(p.strategy, 'incremental');
  assert.equal(p.since, '2026-09-07T06:00:00Z');
});

test('7) SU İŞARETİ TUR BİTMEDEN İLERLEMİYOR', () => {
  // En kritik kural: yarıda kalmış turda ilerletmek, işlenmemiş satırları
  // SONSUZA KADAR atlamak demektir ve bu sessizdir.
  const plan = planSync(durum(), { now: SIMDI });
  const yarim: SyncOutcome = {
    completed: false,
    nextCursor: 'sayfa-9',
    newestSeenAt: '2026-09-07T11:00:00Z',
    etag: 'W/"yeni"',
    lastModified: 'x',
  };

  const g = applySyncOutcome(plan, yarim, SIMDI);

  assert.deepEqual(g, { sync_cursor: 'sayfa-9' });
  assert.ok(!('sync_watermark' in g), 'su işareti ilerlememeli');
  assert.ok(!('http_etag' in g), 'ETag da bir "buraya kadarı işlendi" iddiasıdır');
  assert.ok(!('last_full_sync_at' in g));
});

test('8) tur tamamlanınca su işareti, ETag ve imleç güncelleniyor', () => {
  const plan = planSync(durum(), { now: SIMDI });
  const tam: SyncOutcome = {
    completed: true,
    nextCursor: null,
    newestSeenAt: '2026-09-07T11:30:00Z',
    etag: 'W/"yeni"',
    lastModified: 'Mon, 07 Sep 2026 11:30:00 GMT',
  };

  const g = applySyncOutcome(plan, tam, SIMDI);

  assert.equal(g.sync_cursor, null);
  assert.equal(g.sync_watermark, '2026-09-07T11:30:00Z');
  assert.equal(g.http_etag, 'W/"yeni"');
  assert.ok(!('last_full_sync_at' in g), 'artımlı tur tam tarama sayılmaz');
});

test('9) TAM TARAMA bitince last_full_sync_at ilerliyor', () => {
  const plan = planSync(durum({ syncMode: 'full' }), { now: SIMDI });
  const g = applySyncOutcome(
    plan,
    { completed: true, nextCursor: null, newestSeenAt: null, etag: null, lastModified: null },
    SIMDI,
  );

  assert.equal(g.last_full_sync_at, SIMDI.toISOString());
});

test('9b) yarıda kalan turun SÜRDÜRÜLMESİ bitince de tam tarama sayılıyor', () => {
  const plan = planSync(durum({ syncCursor: 'sayfa-3' }), { now: SIMDI });
  const g = applySyncOutcome(
    plan,
    { completed: true, nextCursor: null, newestSeenAt: null, etag: null, lastModified: null },
    SIMDI,
  );

  assert.equal(plan.strategy, 'resume');
  assert.equal(g.last_full_sync_at, SIMDI.toISOString());
});

test('10) BELİRLENİMCİ: aynı durum her zaman aynı plan', () => {
  const d = durum();
  const ilk = planSync(d, { now: SIMDI });
  for (let i = 0; i < 200; i += 1) {
    assert.deepEqual(planSync({ ...d }, { now: new Date(SIMDI) }), ilk);
  }
});

test('11) bozuk girdi plan üretmiyor (kapalı başarısız)', () => {
  assert.throws(() => planSync(durum(), { now: new Date('gecersiz') }), SyncPlanError);
  assert.throws(() => planSync(durum({ batchSize: 0 }), { now: SIMDI }), SyncPlanError);
  assert.throws(() => planSync(durum({ batchSize: 1.5 }), { now: SIMDI }), SyncPlanError);
  assert.throws(
    () => planSync(durum({ lastFullSyncAt: 'dun' }), { now: SIMDI }),
    SyncPlanError,
  );
});

test('12) PARTİLEME: tek partide sınırsız satır belleğe alınmıyor', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  const partiler = [...batches(items, 10)];

  assert.equal(partiler.length, 3);
  assert.deepEqual(partiler[2], [20, 21, 22, 23, 24]);
  assert.equal(partiler.flat().length, 25, 'hiçbir satır kaybolmamalı');

  assert.deepEqual([...batches([], 10)], []);
  assert.throws(() => [...batches(items, 0)], SyncPlanError);
});

test('13) sayfa sınırı: asılı bir tur işçiyi süresiz tutmuyor', () => {
  assert.equal(planSync(durum(), { now: SIMDI }).maxPages, SYNC_DEFAULTS.maxPagesPerRun);
  assert.equal(planSync(durum(), { now: SIMDI, maxPagesPerRun: 5 }).maxPages, 5);
});
