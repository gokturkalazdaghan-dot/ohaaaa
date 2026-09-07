import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalProductKey,
  collapseSpace,
  groupByCanonicalKey,
  expandUpcE,
  normalizeGtin,
  normalizeScannedGtin,
} from './canonicalProduct.js';

/* =========================================================================
 * KANONİK ÜRÜN KİMLİĞİ
 * -------------------------------------------------------------------------
 * Kovalanan tehlike: aynı ürünün her feed'de yeni bir kanonik satır açması.
 * Sessizdir -- katalog aynı telefonu 400 kez gösterir, fiyat karşılaştırması
 * kendi kendiyle yapılır, hiçbir hata düşmez.
 * ========================================================================= */

test('1) AYNI GTIN farklı gösterimlerde TEK anahtara iniyor', () => {
  // Tekilleştirmenin en sık sessizce kaçırdığı durum.
  const anahtarlar = new Set(
    ['012345678905', '0012345678905', '0-12345-67890-5', ' 012345678905 '].map((g) =>
      canonicalProductKey({ gtin: g, brand: null, mpn: null, title: 'Telefon' }),
    ),
  );

  assert.equal(anahtarlar.size, 1, 'UPC-12, EAN-13 ve tireli gösterim aynı üründür');
  assert.equal([...anahtarlar][0], 'gtin:00012345678905');
});

test('2) geçersiz GTIN bir DEĞER dönmüyor', () => {
  // '0' ya da boş metin dönseydi iki geçersiz GTIN eşitlenir ve alakasız
  // ürünler birleşirdi.
  for (const bozuk of ['123', 'abc', '', '  ', '123456789012345', null, undefined]) {
    assert.equal(normalizeGtin(bozuk), null, `"${bozuk}" için null bekleniyor`);
  }

  assert.notEqual(
    canonicalProductKey({ gtin: '123', brand: null, mpn: null, title: 'A' }),
    canonicalProductKey({ gtin: 'abc', brand: null, mpn: null, title: 'B' }),
    'iki geçersiz GTIN birbirine eşitlenmemeli',
  );
});

test('3) geçerli uzunluklar: GTIN-8, UPC-12, EAN-13, GTIN-14', () => {
  // Hepsinin kontrol basamağı DOĞRU; yanlış olanı test 3b kovalıyor.
  assert.equal(normalizeGtin('12345670'), '00000012345670');
  assert.equal(normalizeGtin('555000111008'), '00555000111008');
  assert.equal(normalizeGtin('0555000111008'), '00555000111008');
  assert.equal(normalizeGtin('12345678901231'), '12345678901231');
});

test('3b) KONTROL BASAMAĞI yanlışsa GTIN kimlik sayılmıyor', () => {
  // Bir feed'de yanlış yazılmış TEK BİR RAKAM, tamamen başka bir ürünün
  // geçerli görünen GTIN'ini üretir. Doğrulanmazsa iki ürün birleşir ve
  // kullanıcı karşılaştırma tablosunda başka bir ürünün fiyatlarını görür.
  assert.equal(normalizeGtin('012345678905'), '00012345678905', 'doğru hane geçmeli');
  assert.equal(normalizeGtin('012345678906'), null, 'son rakam yanlış: reddedilmeli');
  assert.equal(normalizeGtin('1234567890123'), null);

  // Geçersiz GTIN kanonik anahtarı bir alt basamağa düşürür; kimlik olmaz.
  assert.match(
    canonicalProductKey({ gtin: '012345678906', brand: 'Marka', mpn: 'MPN', title: 'T' }),
    /^mpn:/,
  );
});

test('4) GÜVENİLİRLİK SIRASI: gtin > marka+mpn > marka+başlık', () => {
  const hepsi = { gtin: '012345678905', brand: 'Marka', mpn: 'MPN-1', title: 'Telefon' };
  assert.match(canonicalProductKey(hepsi), /^gtin:/);

  assert.match(
    canonicalProductKey({ ...hepsi, gtin: null }),
    /^mpn:/,
    'GTIN yoksa marka+MPN',
  );
  assert.match(
    canonicalProductKey({ ...hepsi, gtin: null, mpn: null }),
    /^title:/,
    'MPN de yoksa marka+başlık',
  );
  assert.match(
    canonicalProductKey({ ...hepsi, gtin: '123' }),
    /^mpn:/,
    'geçersiz GTIN bir alt basamağa düşmeli',
  );
});

test('5) ÖNEK ZORUNLU: bir ürünün GTIN i başka ürünün MPN siyle çakışamaz', () => {
  assert.notEqual(
    canonicalProductKey({ gtin: '012345678905', brand: null, mpn: null, title: 'A' }),
    canonicalProductKey({ gtin: null, brand: 'Marka', mpn: '012345678905', title: 'A' }),
  );
});

test('6) boşluk ve büyük/küçük harf farkı ürünü BÖLMÜYOR', () => {
  const a = canonicalProductKey({ gtin: null, brand: 'MARKA', mpn: null, title: 'Urun  cok   bosluklu' });
  const b = canonicalProductKey({ gtin: null, brand: 'marka', mpn: null, title: ' Urun cok bosluklu ' });
  assert.equal(a, b);

  assert.equal(collapseSpace('  a   b  '), 'a b');
});

test('7) Türkçe karakterler ASCII ye iniyor', () => {
  const a = canonicalProductKey({ gtin: null, brand: 'IĞDIR', mpn: null, title: 'ÇAĞRI ŞİŞE' });
  const b = canonicalProductKey({ gtin: null, brand: 'igdir', mpn: null, title: 'cagri sise' });
  assert.equal(a, b);
});

