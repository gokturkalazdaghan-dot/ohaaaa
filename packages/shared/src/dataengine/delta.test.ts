import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalFingerprint,
  classifyDelta,
  needsWrite,
  type FingerprintInput,
} from './delta.js';

const temel: FingerprintInput = {
  externalId: 'SKU-1',
  market: 'TR',
  merchantId: 'm-1',
  title: 'Sony WH-1000XM5 Kulaklik',
  priceCents: 1189900,
  currency: 'TRY',
  inStock: true,
  productUrl: 'https://magaza.gecersiz/p/1',
  shippingFeeCents: 0,
};

// --- Parmak izi kararlılığı ----------------------------------------------

test('aynı girdi aynı parmak izini üretir', () => {
  assert.equal(canonicalFingerprint(temel), canonicalFingerprint({ ...temel }));
});

/*
 * ALAN SIRASI ÖNEMSİZ OLMALI.
 *
 * İki farklı adaptör (CSV ve XML) aynı veriyi farklı nitelik sırasıyla
 * üretebilir. Sıra parmak izini değiştirseydi, biçim değiştirdiğimizde
 * tüm katalog "değişmiş" görünürdü.
 */
test('nitelik sırası parmak izini değiştirmez', () => {
  const a = canonicalFingerprint({ ...temel, attributes: { renk: 'siyah', beden: 'M' } });
  const b = canonicalFingerprint({ ...temel, attributes: { beden: 'M', renk: 'siyah' } });
  assert.equal(a, b);
});

test('başlıktaki fazladan boşluk parmak izini değiştirmez', () => {
  const a = canonicalFingerprint(temel);
  const b = canonicalFingerprint({ ...temel, title: '  Sony  WH-1000XM5   Kulaklik ' });
  assert.equal(a, b);
});

test('fiyat değişimi parmak izini değiştirir', () => {
  assert.notEqual(
    canonicalFingerprint(temel),
    canonicalFingerprint({ ...temel, priceCents: 1099900 }),
  );
});

/*
 * STOK DURUMU, ADEDİ DEĞİL.
 *
 * 12'den 11'e düşmek kullanıcı için hiçbir şey değiştirmez. Her stok
 * hareketini "değişim" saymak, kuyruğu anlamsız işle doldururdu.
 */
test('stok DURUMU değişimi parmak izini değiştirir', () => {
  assert.notEqual(
    canonicalFingerprint(temel),
    canonicalFingerprint({ ...temel, inStock: false }),
  );
});

test('farklı pazardaki aynı ürün farklı parmak izi alır', () => {
  assert.notEqual(
    canonicalFingerprint(temel),
    canonicalFingerprint({ ...temel, market: 'DE', currency: 'EUR' }),
  );
});

// --- Sınıflandırma --------------------------------------------------------

test('bilinmeyen kayıt NEW', () => {
  const r = classifyDelta({
    previous: new Map(),
    current: [temel],
    snapshotComplete: true,
  });
  assert.equal(r.entries[0]!.classification, 'NEW');
  assert.equal(r.counts.NEW, 1);
});

test('parmak izi aynıysa UNCHANGED', () => {
  const r = classifyDelta({
    previous: new Map([['SKU-1', canonicalFingerprint(temel)]]),
    current: [temel],
    snapshotComplete: true,
  });
  assert.equal(r.entries[0]!.classification, 'UNCHANGED');
});

test('yalnızca fiyat değiştiyse CHANGED', () => {
  const r = classifyDelta({
    previous: new Map([['SKU-1', canonicalFingerprint(temel)]]),
    current: [{ ...temel, priceCents: 999900 }],
    snapshotComplete: true,
  });
  assert.equal(r.entries[0]!.classification, 'CHANGED');
});

test('yalnızca stok değiştiyse CHANGED', () => {
  const r = classifyDelta({
    previous: new Map([['SKU-1', canonicalFingerprint(temel)]]),
    current: [{ ...temel, inStock: false }],
    snapshotComplete: true,
  });
  assert.equal(r.entries[0]!.classification, 'CHANGED');
});

/*
 * ZAMAN DAMGASI DEĞİŞTİ AMA İÇERİK AYNI.
 *
 * Parmak izine zaman damgası girseydi HER tarama "değişti" derdi ve
 * delta tespiti anlamını tamamen kaybederdi -- yani hiç yapmamış gibi
 * olurduk. Bu test o regresyonu bekliyor.
 */
