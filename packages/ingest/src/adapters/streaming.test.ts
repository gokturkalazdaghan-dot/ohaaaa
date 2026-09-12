/**
 * BELLEK REGRESYON TESTİ — 116k satır sınırlı bellekte işlenmeli.
 *
 * NEDEN VAR
 * Gerçek bir Awin beslemesi (Back to the Office, 116 417 satır) toplu
 * çözümleyicide 4 GB heap'i patlattı; ölçüldüğünde 30 MB'lık metin için
 * 586 MB kalıcı bellek bırakıyordu (~19x). Sorun satır sayısı değil,
 * çözümleyicinin BÜTÜN çıktıyı biriktirmesiydi.
 *
 * Bu dosya o davranışın geri gelmesini engelliyor: parça parça çözümlemede
 * tutulan bellek, besleme büyüdükçe BÜYÜMEMELİ.
 *
 * Fixture ÇALIŞMA ANINDA üretiliyor -- 30 MB'lık bir dosya depoya konmaz.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { parseCsv, streamCsvBatches } from './csv.js';

const SATIR = 116_417;
const BASLIK = 'aw_product_id,product_name,aw_deep_link,search_price,currency,in_stock,ean,mpn';

/** TEST verisi üretir; hiçbir değeri gerçek bir beslemeden gelmiyor. */
function fixture(n: number): string {
  const parcalar: string[] = [BASLIK];
  for (let i = 0; i < n; i += 1) {
    parcalar.push(
      `TEST-${i},TEST Urun ${i} biraz uzunca bir baslik,`
      + `https://www.awin1.com/pclick.php?p=${i}&a=3074081&m=61655,`
      + `${10 + (i % 90)}.99,GBP,1,,MPN-${i}`,
    );
  }
  return parcalar.join('\n');
}

/** gc çağrısı mümkünse yapılır; değilse ölçüm yine de anlamlıdır. */
function topla(): void {
  (globalThis as { gc?: () => void }).gc?.();
}

test('116k satir parca parca ve TAM olarak isleniyor', () => {
  const csv = fixture(SATIR);
  let sayac = 0;
  let enBuyukParca = 0;

  for (const batch of streamCsvBatches(csv, { batchSize: 2_000 })) {
    sayac += batch.records.length;
    if (batch.records.length > enBuyukParca) enBuyukParca = batch.records.length;
  }

  assert.equal(sayac, SATIR, 'hicbir satir kaybolmamali');
  assert.ok(enBuyukParca <= 2_000, `parca sinirini asti: ${enBuyukParca}`);
});

/*
 * ASIL İDDİA: tutulan bellek parçaya bağlı, besleme boyutuna DEĞİL.
 *
 * Ölçüm gürültülüdür (gc zamanlaması, V8 iç yapıları), bu yüzden eşik
 * gevşek tutuldu: 120 MB. Eski davranış 586 MB bırakıyordu, yani regresyon
 * bu eşiği rahatça aşar. Eşiği daraltmak testi kırılgan yapardı; amaç
 * mikro-optimizasyonu değil BÜYÜKLÜK MERTEBESİNİ korumak.
 */
test('akan cozumlemede tutulan bellek besleme boyutuyla BUYUMUYOR', () => {
  const csv = fixture(SATIR);

  topla();
  const taban = process.memoryUsage().heapUsed;
  let zirve = 0;
  let i = 0;

  for (const batch of streamCsvBatches(csv, { batchSize: 2_000 })) {
    // Parça TÜKETİLİYOR ve bırakılıyor -- gerçek kullanım böyle.
    if (batch.records.length === 0) continue;
    if ((i += 1) % 10 === 0) {
      topla();
      const tutulan = process.memoryUsage().heapUsed - taban;
      if (tutulan > zirve) zirve = tutulan;
    }
  }

  const zirveMb = zirve / 1_048_576;
  assert.ok(
    zirveMb < 120,
    `akan cozumlemede tutulan bellek ${zirveMb.toFixed(1)} MB -- 120 MB esigi asildi, `
    + 'biriktirme geri gelmis olabilir',
  );
});

/*
 * AKAN YOL İLE TOPLU YOL AYNI SONUCU VERİR.
 *
 * İkisi aynı çözümleyicinin üstünde duruyor; bu iddia onların
 * ayrışamayacağını sabitliyor. Ayrışsalardı "küçük beslemede doğru, büyük
 * beslemede farklı" gibi bulunması en zor hata sınıfı doğardı.
 */
test('akan ve toplu yol ayni kayitlari uretiyor', () => {
  const csv = fixture(5_000);
  const toplu = parseCsv(csv);

  const akan: Record<string, string>[] = [];
  for (const batch of streamCsvBatches(csv, { batchSize: 137 })) {
    for (const r of batch.records) akan.push(r);
  }

  assert.equal(akan.length, toplu.records.length);
  assert.deepEqual(akan[0], toplu.records[0]);
  assert.deepEqual(akan[akan.length - 1], toplu.records[toplu.records.length - 1]);
  assert.deepEqual(akan, toplu.records, 'iki yol birebir ayni olmali');
});

/* Parça sınırı satır sınırına denk gelse de kayıt kaybolmaz/ikilenmez. */
test('parca siniri satir sinirina denk gelince kayit kaybolmuyor', () => {
  for (const boyut of [1, 2, 3, 999, 1_000, 1_001]) {
    const csv = fixture(1_000);
    let n = 0;
    for (const b of streamCsvBatches(csv, { batchSize: boyut })) n += b.records.length;
    assert.equal(n, 1_000, `batchSize=${boyut}`);
  }
});
