/**
 * Awin feed dizini çözümleyicisinin testleri.
 *
 * NEDEN VAR
 * Bu betik ÜRETİM verisine yazıyor ve girdisi bizim üretmediğimiz bir CSV.
 * Bir çözümleyici hatası gürültüyle değil SESSİZCE bozar: tırnak içindeki
 * virgül yanlış bölünürse kolonlar kayar ve feed ID'si ürün sayısı sanılır.
 * O satır tabloya yanlış yazılır, kimse fark etmez.
 *
 * Çalıştırma:  node --test scripts/
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { csvAyristir, kolonlariCoz, sayi, bolgeKodu, adresiTemizle } from './awin-feed-directory.mjs';

test('tırnak içindeki virgül kolonu bölmez', () => {
  // Gerçek reklamveren adlarında virgül var: "Smith, Jones & Co."
  const satirlar = csvAyristir('a,b\n1,"Smith, Jones & Co."');
  assert.deepEqual(satirlar[1], ['1', 'Smith, Jones & Co.']);
});

test('ikiye katlanmış tırnak tek tırnağa iner', () => {
  const satirlar = csvAyristir('a\n"He said ""hi"""');
  assert.deepEqual(satirlar[1], ['He said "hi"']);
});

test('CRLF ve boş satırlar satır sayısını şişirmez', () => {
  const satirlar = csvAyristir('a,b\r\n1,2\r\n\r\n3,4\r\n');
  assert.equal(satirlar.length, 3);
  assert.deepEqual(satirlar[2], ['3', '4']);
});

test('kolon adları büyük/küçük harf ve boşluktan bağımsız çözülür', () => {
  const k = kolonlariCoz([
    'Feed ID', 'Advertiser ID', 'Advertiser  Name', 'Feed Name',
    'Region', 'Language', 'No of products', 'Membership status',
  ]);
  assert.equal(k.feedId, 0);
  assert.equal(k.advertiserId, 1);
  assert.equal(k.advertiserName, 2);
  assert.equal(k.itemCount, 6);
  assert.equal(k.membership, 7);
});

test('bilinmeyen kolon -1 döner, çökmez', () => {
  const k = kolonlariCoz(['Feed ID', 'Advertiser ID']);
  assert.equal(k.feedId, 0);
  assert.equal(k.region, -1, 'olmayan kolon -1 kalmalı');
});

test('bölge yalnızca tam iki harfse kabul edilir', () => {
  // "Worldwide" kırpılsa "WO" olurdu -- var olmayan bir ülke kodu.
  assert.equal(bolgeKodu('GB'), 'GB');
  assert.equal(bolgeKodu('gb'), 'GB');
  assert.equal(bolgeKodu('Worldwide'), null);
  assert.equal(bolgeKodu(''), null);
  assert.equal(bolgeKodu(undefined), null);
});

test('ürün sayısı binlik ayracıyla da okunur, sıfır null olur', () => {
  assert.equal(sayi('116,415'), 116415);
  assert.equal(sayi('6470'), 6470);
  assert.equal(sayi('0'), null, 'sıfır "bilinmiyor" ile karıştırılmasın');
  assert.equal(sayi(''), null);
});

test('gerçek biçimli bir liste satırı uçtan uca doğru okunur', () => {
  const metin = [
    'Feed ID,Advertiser ID,Advertiser Name,Feed Name,Region,Language,No of products,Membership status',
    '111663,61655,"Back to the Office","In Stock Feed",GB,en,"116,415",joined',
    '58891,22069,"Smith, Jones & Co.",Default,GB,en,6470,joined',
    '99999,88888,"He said ""hi""",Default,Worldwide,en,12,pending',
  ].join('\n');

  const satirlar = csvAyristir(metin);
  const k = kolonlariCoz(satirlar[0]);
  const oku = (s) => ({
    fid: s[k.feedId],
    adv: s[k.advertiserId],
    ad: s[k.advertiserName],
    bolge: bolgeKodu(s[k.region]),
    adet: sayi(s[k.itemCount]),
  });

  assert.deepEqual(oku(satirlar[1]), {
    fid: '111663', adv: '61655', ad: 'Back to the Office', bolge: 'GB', adet: 116415,
  });
  assert.deepEqual(oku(satirlar[2]), {
    fid: '58891', adv: '22069', ad: 'Smith, Jones & Co.', bolge: 'GB', adet: 6470,
  });
  assert.deepEqual(oku(satirlar[3]), {
    fid: '99999', adv: '88888', ad: 'He said "hi"', bolge: null, adet: 12,
  });
});

/*
 * =============================================================================
 * ADRESTEN ANAHTAR SÖKME
 * =============================================================================
 * Liste çıktısının `URL` kolonu indirmeye hazır adresi verir ve İÇİNDE
 * anahtar vardır. Veritabanı bunu iki kısıtla reddediyor
 * (`program_feeds_url_no_secret`, `..._url_placeholder`) ama hatayı en geç
 * yerde görmek yerine burada engelliyoruz.
 *
 * En önemli test SONUNCUSU: sökemediğimiz bir adres SAKLANMAZ. Yarım
 * temizlenmiş bir adresi "herhalde tamamdır" diye yazmak, sırrı sessizce
 * sızdırmaktır.
 */

test('apikey yer tutucuyla değiştirilir', () => {
  const t = adresiTemizle(
    'https://productdata.awin.com/datafeed/download/apikey/abc123def456abc123def456/language/en/fid/111663/format/csv/',
  );
  assert.equal(
    t,
    'https://productdata.awin.com/datafeed/download/apikey/${AWIN_DATAFEED_API_KEY}/language/en/fid/111663/format/csv/',
  );
  assert.ok(!/[0-9a-f]{24,}/.test(t), 'sonuçta uzun onaltılık dizi kalmamalı');
  assert.ok(!/\/apikey\/(?!\$\{)/.test(t), 'apikey yer tutucu olmalı');
});

test('https olmayan adres saklanmaz', () => {
  assert.equal(adresiTemizle('http://productdata.awin.com/x'), null);
  assert.equal(adresiTemizle('ftp://x'), null);
  assert.equal(adresiTemizle(''), null);
  assert.equal(adresiTemizle(undefined), null);
});

test('anahtar sökülemezse adres HİÇ saklanmaz', () => {
  // `apikey` segmenti yok ama uzun onaltılik bir dizi var: sirri tasiyor
  // olabilir, o yuzden reddedilir.
  assert.equal(
    adresiTemizle('https://ornek.example/feed/0123456789abcdef0123456789abcdef'),
    null,
    'uzun onaltılık dizi taşıyan adres reddedilmeli',
  );
});

test('gerçek liste başlığı (üretimden ölçüldü) doğru çözülür', () => {
  /*
   * Bu başlık Awin'in canlı liste uç noktasından geldi -- tahmin değil,
   * ilk koşunun günlüğünden alındı.
   */
  const baslik = [
    'Advertiser ID', 'Advertiser Name', 'Primary Region', 'Membership Status',
    'Feed ID', 'Feed Name', 'Language', 'Vertical', 'Last Imported',
    'Last Checked', 'No of products', 'URL',
  ];
  const k = kolonlariCoz(baslik);
  assert.equal(k.advertiserId, 0);
  assert.equal(k.advertiserName, 1);
  assert.equal(k.region, 2);
  assert.equal(k.membership, 3);
  assert.equal(k.feedId, 4);
  assert.equal(k.feedName, 5);
  assert.equal(k.language, 6);
  assert.equal(k.imported, 8);
  assert.equal(k.itemCount, 10);
  assert.equal(k.url, 11);
});