test('taramaya özgü alanlar parmak izine girmez', () => {
  const oncekiIz = canonicalFingerprint(temel);

  // `FingerprintInput` bu alanları zaten kabul etmiyor; girdiye fazladan
  // alan eklemek parmak izini etkilemiyor.
  const fazlalikli = {
    ...temel,
    crawledAt: '2026-09-03T12:00:00Z',
    runId: 'run-987',
    randomToken: Math.random().toString(),
  } as FingerprintInput;

  assert.equal(canonicalFingerprint(fazlalikli), oncekiIz);
});

// --- Silme ----------------------------------------------------------------

test('tam anlık görüntüde eksik kayıt DELETED', () => {
  const r = classifyDelta({
    previous: new Map([
      ['SKU-1', canonicalFingerprint(temel)],
      ['SKU-YOK', 'eski-iz'],
    ]),
    current: [temel],
    snapshotComplete: true,
  });

  const silinen = r.entries.find((e) => e.externalId === 'SKU-YOK');
  assert.equal(silinen?.classification, 'DELETED');
  assert.equal(r.counts.DELETED, 1);
  assert.equal(r.deletionsEvaluated, true);
});

/*
 * KISMİ SENKRON SİLME ÜRETMEZ — EN PAHALI ARIZANIN ÖNLENMESİ.
 *
 * Feed yarım indiğinde (ağ koptu, sayfalama bitmedi, kaynak 503 verdi)
 * eksik kayıtlar "kaynakta yok" gibi görünür. Kısmi turda silme üretmek,
 * kataloğun yarısını bir ağ hatası yüzünden yok etmek demektir.
 */
test('KISMİ senkron DELETED ÜRETMEZ', () => {
  const r = classifyDelta({
    previous: new Map([
      ['SKU-1', canonicalFingerprint(temel)],
      ['SKU-YOK', 'eski-iz'],
    ]),
    current: [temel],
    snapshotComplete: false,
  });

  assert.equal(r.counts.DELETED, 0);
  assert.equal(r.deletionsEvaluated, false);
  assert.ok(!r.entries.some((e) => e.classification === 'DELETED'));
});

test('boş kısmi senkron hiçbir şeyi silmez', () => {
  const r = classifyDelta({
    previous: new Map([['SKU-1', 'iz'], ['SKU-2', 'iz2']]),
    current: [],
    snapshotComplete: false,
  });
  assert.equal(r.counts.DELETED, 0);
  assert.equal(r.entries.length, 0);
});

// --- Yazma filtresi -------------------------------------------------------

/*
 * Değişmeyen bir satırı yeniden yazmak `updated_at`i ilerletir ve "bu
 * ürün değişti" diyen sahte bir sinyal üretir. Aşağı akıştaki her şey
 * (yeniden indeksleme, önbellek, uyarlanabilir yoklama) o sinyale bakıyor.
 */
test('UNCHANGED kayıtlar yazılacaklar listesine girmez', () => {
  const r = classifyDelta({
    previous: new Map([
      ['SKU-1', canonicalFingerprint(temel)],
      ['SKU-2', 'eski'],
    ]),
    current: [temel, { ...temel, externalId: 'SKU-2', priceCents: 1 }, { ...temel, externalId: 'SKU-3' }],
    snapshotComplete: true,
  });

  const yazilacak = needsWrite(r).map((e) => e.externalId).sort();
  assert.deepEqual(yazilacak, ['SKU-2', 'SKU-3']);
  assert.equal(r.counts.UNCHANGED, 1);
});

test('sayaçlar toplam kayıt sayısıyla tutarlı', () => {
  const r = classifyDelta({
    previous: new Map([['A', 'x'], ['B', 'y']]),
    current: [
      { ...temel, externalId: 'A' },
      { ...temel, externalId: 'C' },
    ],
    snapshotComplete: true,
  });

  const toplam = r.counts.NEW + r.counts.CHANGED + r.counts.UNCHANGED + r.counts.DELETED;
  assert.equal(toplam, r.entries.length);
  assert.equal(r.counts.CHANGED, 1); // A
  assert.equal(r.counts.NEW, 1); // C
  assert.equal(r.counts.DELETED, 1); // B
});
