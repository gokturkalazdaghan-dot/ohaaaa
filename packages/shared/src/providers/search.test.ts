import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  BORROWED_FRESH_SECONDS,
  BORROWED_MAX_PAGE,
  BORROWED_STALE_CEILING_SECONDS,
  ProductSearchError,
  borrowedFreshness,
  buildBorrowedCacheKey,
  normalizeSearchQuery,
} from './index.js';

/** Anahtar üretiminde sorgu dışındaki her şeyi sabitleyen taban. */
const TABAN = {
  partner: 'amazon',
  market: 'DE',
  currency: 'EUR',
  locale: 'de',
} as const;

// ---------------------------------------------------------------------------
// normalizeSearchQuery
// ---------------------------------------------------------------------------

test('normalizeSearchQuery: belirtecleri siralar, yani kelime sirasi anahtari degistirmez', () => {
  assert.equal(normalizeSearchQuery('Sony kulaklik'), normalizeSearchQuery('kulaklik Sony'));
});

test('normalizeSearchQuery: NFKD ile ayrisan aksanlari duserir', () => {
  assert.equal(normalizeSearchQuery('Café'), 'cafe');
  assert.equal(normalizeSearchQuery('Über'), 'uber');
  assert.equal(normalizeSearchQuery('Ñandú'), 'nandu');
});

test('normalizeSearchQuery: NFKD ile AYRISMAYAN harfleri de katlar', () => {
  /*
   * Bu satirlarin her biri bir cache iskasini onluyor. Katlama olmasaydi
   * bu harfler bir sonraki adimda tamamen duserdi: "kulaklık" -> "kulaklk",
   * yani "kulaklik" yazan kullanici BASKA bir anahtara duserdi.
   */
  assert.equal(normalizeSearchQuery('kulaklık'), 'kulaklik');
  assert.equal(normalizeSearchQuery('Straße'), 'strasse');
  assert.equal(normalizeSearchQuery('Ø'), 'o');
});

test('normalizeSearchQuery: Turkce noktali I dogru katlanir', () => {
  assert.equal(normalizeSearchQuery('İPHONE'), 'iphone');
  assert.equal(normalizeSearchQuery('iPhone'), 'iphone');
});

test('normalizeSearchQuery: model kodlarindaki - ve + korunur', () => {
  // "WH-1000XM5" ile "WH 1000XM5" ayni urun DEGIL sayilmali mi sorusu
  // degil bu: tire korunuyor cunku model kodunun parcasi.
  assert.equal(normalizeSearchQuery('Sony WH-1000XM5'), 'sony wh-1000xm5');
  assert.equal(normalizeSearchQuery('USB-C 100W'), '100w usb-c');
});

test('normalizeSearchQuery: noktalama ayirici olur, yapistirmaz', () => {
  assert.equal(normalizeSearchQuery('apple,iphone'), 'apple iphone');
  assert.equal(normalizeSearchQuery('  bosluk   fazlasi  '), 'bosluk fazlasi');
});

test('normalizeSearchQuery: anlamli karakter yoksa bos doner', () => {
  assert.equal(normalizeSearchQuery('!!!'), '');
  assert.equal(normalizeSearchQuery('   '), '');
});

// ---------------------------------------------------------------------------
// buildBorrowedCacheKey
// ---------------------------------------------------------------------------

test('buildBorrowedCacheKey: belgelenen bicimi uretir', () => {
  const anahtar = buildBorrowedCacheKey({ ...TABAN, query: 'sony kulaklik' });
  const parcalar = anahtar.split(':');

  assert.equal(parcalar.length, 8);
  assert.equal(parcalar[0], 'ob');
  assert.equal(parcalar[1], 'v1');
  assert.equal(parcalar[2], 'amazon');
  assert.equal(parcalar[3], 'DE');
  assert.equal(parcalar[4], 'EUR');
  assert.equal(parcalar[5], 'de');
  assert.equal(parcalar[6], '1');
  assert.match(parcalar[7] ?? '', /^[0-9a-f]{16}$/);
});

test('buildBorrowedCacheKey: deterministik', () => {
  const girdi = { ...TABAN, query: 'Sony WH-1000XM5' };
  assert.equal(buildBorrowedCacheKey(girdi), buildBorrowedCacheKey(girdi));
});

test('buildBorrowedCacheKey: kelime sirasi anahtari degistirmez', () => {
  assert.equal(
    buildBorrowedCacheKey({ ...TABAN, query: 'sony kulaklik' }),
    buildBorrowedCacheKey({ ...TABAN, query: 'Kulaklık   SONY' }),
  );
});

