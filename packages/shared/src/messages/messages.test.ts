import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EN, TR, TRANSLATED_LOCALES, isTranslatedLocale, splitMessage, t } from './index.js';

test('İngilizce sözlük Türkçe ile BİREBİR aynı anahtarları taşır', () => {
  /*
   * Bu testin derleyiciye ek olarak var olmasının sebebi: `Record<keyof TR>`
   * eksik anahtarı yakalar ama FAZLA anahtarı (yazım hatasıyla eklenmiş bir
   * satır) her zaman yakalamaz. Yarım ya da sarkan çeviri kullanıcıya bozuk
   * görünür.
   */
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(TR).sort());
});

test('hiçbir metin BOŞ değil', () => {
  for (const [anahtar, metin] of [...Object.entries(TR), ...Object.entries(EN)]) {
    assert.ok(metin.trim().length > 0, `${anahtar} boş`);
  }
});

test('İngilizce metinlerde Türkçe karakter KALMAMIŞ', () => {
  // Kopyala-yapıştır ile Türkçe metnin İngilizce sözlükte kalması, tam olarak
  // önlemek istediğimiz "yarım çeviri" hatasıdır.
  for (const [anahtar, metin] of Object.entries(EN)) {
    assert.ok(!/[çğışÇĞİŞ]/.test(metin), `${anahtar} Türkçe karakter içeriyor: ${metin}`);
  }
});

test('değişkenler iki sözlükte de AYNI', () => {
  const degiskenler = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
  for (const anahtar of Object.keys(TR) as (keyof typeof TR)[]) {
    assert.deepEqual(
      degiskenler(EN[anahtar]),
      degiskenler(TR[anahtar]),
      `${anahtar} değişkenleri uyuşmuyor`,
    );
  }
});

test('t() değişkenleri yerine koyar', () => {
  assert.equal(t('tr', 'magaza.urunSayisi', { adet: '35.742' }), '35.742 ürün');
  assert.equal(t('en', 'magaza.urunSayisi', { adet: '35,742' }), '35,742 products');
});

test('verilmeyen değişken OLDUĞU GİBİ kalır -- sessizce boşluk basılmaz', () => {
  assert.equal(t('tr', 'magaza.urunSayisi'), '{adet} ürün');
  assert.equal(t('tr', 'magaza.urunSayisi', {}), '{adet} ürün');
});

test('çevirisi olmayan dil Türkçeye düşer, anahtar ekrana basılmaz', () => {
  assert.equal(t('de', 'ortak.urunler'), TR['ortak.urunler']);
  assert.ok(!isTranslatedLocale('de'));
});

test('çevirisi olan diller açıkça bildiriliyor', () => {
  assert.deepEqual(TRANSLATED_LOCALES.sort(), ['en', 'tr']);
  assert.ok(isTranslatedLocale('tr') && isTranslatedLocale('en'));
});

// --- splitMessage ---------------------------------------------------------

test('splitMessage cumleyi duz parca ve degisken olarak ayirir', () => {
  const parcalar = splitMessage('tr', 'kategori.urunAdet');
  assert.deepEqual(parcalar, [
    { kind: 'param', name: 'adet' },
    { kind: 'text', value: ' ürünü' },
  ]);
});

test('splitMessage bos parca uretmez', () => {
  // Yer tutucu BAŞTA: naif bir `split` burada boş bir ilk parça bırakır ve
  // arayüz katmanı her cümlenin başına boş bir düğüm basardı.
  for (const locale of ['tr', 'en'] as const) {
    for (const parca of splitMessage(locale, 'kategori.urunAdet')) {
      if (parca.kind === 'text') assert.notEqual(parca.value, '');
    }
  }
});

test('splitMessage her degiskeni AYRI parca olarak verir', () => {
  const adlar = splitMessage('tr', 'kategori.ozetSayim')
    .filter((parca) => parca.kind === 'param')
    .map((parca) => (parca.kind === 'param' ? parca.name : ''));

  assert.deepEqual(adlar.sort(), ['ad', 'sayfaBilgisi', 'urunSayisi']);
});

/*
 * SÖZ DİZİMİ DİLE GÖRE DEĞİŞİYOR -- `splitMessage`'in var olma sebebi bu.
 * Türkçe cümle kategori adıyla başlıyor, İngilizce cümle sayıyla. Cümleyi
 * parçalara bölüp sabit sırada birleştirseydik İngilizcesi bozuk kurulurdu.
 */
test('degisken sirasi dile gore DEGISIYOR', () => {
  const sira = (locale: 'tr' | 'en') =>
    splitMessage(locale, 'kategori.ozetSayim')
      .filter((parca) => parca.kind === 'param')
      .map((parca) => (parca.kind === 'param' ? parca.name : ''));

  assert.equal(sira('tr')[0], 'ad');
  assert.equal(sira('en')[0], 'urunSayisi');
});

test('degiskensiz metin tek parca doner', () => {
  assert.deepEqual(splitMessage('tr', 'ortak.anaSayfa'), [
    { kind: 'text', value: 'Ana sayfa' },
  ]);
});
