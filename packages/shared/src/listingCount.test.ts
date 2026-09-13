import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SAYIM_TAVANI, sayimAraligi, tavanliSayim, toplamMetni,
} from './listingCount.js';

// --- Aralık ---------------------------------------------------------------

test('sayim araligi tavan+1 kayit okur', () => {
  const { baslangic, bitis } = sayimAraligi(1000);
  assert.equal(baslangic, 0);
  /* `range` ust sinir DAHIL: 0..1000 => 1001 kayit. */
  assert.equal(bitis - baslangic + 1, 1001);
});

test('varsayilan tavan 1000', () => {
  assert.equal(SAYIM_TAVANI, 1000);
  assert.deepEqual(sayimAraligi(), { baslangic: 0, bitis: 1000 });
});

// --- Tavanın ALTINDA sayı KESİN kalır ------------------------------------

test('tavan altinda sayi KESIN, tavana dayanmadi', () => {
  const s = tavanliSayim(7, 1000);
  assert.equal(s.toplam, 7);
  assert.equal(s.tavanaDayandi, false);
});

test('sifir sonuc kesin sifirdir', () => {
  assert.deepEqual(tavanliSayim(0, 1000), { toplam: 0, tavanaDayandi: false });
});

test('tam tavan kadar sonuc HALA kesindir', () => {
  /* 1000 donduyse tavan asilmadi: 1001 gorseydik asilmis olurdu. */
  assert.deepEqual(tavanliSayim(1000, 1000), { toplam: 1000, tavanaDayandi: false });
});

// --- Tavanın ÜSTÜ: alt sınır --------------------------------------------

test('tavan+1 sonuc tavana dayanmis sayilir', () => {
  assert.deepEqual(tavanliSayim(1001, 1000), { toplam: 1000, tavanaDayandi: true });
});

test('tavana dayanan sayi ASLA tavandan buyuk raporlanmaz', () => {
  /* Uydurma ust sinir gostermemek icin: bilmedigimiz sayiyi yazmayiz. */
  const s = tavanliSayim(50_000, 1000);
  assert.equal(s.toplam, 1000);
  assert.equal(s.tavanaDayandi, true);
});

test('tavanli sonuc ALT SINIRDIR: gercek toplam >= raporlanan', () => {
  for (const gercek of [1001, 2000, 32_845]) {
    const s = tavanliSayim(gercek > 1001 ? 1001 : gercek, 1000);
    assert.ok(gercek >= s.toplam, `${gercek} >= ${s.toplam}`);
  }
});

// --- Bozuk girdide uydurma YOK -------------------------------------------

test('negatif satir sayisi sifira cekilir', () => {
  assert.deepEqual(tavanliSayim(-5, 1000), { toplam: 0, tavanaDayandi: false });
});

test('kesirli satir sayisi asagi yuvarlanir', () => {
  assert.equal(tavanliSayim(9.9, 1000).toplam, 9);
});

test('NaN sayim sifir verir, tavana dayanmaz', () => {
  assert.deepEqual(tavanliSayim(Number.NaN, 1000), { toplam: 0, tavanaDayandi: false });
});

test('Infinity sayim FAIL-CLOSED: sonsuz raporlanmaz, sifira duser', () => {
  /*
   * Sonlu olmayan girdi olculmus bir sayi degildir. Tavana dayandi demek
   * "en az 1000 var" iddiasi olurdu -- kanitimiz yokken bu iddiayi
   * kurmuyoruz; sifir ve "kesin" diyoruz, ustte alt sinir uydurmuyoruz.
   */
  const s = tavanliSayim(Number.POSITIVE_INFINITY, 1000);
  assert.equal(s.toplam, 0);
  assert.equal(s.tavanaDayandi, false);
});

test('gecersiz tavan varsayilana duser', () => {
  assert.equal(tavanliSayim(5, Number.NaN).toplam, 5);
  assert.equal(sayimAraligi(Number.NaN).bitis, SAYIM_TAVANI);
});

test('sifir tavan en az bire cekilir', () => {
  /* 0 tavan her sayimi "tavana dayandi" yapardi -- anlamsiz. */
  assert.equal(sayimAraligi(0).bitis, 1);
  assert.deepEqual(tavanliSayim(1, 0), { toplam: 1, tavanaDayandi: false });
});

// --- Kullanıcıya gösterilen metin ----------------------------------------

test('kesin sayi oldugu gibi yazilir', () => {
  assert.equal(toplamMetni('1.234', false), '1.234');
});

test('tavana dayanan sayi ARTI ile yazilir', () => {
  assert.equal(toplamMetni('1.000', true), '1.000+');
});

test('bicimlendirme cagirana ait, burada bozulmaz', () => {
  assert.equal(toplamMetni('32 845', true), '32 845+');
});

// --- Davranış sözleşmesi --------------------------------------------------

test('tavanli sayim exact sayimin maliyetini SABITLER', () => {
  /*
   * Sozlesme: okunan kayit sayisi girdiden BAGIMSIZ olarak tavan+1'i
   * asamaz. Uretimdeki 169 HEAD 500'un kaynagi tam olarak bu sinirin
   * olmamasiydi (~32.000 satir taraniyordu).
   */
  const { baslangic, bitis } = sayimAraligi(1000);
  const enCokOkunan = bitis - baslangic + 1;
  assert.equal(enCokOkunan, 1001);
  assert.ok(enCokOkunan < 32_845);
});

test('tavana dayanmayan her sonuc sayfalanabilir', () => {
  const SAYFA = 24;
  const s = tavanliSayim(999, 1000);
  const sayfa = Math.ceil(s.toplam / SAYFA);
  assert.equal(s.tavanaDayandi, false);
  assert.equal(sayfa, 42);
});

test('tavan sayfalama tavanini da belirler', () => {
  const SAYFA = 24;
  const s = tavanliSayim(99_999, 1000);
  assert.equal(Math.ceil(s.toplam / SAYFA), 42);
});
