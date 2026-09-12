/**
 * Kategori siniflandirmasi testleri.
 *
 * Basliklar UYDURULMADI: uretimdeki BTO katalogundan alindi
 * (`select title from products` ile okunan gercek kayitlar).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { kategoriSlugBul } from './categorize.js';

// ---------------------------------------------------------------------------
// ASIL HATA: feed tek deger gonderiyor
// ---------------------------------------------------------------------------
// Uretimde olculdu: 35.767 urunun TAMAMI `computers` tasiyor ve katalog
// slug'lari Turkce oldugu icin hicbiri eslesmiyordu -- items_unclassified
// 35767/35767. Bu test o durumu kilitler.

test('feed kategorisi "computers" -> bilgisayar', () => {
  assert.equal(kategoriSlugBul('computers', 'Generic Widget'), 'bilgisayar');
});

test('feed kategorisi buyuk/kucuk harften bagimsiz eslesir', () => {
  assert.equal(kategoriSlugBul('Computers', 'x'), 'bilgisayar');
  assert.equal(kategoriSlugBul('COMPUTERS', 'x'), 'bilgisayar');
  assert.equal(kategoriSlugBul('  computers  ', 'x'), 'bilgisayar');
});

// ---------------------------------------------------------------------------
// URUN ADI FEED KATEGORISINDEN ONCE GELIR
// ---------------------------------------------------------------------------
// Bu siralama testin asil konusu: bu feed'de her urun ayni `computers`
// degerini tasidigi icin baslik DISINDA ayirt edici sinyal yok.

test('baslik feed kategorisini EZER -- kulaklik bilgisayar cevre birimi sayilmaz', () => {
  // Gercek kayit bicimi: feed kategorisi computers, urun kulaklik.
  assert.equal(
    kategoriSlugBul('computers', 'Logitech Zone Wireless Headset'),
    'kulaklik',
  );
});

test('telefon aksesuari kablo/USB kuralina DUSMEZ', () => {
  // "Phone Case ... USB-C" hem telefon hem usb kalibi tasiyor.
  // Telefon kurali once geldigi icin dogru kategoriye gider.
  assert.equal(
    kategoriSlugBul('computers', 'tech21 Evo Clear Phone Case with USB-C Cable'),
    'telefon',
  );
});

test('USB kulaklik KULAKLIK olur -- sira dogrulugun kendisi', () => {
  // Bu test sart: bilgisayar kurali once yazilmis bir uygulama bunu
  // `bilgisayar` yapar ve hata sessizce yanlis kategori uretir.
  assert.equal(kategoriSlugBul('computers', 'Jabra Evolve USB Headset'), 'kulaklik');
});

test('gercek BTO basliklari dogru kategoriye gider', () => {
  const beklenen: Array<[string, string]> = [
    ['Logitech Wireless Combo MK270 Keyboard and Mouse', 'bilgisayar'],
    ['Brother Brother Drum Unit', 'bilgisayar'],
    ['Kingston Technology ValueRAM Memory Module 16 GB', 'bilgisayar'],
    ['Brother Continuous Paper Tape', 'bilgisayar'],
  ];

  for (const [baslik, slug] of beklenen) {
    assert.equal(kategoriSlugBul('computers', baslik), slug, baslik);
  }
});

// ---------------------------------------------------------------------------
// KELIME SINIRI -- sessiz yanlis kategori uretmenin en kolay yolu
// ---------------------------------------------------------------------------

test('kisa kurallar kelime ICINDE eslesmez', () => {
  // "ram" kurali "Panoramic" icinde eslesirse urun sessizce bilgisayar olur.
  // Bu test o hatayi kilitler; feed kategorisi bos verildi ki yalnizca
  // baslik kurali sinaniyor olsun.
  assert.equal(kategoriSlugBul(null, 'Panoramic Wall Art Print'), null);
  assert.equal(kategoriSlugBul(null, 'Mousepad Deluxe'), null);
});

test('kelime siniri ICINDE gecen gercek eslesmeyi engellemez', () => {
  assert.equal(kategoriSlugBul(null, 'Corsair RAM 32GB'), 'bilgisayar');
  assert.equal(kategoriSlugBul(null, 'Wireless Mouse'), 'bilgisayar');
});

// ---------------------------------------------------------------------------
// KATEGORI YOLU -- Awin saticilari hem etiket hem yol gonderiyor
// ---------------------------------------------------------------------------

test('kategori yolunda EN SPESIFIK parca kazanir', () => {
  // Son parca en dar kategoridir; "Computers > Audio" kulaklik olmali,
  // bilgisayar degil -- yoksa yol bilgisi bosa gider.
  assert.equal(
    kategoriSlugBul('Computers > Peripherals > Audio', 'Belirsiz Urun'),
    'kulaklik',
  );
});

test('yolun yalnizca genel parcasi taniniyorsa ona duser', () => {
  assert.equal(
    kategoriSlugBul('Electronics > Bilinmeyen Alt Dal', 'Belirsiz Urun'),
    'elektronik',
  );
});

// ---------------------------------------------------------------------------
// UYDURMA YOK
// ---------------------------------------------------------------------------

test('hicbir katman tutmazsa null doner -- kategori UYDURULMAZ', () => {
  // Bu test bilincli bir karari kilitler: her seyi `elektronik` yapan bir
  // genel varsayilan, kozmetik bir feed geldiginde butun katalogu yanlis
  // kategoriye doldururdu. null donmek `items_unclassified` sayilir ve
  // uyari hangi degerin eksik oldugunu soyler.
  assert.equal(kategoriSlugBul('bilinmeyen-dal', 'Belirsiz Urun'), null);
  assert.equal(kategoriSlugBul(null, null), null);
  assert.equal(kategoriSlugBul('', ''), null);
});

test('bos ve bosluklu girdiler cokmez', () => {
  assert.equal(kategoriSlugBul('   ', '   '), null);
  assert.equal(kategoriSlugBul(undefined, undefined), null);
});

// ---------------------------------------------------------------------------
// TURKCE 'I' TUZAGI
// ---------------------------------------------------------------------------

test('Turkce buyuk I ve noktasiz i eslesmeyi bozmaz', () => {
  // 'İ'.toLowerCase() 'i' + U+0307 (birlesen nokta) uretir -- tek karakter
  // DEGIL iki karakter. Naif bir lowercase bunu kacirir ve 'ELEKTRONİK'
  // degeri 'elektroni-k' olarak slug'lanip katalogdaki 'elektronik' ile
  // ESLESMEZ. `categorySlugKey` noktali/noktasiz I'yi acikca ele aliyor.
  assert.equal(kategoriSlugBul('ELEKTRONİK', 'x'), 'elektronik');
  assert.equal(kategoriSlugBul('IT', 'x'), 'bilgisayar');
});

test('katalog kategori ADI da slug\'a cevrilerek taninir', () => {
  // Feed kategori ADI gonderebilir: 'Ev & Yaşam' -> 'ev-yasam'.
  // Ilk hal kendi normallestirmesini yazmisti ve yalnizca kucuk harfe
  // ceviriyordu; bu deger taninmiyordu. Mevcut testler yakaladi.
  assert.equal(kategoriSlugBul('Ev & Yaşam', 'Airfryer'), 'ev-yasam');
  assert.equal(kategoriSlugBul('Spor & Outdoor', 'Belirsiz'), 'spor-outdoor');
});
