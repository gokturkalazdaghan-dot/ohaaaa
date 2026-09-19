/**
 * AWIN KEŞFİ: ANAHTAR SIZMAZ, DURUM UYDURULMAZ
 *
 * Bu adımın iki gerçek riski var ve testler ikisine de bakıyor:
 *   1) Awin anahtarı YOLDA duruyor -- çıktıya sızarsa git geçmişine,
 *      CI günlüğüne ve ekran görüntüsüne girer.
 *   2) Üyelik durumu yanlış okunursa onaylanmamış bir program onaylı
 *      görünür.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { awinFeedListesiniGetir, kesfiYazdir } from './awinKesif.js';
import { clearSecretsForTest } from './http/redact.js';
import { IngestError } from './errors.js';

const SAHTE_ANAHTAR = 'deadbeefdeadbeefdeadbeefdeadbeef';
const ORTAM = { AWIN_DATAFEED_API_KEY: SAHTE_ANAHTAR } as NodeJS.ProcessEnv;

const CSV =
  'Advertiser ID,Advertiser Name,Feed ID,Feed Name,No of products,Membership Status\n' +
  '12044,AliExpress PL,98765,Main Feed,1200000,joined\n' +
  '61655,Back to the Office,111663,In Stock Feed,35952,joined\n' +
  '120101,Alison US CA,111515,Alison Course Feeds,5594,pending\n';

test('anahtar adrese yerleşir ama ÇIKTIYA SIZMAZ', async () => {
  clearSecretsForTest();

  let gorulenAdres = '';
  const sonuc = await awinFeedListesiniGetir(
    async (url) => {
      gorulenAdres = url;
      return { body: CSV, status: 200 };
    },
    ORTAM,
  );

  // Adres gercek anahtari TASIMALI -- yoksa istek 401 donerdi.
  assert.ok(gorulenAdres.includes(SAHTE_ANAHTAR));

  // Ama basilan hicbir satirda gorunmemeli.
  const satirlar: string[] = [];
  kesfiYazdir(sonuc, (s) => satirlar.push(s));
  const hepsi = satirlar.join('\n');

  assert.doesNotMatch(hepsi, new RegExp(SAHTE_ANAHTAR, 'i'));
  assert.ok(hepsi.includes('AliExpress PL'), 'feed listesi yine de okunabilmeli');
});

test('üyelik durumu ağın söylediği gibi basılır', () => {
  const satirlar: string[] = [];
  kesfiYazdir(
    {
      kayitlar: [
        {
          advertiserId: '120101',
          advertiserName: 'Alison US CA',
          feedId: '111515',
          feedName: null,
          region: null,
          language: null,
          itemCount: 5594,
          membershipStatus: 'pending',
        },
      ],
      uyarilar: [],
    },
    (s) => satirlar.push(s),
  );

  const hepsi = satirlar.join('\n');
  assert.ok(hepsi.includes('pending'));
  assert.doesNotMatch(hepsi, /APPROVED/);
});

test('bilinmeyen ürün sayısı toplama KATILMAZ', () => {
  /*
   * Bilinmeyeni sifir saymak, yer butcesini oldugundan genis gosterir ve
   * 500 MB'lik sinirda yanlis karar urettirir.
   */
  const satirlar: string[] = [];
  kesfiYazdir(
    {
      kayitlar: [
        {
          advertiserId: '1',
          advertiserName: 'Bilinen',
          feedId: '10',
          feedName: null,
          region: null,
          language: null,
          itemCount: 100,
          membershipStatus: null,
        },
        {
          advertiserId: '2',
          advertiserName: 'Bilinmeyen',
          feedId: '20',
          feedName: null,
          region: null,
          language: null,
          itemCount: null,
          membershipStatus: null,
        },
      ],
      uyarilar: [],
    },
    (s) => satirlar.push(s),
  );

  const hepsi = satirlar.join('\n');
  assert.ok(hepsi.includes('bilinen 1 feed'), hepsi);
  assert.ok(hepsi.includes("1 feed'in sayısı bilinmiyor"), hepsi);
});

test('200 dışı yanıt SESSİZ GEÇMEZ', async () => {
  let hata: unknown;
  try {
    await awinFeedListesiniGetir(async () => ({ body: '', status: 403 }), ORTAM);
  } catch (e) {
    hata = e;
  }
  assert.ok(hata instanceof IngestError);
  assert.match(hata.message, /403/);
});

test('anahtar ortamda yoksa YAPILANDIRMA HATASI verir', async () => {
  let hata: unknown;
  try {
    await awinFeedListesiniGetir(async () => ({ body: CSV, status: 200 }), {} as NodeJS.ProcessEnv);
  } catch (e) {
    hata = e;
  }
  assert.ok(hata instanceof IngestError);
  // Degiskenin ADINI soylemeli, degerini degil.
  assert.match(hata.message, /AWIN_DATAFEED_API_KEY/);
});
