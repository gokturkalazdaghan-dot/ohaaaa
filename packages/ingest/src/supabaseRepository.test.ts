/**
 * Adres bütçesine göre parçalamanın testleri.
 *
 * Bu fonksiyon üretimde yaşanan bir arızadan doğdu: `.in(...)` değerleri GET
 * adresinin sorgu dizesine giriyor ve sabit sayıda parçalamak değerlerin
 * UZUNLUĞUNU yok sayıyordu. GTIN'ler 13 hane olduğu için 500'lük parça
 * geçiyor, serbest metin eşleştirme imzaları ise 200'lük parçada adresi 7 KB'ın
 * üzerine çıkarıp `TypeError: fetch failed` ile düşüyordu.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  chunkByUrlBudget,
  geciciOkumaHatasiMi,
  okumayiYenidenDene,
  idempotentYazmayiYenidenDene,
} from './supabaseRepository.js';

test('butce asilmadan once parcalamaz', () => {
  const parcalar = chunkByUrlBudget(['a', 'b', 'c'], 100);
  assert.equal(parcalar.length, 1);
  assert.deepEqual(parcalar[0], ['a', 'b', 'c']);
});

test('uzun degerler daha kucuk parcalar uretir', () => {
  const kisa = chunkByUrlBudget(Array.from({ length: 100 }, () => '1234567890'), 200);
  const uzun = chunkByUrlBudget(Array.from({ length: 100 }, () => 'x'.repeat(40)), 200);

  assert.ok(
    uzun.length > kisa.length,
    `uzun degerler daha cok parcaya bolunmeliydi (kisa=${kisa.length}, uzun=${uzun.length})`,
  );
});

test('hicbir parca butceyi asmaz', () => {
  const imzalar = Array.from({ length: 500 }, (_, i) => `marka${i}|urun adi ornek ${i}`);
  for (const parca of chunkByUrlBudget(imzalar, 2000)) {
    const maliyet = parca.reduce((t, d) => t + encodeURIComponent(d).length + 1, 0);
    // Tek deger butceyi asiyorsa yalniz gonderilir; onun disinda butce gecerli.
    if (parca.length > 1) assert.ok(maliyet <= 2000, `parca butceyi asti: ${maliyet}`);
  }
});

test('butceyi tek basina asan deger kendi parcasinda gider (sonsuz dongu yok)', () => {
  const parcalar = chunkByUrlBudget(['x'.repeat(5000), 'kisa'], 100);
  assert.equal(parcalar.length, 2);
  assert.equal(parcalar[0]!.length, 1);
  assert.deepEqual(parcalar[1], ['kisa']);
});

test('bos girdi bos sonuc verir', () => {
  assert.deepEqual(chunkByUrlBudget([], 100), []);
});

test('yuzde kodlamasi maliyete dahil edilir', () => {
  // Bosluk %20 olur: 3 karakter. Ham uzunluga bakan bir uygulama bunu kacirir.
  const parcalar = chunkByUrlBudget(['a b c d e', 'a b c d e'], 12);
  assert.equal(parcalar.length, 2, 'kodlanmis maliyet hesaba katilmadi');
});

// ---------------------------------------------------------------------------
// GECICI OKUMA HATALARINDA YENIDEN DENEME
// ---------------------------------------------------------------------------
// Uretimde olculdu: esleştirme asamasi ~750 ardisik sorgu atiyor ve bunlardan
// BIRININ 504 almasi tum alimi dusuruyordu ("Kanonik urun sorgusu basarisiz:
// Gateway Timeout"). Asagidaki testler o davranisin geri gelmemesini kilitler.

test('gecici hata taninir, kalici hata taninmaz', () => {
  assert.equal(geciciOkumaHatasiMi('Gateway Timeout'), true);
  assert.equal(geciciOkumaHatasiMi('TypeError: fetch failed'), true);
  assert.equal(geciciOkumaHatasiMi('socket hang up'), true);

  // Kalici hatalar yeniden DENENMEMELI -- yoksa ariza gizlenir ve gecikir.
  assert.equal(
    geciciOkumaHatasiMi('column product_groups.gtin_normalized does not exist'),
    false,
  );
  assert.equal(geciciOkumaHatasiMi('permission denied for table products'), false);
});

test('gecici hatada yeniden denenir ve sonunda basarili olur', async () => {
  let cagri = 0;
  const beklemeler: number[] = [];

  const sonuc = await okumayiYenidenDene(
    () => {
      cagri += 1;
      return Promise.resolve(
        cagri < 3
          ? { data: null, error: { message: 'Gateway Timeout' } }
          : { data: [{ id: '1' }], error: null },
      );
    },
    4,
    (ms) => {
      beklemeler.push(ms);
      return Promise.resolve();
    },
  );

  assert.equal(cagri, 3);
  assert.equal(sonuc.error, null);
  // Ustel geri cekilme: sabit aralik degil.
  assert.deepEqual(beklemeler, [250, 500]);
});

test('KALICI hata ANINDA doner -- yeniden denenmez', async () => {
  let cagri = 0;

  const sonuc = await okumayiYenidenDene(
    () => {
      cagri += 1;
      return Promise.resolve({
        data: null,
        error: { message: 'column "yok" does not exist' },
      });
    },
    4,
    () => Promise.resolve(),
  );

  // Bu test sart: kalici hatayi da yeniden deneyen bir uygulama, eksik sutun
  // gibi ariza durumlarinda alimi dort kat yavaslatir ve hatayi gizler.
  assert.equal(cagri, 1);
  assert.equal(sonuc.error?.message, 'column "yok" does not exist');
});

test('deneme hakki tukenirse son hata dondurulur -- sessizce yutulmaz', async () => {
  let cagri = 0;

  const sonuc = await okumayiYenidenDene(
    () => {
      cagri += 1;
      return Promise.resolve({ data: null, error: { message: 'Gateway Timeout' } });
    },
    3,
    () => Promise.resolve(),
  );

  assert.equal(cagri, 3);
  assert.equal(sonuc.error?.message, 'Gateway Timeout');
});

test('ilk deneme basarili olursa hic beklenmez', async () => {
  let cagri = 0;
  let beklendi = false;

  await okumayiYenidenDene(
    () => {
      cagri += 1;
      return Promise.resolve({ data: [], error: null });
    },
    4,
    () => {
      beklendi = true;
      return Promise.resolve();
    },
  );

  assert.equal(cagri, 1);
  assert.equal(beklendi, false);
});

// ---------------------------------------------------------------------------
// IDEMPOTENT YAZMA -- ama YALNIZCA idempotent olanlar
// ---------------------------------------------------------------------------
// Uretimde olculdu: alim 34.721 grubu actiktan sonra teklif yazma
// asamasinda dustu -- "Teklifler yazilamadi: Gateway Timeout" -- ve
// 35.759 kalemin yalnizca 5.001'i yazilabildi. Yazmalari bastan kapsam
// disi birakmak `createGroups` (cakisma hedefi olmayan insert) icin
// dogruydu, upsert icin fazla temkinliydi.

test('idempotent yazma gecici hatada yeniden denenir', async () => {
  let cagri = 0;

  const sonuc = await idempotentYazmayiYenidenDene(
    () => {
      cagri += 1;
      return Promise.resolve(
        cagri < 2
          ? { error: { message: 'Gateway Timeout' } }
          : { error: null },
      );
    },
    4,
    () => Promise.resolve(),
  );

  assert.equal(cagri, 2);
  assert.equal(sonuc.error, null);
});

test('idempotent yazma KALICI hatayi yeniden DENEMEZ', async () => {
  let cagri = 0;

  await idempotentYazmayiYenidenDene(
    () => {
      cagri += 1;
      return Promise.resolve({
        error: { message: 'duplicate key value violates unique constraint' },
      });
    },
    4,
    () => Promise.resolve(),
  );

  // Bu test sart ve konusu tam olarak kisit ihlali: mukerrer anahtar
  // hatasini yeniden denemek ayni hatayi dort kez alip arizayi gizlemekti.
  assert.equal(cagri, 1);
});