test('buildBorrowedCacheKey: bilesenlerin HER BIRI anahtari ayirir', () => {
  const temel = buildBorrowedCacheKey({ ...TABAN, query: 'kulaklik' });

  const farklilar = [
    buildBorrowedCacheKey({ ...TABAN, partner: 'ebay', query: 'kulaklik' }),
    buildBorrowedCacheKey({ ...TABAN, market: 'TR', query: 'kulaklik' }),
    buildBorrowedCacheKey({ ...TABAN, currency: 'TRY', query: 'kulaklik' }),
    buildBorrowedCacheKey({ ...TABAN, locale: 'en', query: 'kulaklik' }),
    buildBorrowedCacheKey({ ...TABAN, query: 'kulaklik', page: 2 }),
    buildBorrowedCacheKey({ ...TABAN, query: 'mikrofon' }),
  ];

  for (const farkli of farklilar) {
    assert.notEqual(farkli, temel);
  }

  // Hepsi birbirinden de farkli olmali -- iki bilesen ayni anahtara
  // cokerse biri anahtara hic girmiyor demektir.
  assert.equal(new Set([temel, ...farklilar]).size, farklilar.length + 1);
});

test('buildBorrowedCacheKey: buyuk/kucuk harf yazimi anahtari bolmez', () => {
  assert.equal(
    buildBorrowedCacheKey({ ...TABAN, query: 'kulaklik' }),
    buildBorrowedCacheKey({
      partner: 'AMAZON',
      market: 'de',
      currency: 'eur',
      locale: 'DE',
      query: 'kulaklik',
    }),
  );
});

test('buildBorrowedCacheKey: bos sorgu anahtar uretmez', () => {
  for (const bos of ['', '   ', '!!!']) {
    assert.throws(
      () => buildBorrowedCacheKey({ ...TABAN, query: bos }),
      (hata: unknown) =>
        hata instanceof ProductSearchError && hata.code === 'invalid_query',
      `"${bos}" anahtar uretmemeliydi`,
    );
  }
});

test('buildBorrowedCacheKey: sayfa sinirini KIRPMAZ, hata firlatir', () => {
  // Kirpsaydik 5. sayfayi isteyen 3. sayfayi alir ve bunu fark etmezdi.
  for (const sayfa of [0, -1, BORROWED_MAX_PAGE + 1, 1.5]) {
    assert.throws(
      () => buildBorrowedCacheKey({ ...TABAN, query: 'kulaklik', page: sayfa }),
      (hata: unknown) =>
        hata instanceof ProductSearchError && hata.code === 'invalid_query',
      `sayfa ${sayfa} kabul edilmemeliydi`,
    );
  }

  assert.doesNotThrow(() =>
    buildBorrowedCacheKey({ ...TABAN, query: 'kulaklik', page: BORROWED_MAX_PAGE }),
  );
});

// ---------------------------------------------------------------------------
// borrowedFreshness
// ---------------------------------------------------------------------------

const SIMDI = new Date('2026-09-20T12:00:00.000Z');

function gozlem(saniyeOnce: number): Date {
  return new Date(SIMDI.getTime() - saniyeOnce * 1000);
}

test('borrowedFreshness: taze pencere', () => {
  assert.equal(borrowedFreshness(gozlem(0), SIMDI), 'taze');
  assert.equal(borrowedFreshness(gozlem(BORROWED_FRESH_SECONDS), SIMDI), 'taze');
});

test('borrowedFreshness: bayat pencere', () => {
  assert.equal(borrowedFreshness(gozlem(BORROWED_FRESH_SECONDS + 1), SIMDI), 'bayat');
  assert.equal(borrowedFreshness(gozlem(BORROWED_STALE_CEILING_SECONDS), SIMDI), 'bayat');
});

test('borrowedFreshness: tavanin otesi sunulmaz', () => {
  assert.equal(
    borrowedFreshness(gozlem(BORROWED_STALE_CEILING_SECONDS + 1), SIMDI),
    'suresi_doldu',
  );
});

test('borrowedFreshness: gelecek tarihli gozlem TAZE sayilmaz', () => {
  /*
   * Saat kaymasi ya da bozuk bir partner zaman damgasi negatif sure
   * uretir. "Cok taze" saymak, suresi HIC dolmayan bir girdi yaratirdi.
   */
  assert.equal(borrowedFreshness(gozlem(-3600), SIMDI), 'bayat');
});

test('borrowedFreshness: ISO-8601 metni de kabul eder', () => {
  assert.equal(borrowedFreshness(SIMDI.toISOString(), SIMDI), 'taze');
});

test('borrowedFreshness: gecersiz zaman sessizce taze sayilmaz', () => {
  assert.throws(
    () => borrowedFreshness('bu bir tarih degil', SIMDI),
    (hata: unknown) => hata instanceof ProductSearchError && hata.code === 'invalid_query',
  );
});
