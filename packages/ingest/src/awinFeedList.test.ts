/**
 * AWIN FEED LİSTESİ AYRIŞTIRICISI
 *
 * Bu ayrıştırıcının düşmesi SESSİZ olur: yanlış kolondan okursa
 * `programs` tablosuna advertiser adı yerine feed adı yazılır ve kimse
 * fark etmez. Bu yüzden testler "ayrıştırdı mı"ya değil, YANLIŞ VERİ
 * YAZAR MI sorusuna bakıyor.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAwinFeedListesi, AWIN_FEED_LISTESI_ADRESI } from './awinFeedList.js';
import { IngestError } from './errors.js';

const BASLIK =
  'Advertiser ID,Advertiser Name,Primary Region,Membership Status,Feed ID,' +
  'Feed Name,Language,Vertical,Last Imported,Last Checked,No of products,URL';

test('beklenen başlıkla feed satırı doğru alanlara oturur', () => {
  const { kayitlar } = parseAwinFeedListesi(
    `${BASLIK}\n` +
      '12044,AliExpress PL,PL,joined,98765,Main Feed,pl,Gadgets,' +
      '2026-09-18,2026-09-19,"1,234,567",https://example.invalid/f\n',
  );

  assert.equal(kayitlar.length, 1);
  const k = kayitlar[0]!;
  assert.equal(k.advertiserId, '12044');
  assert.equal(k.advertiserName, 'AliExpress PL');
  assert.equal(k.feedId, '98765');
  assert.equal(k.feedName, 'Main Feed');
  assert.equal(k.region, 'PL');
  assert.equal(k.membershipStatus, 'joined');
  // Binlik ayraci cozulmeli: "1,234,567" tirnak icinde TEK alan.
  assert.equal(k.itemCount, 1234567);
});

test('KOLON SIRASI DEĞİŞİRSE alanlar karışmaz', () => {
  /*
   * Siraya dayanan bir ayristirici burada advertiser adina feed adini
   * yazardi -- ve bu, uretimde fark edilmesi en zor hatadir.
   */
  const { kayitlar } = parseAwinFeedListesi(
    'Feed Name,Feed ID,Advertiser Name,Advertiser ID,No of products,Membership Status\n' +
      'Main Feed,98765,AliExpress PL,12044,42,joined\n',
  );

  const k = kayitlar[0]!;
  assert.equal(k.advertiserName, 'AliExpress PL');
  assert.equal(k.feedName, 'Main Feed');
  assert.equal(k.advertiserId, '12044');
  assert.equal(k.feedId, '98765');
  assert.equal(k.itemCount, 42);
});

test('başlık yazımı farklı olsa da tanınır', () => {
  const { kayitlar } = parseAwinFeedListesi(
    'advertiser_id,advertiser_name,feed_id,NoOfProducts\n' + '12044,AliExpress PL,98765,7\n',
  );
  assert.equal(kayitlar[0]!.advertiserId, '12044');
  assert.equal(kayitlar[0]!.itemCount, 7);
});

test('ZORUNLU kolon yoksa GERÇEK BAŞLIĞI söyleyerek düşer', () => {
  /*
   * Sessizce bos liste donmek en kotu sonuc olurdu: "hesapta feed yok"
   * sanilir ve 38 program kullanilamaz kalmaya devam ederdi.
   */
  let hata: unknown;
  try {
    parseAwinFeedListesi('Advertiser Name,Something Else\nAliExpress PL,x\n');
  } catch (e) {
    hata = e;
  }

  assert.ok(hata instanceof IngestError, 'IngestError bekleniyordu');
  assert.match(hata.message, /advertiserId/);
  assert.match(hata.message, /feedId/);
  // Gercek baslik mesajda olmali -- duzeltmeyi tahminle degil dosyayla yapalim.
  assert.match(hata.message, /Something Else/);
});

test('harf önekli kimlik ATLANIR, satırı bozmaz', () => {
  /*
   * document.json'daki gercek hata: `F3951` ve `F3285`. Awin bunlari
   * reddetti. Ayni sekilde `merchants_advertiser_id_numeric` kisiti da
   * reddeder -- burada erken eliyoruz.
   */
  const { kayitlar, uyarilar } = parseAwinFeedListesi(
    `${BASLIK.split(',').slice(0, 5).join(',')}\n` +
      '12044,AliExpress PL,PL,joined,98765\n' +
      '3951,Bozuk Kayit,PL,joined,F3951\n',
  );

  assert.equal(kayitlar.length, 1);
  assert.equal(kayitlar[0]!.feedId, '98765');
  assert.ok(uyarilar.some((u) => u.includes('F3951')));
});

test('ürün sayısı çözülemezse null olur, SIFIR OLMAZ', () => {
  /*
   * Sifir "feed bos" demek; null "bilmiyoruz" demek. Ikisini esitlemek,
   * bos sanip atladigimiz bir feed'i bir daha hic denememek olurdu.
   */
  const { kayitlar } = parseAwinFeedListesi(
    'Advertiser ID,Advertiser Name,Feed ID,No of products\n' +
      '12044,AliExpress PL,98765,bilinmiyor\n',
  );
  assert.equal(kayitlar[0]!.itemCount, null);
});

test('üyelik durumu kolonu yoksa UYARI verir', () => {
  const { uyarilar } = parseAwinFeedListesi(
    'Advertiser ID,Advertiser Name,Feed ID\n12044,AliExpress PL,98765\n',
  );
  assert.ok(uyarilar.some((u) => u.toLowerCase().includes('uyelik')));
});

test('üyelik durumu KENDİ SÖZLÜĞÜMÜZE ÇEVRİLMEZ', () => {
  /*
   * Agin soyledigi metin birebir korunmali. 'pending'i 'APPROVED'a
   * cevirmek, onaylanmamis bir programi onayli gostermek olurdu.
   */
  const { kayitlar } = parseAwinFeedListesi(
    'Advertiser ID,Advertiser Name,Feed ID,Membership Status\n' +
      '12044,AliExpress PL,98765,pending\n',
  );
  assert.equal(kayitlar[0]!.membershipStatus, 'pending');
});

test('boş liste sessiz geçmez', () => {
  assert.throws(() => parseAwinFeedListesi(''), IngestError);
});

test('adres sabiti GERÇEK ANAHTAR TAŞIMAZ', () => {
  /*
   * Bu sabit depoya giriyor. Icinde gercek bir anahtar olsaydi, git
   * gecmisinden silmek mumkun olmazdi.
   */
  assert.match(AWIN_FEED_LISTESI_ADRESI, /\$\{AWIN_DATAFEED_API_KEY\}/);
  assert.doesNotMatch(AWIN_FEED_LISTESI_ADRESI, /apikey\/[0-9a-f]{16,}/i);
});
