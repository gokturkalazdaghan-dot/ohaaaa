import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  AWIN_FEED_COLUMNS,
  AWIN_FEED_MAPPING,
  AwinFeedError,
  buildAwinFeedUrl,
  isAwinFeedId,
  redactAwinKey,
} from './awinFeed.js';

const ANAHTAR = 'test-anahtari-DEPODA-GERCEK-ANAHTAR-YOK';

/*
 * ADRES ANAHTARI TASIR. Bu yuzden adres ne veritabanina ne log'a yazilir;
 * yalnizca `fetch`e verilir. Asagidaki testler o sozun tutuldugunu sinar.
 */
test('feed adresi kimlikten ve anahtardan turetiliyor', () => {
  const url = buildAwinFeedUrl({
    feedIds: ['111515'],
    apiKey: ANAHTAR,
    columns: ['product_name', 'search_price'],
  });
  assert.ok(url.startsWith('https://productdata.awin.com/datafeed/download/'));
  assert.ok(url.includes('/fid/111515/'));
  assert.ok(url.includes('/compression/gzip/'), 'gzip istenmeli: hat gzip acar, zip reddeder');
});

/* Birden fazla feed tek istekte alinabilir: 100 binlik feed'lerde her biri
 * icin ayri tur atmak, ag turunu ve hiz sinirini gereksiz yere buyutur. */
test('birden fazla feed kimligi virgulle birlesiyor', () => {
  const url = buildAwinFeedUrl({ feedIds: ['111515', '102827'], apiKey: ANAHTAR, columns: ['x'] });
  assert.ok(url.includes('/fid/111515%2C102827/'));
});

/*
 * REDAKSIYON. Tek bir `console.error(err)` anahtari log'a basardi ve log'lar
 * veritabanindan daha cok yere kopyalanir.
 */
test('redaksiyon anahtari adresten siliyor', () => {
  const url = buildAwinFeedUrl({ feedIds: ['111515'], apiKey: ANAHTAR, columns: ['x'] });
  const temiz = redactAwinKey(`fetch failed: ${url}`);
  assert.ok(!temiz.includes(ANAHTAR), 'anahtar redaksiyondan sonra kalmamali');
  assert.ok(temiz.includes('/apikey/[REDACTED]'));
});

/* Hata sinifinin KENDISI de redaksiyondan geciyor: ileride adres tasiyan bir
 * mesajla cagrilabilir ve o an kimse redaksiyonu hatirlamayabilir. */
test('AwinFeedError mesaji da redakte ediliyor', () => {
  const hata = new AwinFeedError('fail /apikey/GIZLI/fid/1/', 'invalid_feed_id');
  assert.ok(!hata.message.includes('GIZLI'));
});

/* FAIL-CLOSED: anahtar yoksa bos dizeyle devam edip 401 yemek yerine durur --
 * 401'in govdesi log'a duser ve orada adres olur. */
test('anahtarsiz adres uretilmiyor', () => {
  assert.throws(
    () => buildAwinFeedUrl({ feedIds: ['111515'], apiKey: '', columns: ['x'] }),
    (e: unknown) => e instanceof AwinFeedError && e.code === 'missing_api_key',
  );
});

/* Feed kimligi yalnizca rakam: adrese serbest metin koymak yol enjeksiyonuna
 * acik kapi birakirdi ("../../"). */
test('bozuk feed kimligi reddediliyor', () => {
  for (const bozuk of ['../../etc', '111515;rm', '', 'abc']) {
    assert.throws(
      () => buildAwinFeedUrl({ feedIds: [bozuk], apiKey: ANAHTAR, columns: ['x'] }),
      (e: unknown) => e instanceof AwinFeedError && e.code === 'invalid_feed_id',
      `reddedilmeliydi: ${bozuk}`,
    );
  }
  assert.equal(isAwinFeedId('111515'), true);
});

/*
 * ESLEME GERCEK BIR FEED'E KARSI DOGRULANDI (Alison US CA, MID 120101,
 * feed 111515, 5.594 satir). Sutun adlari Awin feed'inde SABITTIR.
 */
test('eslemenin istedigi her sutun indirmede isteniyor', () => {
  for (const sutun of Object.values(AWIN_FEED_MAPPING)) {
    assert.ok(AWIN_FEED_COLUMNS.includes(sutun), `indirilmeyen sutun eslenmis: ${sutun}`);
  }
  // Kimlik ve denetim sutunlari: hangi feed'den geldigini ve tazeligini
  // dogrulayabilmek icin.
  for (const sutun of ['merchant_id', 'data_feed_id', 'last_updated']) {
    assert.ok(AWIN_FEED_COLUMNS.includes(sutun));
  }
});

/* `display_price` biçimlenmiş metindir ("USD0.00") ve para birimi ile tutari
 * tek hucrede tasir; ondan fiyat ayiklamak bicim degistigi gun sessizce
 * yanlis sayi uretirdi. */
test('bicimlenmis fiyat sutunu fiyat olarak kullanilmiyor', () => {
  assert.equal(AWIN_FEED_MAPPING.price, 'search_price');
  assert.ok(!(Object.values(AWIN_FEED_MAPPING) as string[]).includes('display_price'));
});
