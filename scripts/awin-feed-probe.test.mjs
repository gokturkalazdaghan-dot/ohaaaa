/**
 * Feed yoklamasının testleri.
 *
 * NEDEN VAR
 * Bu betiğin çıktısı "kaynak açılsın mı" kararına giriyor ve ölçüm olarak
 * veritabanına `checked_at` damgasıyla yazılıyor. Yanlış bir sayı, ölçüm
 * olmamasından KÖTÜ: doğru sanılır ve bir daha sorgulanmaz.
 *
 * En kritik iki şey: (1) tırnak içindeki satır sonu ürün sayısını
 * şişirmemeli, (2) başlıksız bir dosyada ilk ürün başlık sanılmamalı.
 *
 * Çalıştırma:  node --test scripts/
 */

import { strict as assert } from 'node:assert';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';

import {
  alinabilirMi, feedAdresi, feediOlc, satirlariAyir, satirSayaci, satiriBol,
} from './awin-feed-probe.mjs';

/* ---------------------------------------------------------------- sayaç -- */

function say(...parcalar) {
  const s = satirSayaci();
  for (const p of parcalar) s.yut(p);
  return s.toplam;
}

test('düz satırlar sayılır', () => {
  assert.equal(say('a\nb\nc\n'), 3);
});

test('son satır satır sonuyla bitmese de sayılır', () => {
  // Dosyanın son ürününü kaybetmek küçük ama SİSTEMATİK bir hata olurdu.
  assert.equal(say('a\nb\nc'), 3);
});

test('CRLF tek satır sayılır', () => {
  assert.equal(say('a\r\nb\r\n'), 2);
});

test('tırnak içindeki satır sonu SAYILMAZ', () => {
  /*
   * Ürün açıklamalarında satır sonu var. `\n` saymak ürün sayısını
   * katlardı -- ve sonuç "ölçüldü" etiketiyle yazılırdı.
   */
  assert.equal(say('a,"iki\nsatır",b\nc,d,e\n'), 2);
});

test('sayaç parça sınırından etkilenmez', () => {
  // Akış 64 KB'lık parçalar hâlinde geliyor; tırnak parçanın ortasında açılıyor.
  assert.equal(say('a,"iki\n', 'satır",b\nc,d,e\n'), 2);
});

test('boş girdi sıfır satır', () => {
  assert.equal(say(''), 0);
  assert.equal(say('', ''), 0);
});

/* ----------------------------------------------------------- satır bölme -- */

test('tırnak içindeki virgül alanı bölmez', () => {
  assert.deepEqual(satiriBol('1,"Smith, Jones",3'), ['1', 'Smith, Jones', '3']);
});

test('ikiye katlanmış tırnak tek tırnağa iner', () => {
  assert.deepEqual(satiriBol('"He said ""hi""",x'), ['He said "hi"', 'x']);
});

test('boş alanlar korunur', () => {
  assert.deepEqual(satiriBol('a,,b'), ['a', '', 'b']);
});

/* --------------------------------------------------------- alınabilirlik -- */

const saglam = {
  product_name: 'Bluetooth kulaklık',
  merchant_deep_link: 'https://ornek.example/p/1',
  search_price: '19.99',
  currency: 'EUR',
};

test('sağlam satır alınabilir', () => {
  assert.equal(alinabilirMi(saglam), true);
});

test('fiyatı sıfır ya da eksi olan satır alınamaz', () => {
  assert.equal(alinabilirMi({ ...saglam, search_price: '0' }), false);
  assert.equal(alinabilirMi({ ...saglam, search_price: '0.00' }), false);
  assert.equal(alinabilirMi({ ...saglam, search_price: '' }), false);
});

test('virgüllü ondalık fiyat okunur', () => {
  // Polonya ve Almanya feed'lerinde ondalık ayracı virgül.
  assert.equal(alinabilirMi({ ...saglam, search_price: '19,99' }), true);
});

test('para birimi üç harf değilse alınamaz', () => {
  assert.equal(alinabilirMi({ ...saglam, currency: '' }), false);
  assert.equal(alinabilirMi({ ...saglam, currency: 'EURO' }), false);
});

test('adres yoksa alınamaz, aw_deep_link yeterlidir', () => {
  assert.equal(alinabilirMi({ ...saglam, merchant_deep_link: '' }), false);
  assert.equal(
    alinabilirMi({ ...saglam, merchant_deep_link: '', aw_deep_link: 'https://awin1.example/x' }),
    true,
  );
});

/* ------------------------------------------------------------------ adres -- */