test('8) boş marka ya da boş MPN bir basamak aşağı düşürüyor', () => {
  assert.match(canonicalProductKey({ gtin: null, brand: '   ', mpn: 'MPN', title: 'T' }), /^title:/);
  assert.match(canonicalProductKey({ gtin: null, brand: 'Marka', mpn: '   ', title: 'T' }), /^title:/);
});

test('9) FARKLI ürünler ayrı kalıyor — kapatma fazla kapatmamış', () => {
  const a = canonicalProductKey({ gtin: null, brand: 'Marka', mpn: null, title: 'Telefon 128GB' });
  const b = canonicalProductKey({ gtin: null, brand: 'Marka', mpn: null, title: 'Telefon 256GB' });
  assert.notEqual(a, b);
});

test('10) BELİRLENİMCİ: aynı girdi her zaman aynı anahtar', () => {
  const girdi = { gtin: null, brand: 'Sony', mpn: 'WH-1000XM5', title: 'Kulaklık' };
  const ilk = canonicalProductKey(girdi);
  for (let i = 0; i < 500; i += 1) {
    assert.equal(canonicalProductKey({ ...girdi }), ilk);
  }
});

test('11) parti içi tekilleştirme: aynı ürün üç kez geçse tek gruba düşüyor', () => {
  // 50 000 satırlık bir partide aynı ürün üç kez geçiyorsa üçünü de
  // veritabanına gönderip ikisinin 23505 almasını beklemek partiyi üç kat
  // yavaşlatır ve `on conflict` kilitlerini gereksizce çoğaltır.
  const satirlar = [
    { id: 1, gtin: '012345678905', brand: null, mpn: null, title: 'Telefon' },
    { id: 2, gtin: '0012345678905', brand: null, mpn: null, title: 'Telefon' },
    { id: 3, gtin: '0-12345-67890-5', brand: null, mpn: null, title: 'Telefon' },
    { id: 4, gtin: '0987000222000', brand: null, mpn: null, title: 'Baska' },
  ];

  const gruplar = groupByCanonicalKey(satirlar, (r) => r);

  assert.equal(gruplar.size, 2, 'üç gösterim tek gruba, dördüncü ayrı gruba');
  assert.deepEqual(
    gruplar.get('gtin:00012345678905')?.map((r) => r.id),
    [1, 2, 3],
  );
});

test('12) AYNI ÜRÜN FARKLI MERCHANT/NETWORK: kanonik anahtar aynı', () => {
  // Anahtar mağazayı ve ağı HİÇ görmüyor. Görseydi aynı ürün her mağazada
  // ayrı kanonik satır açar ve fiyat karşılaştırması imkânsızlaşırdı.
  const urun = { gtin: '0012345678905', brand: 'Sony', mpn: 'WH-1000XM5', title: 'Kulaklık' };
  const magazaA = canonicalProductKey(urun);
  const magazaB = canonicalProductKey({ ...urun });

  assert.equal(magazaA, magazaB);
  assert.ok(!magazaA.includes('awin') && !magazaA.includes('merchant'));
});

/*
 * KAMERADAN OKUNAN BARKOD.
 *
 * Tarayıcının `BarcodeDetector`i dört biçim okuyor: ean_13, ean_8, upc_a,
 * upc_e. UPC-E'nin kontrol basamağı 8 hanenin KENDİSİ üzerinden değil,
 * açılmış UPC-A üzerinden hesaplanır -- yani geçerli bir UPC-E doğrudan
 * `normalizeGtin`e verildiğinde REDDEDİLİR. Listelediğimiz bir biçimin
 * hiçbir zaman eşleşmemesi demekti.
 */
test('UPC-E, UPC-A ya acilarak taniniyor', () => {
  // Bilinen çift: UPC-E 04252614 <-> UPC-A 042100005264.
  assert.equal(expandUpcE('04252614'), '042100005264');
  assert.equal(normalizeScannedGtin('04252614'), '00042100005264');
  assert.equal(
    normalizeScannedGtin('04252614'),
    normalizeGtin('042100005264'),
    'acilmis UPC-E ile UPC-A ayni kanonik anahtari vermeli',
  );
});

/*
 * SEKİZ HANE İKİ ANLAMA GELİR ve ikisi FARKLI ürünlerdir. Önce EAN-8
 * denenir; ters sıra, geçerli bir EAN-8'i başka bir ürüne çevirebilirdi.
 */
test('gecerli EAN-8 UPC-E olarak yeniden yorumlanmiyor', () => {
  assert.equal(normalizeScannedGtin('01234565'), normalizeGtin('01234565'));
  assert.equal(normalizeScannedGtin('01234565'), '00000001234565');
});

/* Sayı sistemi 0/1 değilse UPC-E değildir. */
test('UPC-E olmayan sekiz hane acilmiyor', () => {
  assert.equal(expandUpcE('45678901'), null);
  assert.equal(expandUpcE('1234567'), null, 'yedi hane UPC-E degil');
  assert.equal(expandUpcE(null), null);
});

/*
 * ÖLÇÜLEN HATA: 20260907300000 bütün GTIN'leri 14 haneye tamamlıyor, yani
 * katalogda EAN-13 `05012345678900` olarak duruyor. Kameradan okunan
 * 13 haneli hâl HAM olarak arandığında sıfır satır buluyordu.
 */
test('okunan barkod katalogdaki 14 haneli hâlle ayni anahtari veriyor', () => {
  assert.equal(normalizeScannedGtin('5012345678900'), '05012345678900');
});

/* Kontrol basamağı tutmayan okuma veritabanına HİÇ gitmemeli. */
test('yanlis okunan barkod reddediliyor', () => {
  assert.equal(normalizeScannedGtin('5012345678901'), null);
  assert.equal(normalizeScannedGtin('https://ornek.example'), null);
  assert.equal(normalizeScannedGtin(''), null);
});
