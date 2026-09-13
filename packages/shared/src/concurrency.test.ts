import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eszamanliHaritala } from './concurrency.js';

test('sonuc sirasi girdinin sirasiyla AYNI', async () => {
  // Kasitli olarak ters gecikme: ilk oge en yavas bitiyor.
  const cikti = await eszamanliHaritala([30, 20, 10], 3, async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    return ms;
  });

  assert.deepEqual(cikti, [30, 20, 10]);
});

test('ayni anda tavandan FAZLA cagri acilmaz', async () => {
  let anlik = 0;
  let enYuksek = 0;

  await eszamanliHaritala(Array.from({ length: 12 }, (_, i) => i), 2, async () => {
    anlik++;
    enYuksek = Math.max(enYuksek, anlik);
    await new Promise((r) => setTimeout(r, 5));
    anlik--;
  });

  assert.equal(enYuksek, 2);
});

test('tavan girdiden buyukse girdi sayisiyla sinirli kalir', async () => {
  let anlik = 0;
  let enYuksek = 0;

  await eszamanliHaritala([1, 2], 10, async () => {
    anlik++;
    enYuksek = Math.max(enYuksek, anlik);
    await new Promise((r) => setTimeout(r, 5));
    anlik--;
  });

  assert.equal(enYuksek, 2);
});

test('bos liste hic cagri yapmaz', async () => {
  let cagri = 0;
  const cikti = await eszamanliHaritala([], 4, async () => {
    cagri++;
    return 1;
  });

  assert.deepEqual(cikti, []);
  assert.equal(cagri, 0);
});

/*
 * SIFIR VE NEGATIF TAVAN ASILI KALMAMALI. Naif bir uygulama hic isci
 * baslatmaz ve cagri sonsuza kadar bekler.
 */
test('gecersiz tavan asili birakmaz, en az bir isciyle calisir', async () => {
  for (const tavan of [0, -3, Number.NaN]) {
    const cikti = await eszamanliHaritala([1, 2, 3], tavan, async (x) => x * 2);
    assert.deepEqual(cikti, [2, 4, 6]);
  }
});

test('hata yutulmaz, yukari cikar', async () => {
  await assert.rejects(
    () =>
      eszamanliHaritala([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('patladi');
        return x;
      }),
    /patladi/,
  );
});

test('her oge TAM BIR KEZ islenir', async () => {
  const gorulen: number[] = [];
  await eszamanliHaritala(Array.from({ length: 25 }, (_, i) => i), 3, async (x) => {
    gorulen.push(x);
  });

  assert.equal(gorulen.length, 25);
  assert.deepEqual([...gorulen].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i));
});