test('varsayılan adreste anahtar YER TUTUCU olur', () => {
  const a = feedAdresi(3336);
  assert.ok(a.includes('/apikey/${AWIN_DATAFEED_API_KEY}/'));
  assert.ok(!/[0-9a-f]{24,}/.test(a), 'uzun onaltılık dizi kalmamalı');
  assert.ok(!/\/apikey\/(?!\$\{)/.test(a), 'veritabanı kısıtını geçmeli');
});

test('adres dili ve feed numarasını taşır', () => {
  const a = feedAdresi(115564, 'pl');
  assert.ok(a.includes('/language/pl/'));
  assert.ok(a.includes('/fid/115564/'));
  assert.ok(a.includes('compression/gzip'));
});

/* ------------------------------------------------------------- uçtan uca -- */

const BASLIK = 'data_feed_id,merchant_id,merchant_name,aw_deep_link,merchant_deep_link,' +
  'product_name,search_price,currency';

function sahteGetir(govde, { durum = 200 } = {}) {
  return async () => ({
    ok: durum >= 200 && durum < 300,
    status: durum,
    body: govde === null ? null : new Blob([gzipSync(Buffer.from(govde, 'utf8'))]).stream(),
  });
}

test('başlıklı feed uçtan uca ölçülür', async () => {
  const govde = [
    BASLIK,
    '3336,77001,Voghion,https://awin1.example/a,https://voghion.example/1,"Kulaklık, kablosuz",19.99,EUR',
    '3336,77001,Voghion,https://awin1.example/b,https://voghion.example/2,"İki\nsatırlı ad",5.00,EUR',
    '3336,77001,Voghion,https://awin1.example/c,https://voghion.example/3,Fiyatsız,0,EUR',
  ].join('\n') + '\n';

  const o = await feediOlc(3336, 'gizli', { getir: sahteGetir(govde) });

  assert.equal(o.durum, 200);
  assert.equal(o.urunSatiri, 3, 'tırnak içindeki satır sonu ürün sayısını şişirmemeli');
  assert.equal(o.ornek, 3);
  assert.equal(o.merchantName, 'Voghion');
  assert.deepEqual(o.saticilar, [['77001', 3]]);
  assert.deepEqual(o.paraBirimleri, [['EUR', 3]]);
  assert.equal(o.alinabilirTahmin, 2, 'fiyatı sıfır olan satır alınamaz sayılmalı');
});

test('BAŞLIKSIZ feed ilk ürünü başlık sanmaz', async () => {
  /*
   * Başlık varsayılırsa ilk ÜRÜN yutulur ve bütün alanlar kayar; ölçüm
   * sessizce yanlış çıkar. Adres verdiğimiz kolon sırasına düşülmeli.
   */
  const kolonlar = [
    '3336', '77001', 'Voghion', 'AWP1', 'https://awin1.example/a',
    'https://voghion.example/1', 'https://img.example/1.jpg', 'Kulaklık',
    'Açıklama', '19.99', '24.99', 'EUR', '1', 'in_stock', '', 'Voghion',
    '', 'Elektronik', 'SKU1', '0', '2026-09-01',
  ].join(',');

  const o = await feediOlc(3336, 'gizli', { getir: sahteGetir(`${kolonlar}\n`) });

  assert.equal(o.urunSatiri, 1, 'tek ürün var, başlık yok');
  assert.equal(o.ornek, 1);
  assert.equal(o.merchantName, 'Voghion');
  assert.equal(o.alinabilirTahmin, 1);
});

test('karışık para birimi tek değere indirgenmez', async () => {
  /*
   * Baskın olanı yazmak, azınlıktaki satırların fiyatını YANLIŞ para
   * biriminde göstermek demek. İki değer görülürse kaynağı açmadan önce
   * insan kararı gerekir.
   */
  const govde = [
    BASLIK,
    '3336,77001,Voghion,https://a.example/1,https://b.example/1,A,10,EUR',
    '3336,77001,Voghion,https://a.example/2,https://b.example/2,B,10,USD',
  ].join('\n') + '\n';

  const o = await feediOlc(3336, 'gizli', { getir: sahteGetir(govde) });
  assert.equal(o.paraBirimleri.length, 2);
});

test('birleşik feed birden fazla reklamveren gösterir', async () => {
  // `sources.merchant_id` TEK mağaza; birleşik feed kaynak olamaz.
  const govde = [
    BASLIK,
    '3336,77001,A Ltd,https://a.example/1,https://b.example/1,A,10,EUR',
    '3337,88002,B Ltd,https://a.example/2,https://b.example/2,B,10,EUR',
  ].join('\n') + '\n';

  const o = await feediOlc(3336, 'gizli', { getir: sahteGetir(govde) });
  assert.equal(o.saticilar.length, 2);
});

test('HTTP hatası anahtarı sızdırmadan bildirilir', async () => {
  const o = await feediOlc(3336, 'cok-gizli-anahtar', { getir: sahteGetir(null, { durum: 404 }) });
  assert.equal(o.durum, 404);
  assert.ok(o.hata.includes('404'));
  assert.ok(!JSON.stringify(o).includes('cok-gizli-anahtar'), 'anahtar çıktıya sızmamalı');
});

/* ------------------------------------------------------- satır ayırıcı -- */
/*
 * ÖLÇÜLEN HATA. İlk sürümde örneklem `indexOf('\n')` ile bölünüyordu.
 * Satır SAYACI tırnağı takip ediyordu, ayırıcı etmiyordu: aynı dosyada
 * ürün sayısı 3, örneklem 4 çıktı. Alınabilirlik oranı da o bozuk
 * örneklemden hesaplanıyordu -- yani yanlış bir sayı "ölçüldü" etiketiyle
 * veritabanına gidecekti.
 */

test('ayırıcı tırnak içindeki satır sonunda bölmez', () => {
  const { satirlar, kalan } = satirlariAyir('a,"iki\nsatır",b\nc,d,e\n');
  assert.deepEqual(satirlar, ['a,"iki\nsatır",b', 'c,d,e']);
  assert.equal(kalan, '');
});

test('ayırıcı yarım satırı geri verir', () => {
  const { satirlar, kalan } = satirlariAyir('tam\nyarim');
  assert.deepEqual(satirlar, ['tam']);
  assert.equal(kalan, 'yarim');
});

test('açık tırnak parçanın sonunda satır bitirmez', () => {
  /*
   * Akış 64 KB'lık parçalar hâlinde geliyor; tırnak parçanın ortasında
   * açılabiliyor. Çağıran `kalan`ı bir sonraki parçanın ÖNÜNE ekler --
   * durum taşımaz, çünkü `kalan` her zaman bir kaydın başından başlar.
   */
  const bir = satirlariAyir('a,"iki\n');
  assert.deepEqual(bir.satirlar, [], 'tırnak açıkken satır bitmez');
  assert.equal(bir.kalan, 'a,"iki\n');

  const iki = satirlariAyir(bir.kalan + 'satır",b\n');
  assert.deepEqual(iki.satirlar, ['a,"iki\nsatır",b']);
  assert.equal(iki.kalan, '');
});

test('ayırıcı CRLF sonunu kırpar', () => {
  const { satirlar } = satirlariAyir('a,b\r\nc,d\r\n');
  assert.deepEqual(satirlar, ['a,b', 'c,d']);
});

test('satır sonuyla bitmeyen son ürün örnekleme girer', async () => {
  const govde = [
    BASLIK,
    '3336,77001,Voghion,https://a.example/1,https://b.example/1,A,10,EUR',
    '3336,77001,Voghion,https://a.example/2,https://b.example/2,B,20,EUR',
  ].join('\n'); // bilerek sondaki satır sonu YOK

  const o = await feediOlc(3336, 'gizli', { getir: sahteGetir(govde) });
  assert.equal(o.urunSatiri, 2);
  assert.equal(o.ornek, 2, 'son satır örneklemde de görünmeli');
  assert.equal(o.alinabilirTahmin, 2);
});

test('çok baytlı harf parça sınırında bozulmaz', async () => {
  /*
   * `buffer.toString(\'utf8\')` yarım kalan bir harfi bozuk karakterle
   * değiştirir. Türkçe ve Lehçe ürün adları bundan etkilenirdi.
   */
  const govde = `${BASLIK}\n3336,77001,Şişli Ürünler,https://a.example/1,https://b.example/1,Ürün,10,EUR\n`;
  const sikistirilmis = gzipSync(Buffer.from(govde, 'utf8'));

  const getir = async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(kontrol) {
        // Tek baytlık parçalar: her çok baytlı harf kesin bölünür.
        for (const bayt of sikistirilmis) kontrol.enqueue(new Uint8Array([bayt]));
        kontrol.close();
      },
    }),
  });

  const o = await feediOlc(3336, 'gizli', { getir });
  assert.equal(o.merchantName, 'Şişli Ürünler');
  assert.equal(o.urunSatiri, 1);
});
