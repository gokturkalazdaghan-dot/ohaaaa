import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectByKeyset } from './keyset.js';

type Kayit = { slug: string };

/** Sıralı bir kaynağı taklit eder ve kaç kez çağrıldığını sayar. */
function kaynak(sluglar: string[]) {
  const sirali = [...sluglar].sort();
  let cagri = 0;
  return {
    get cagri() { return cagri; },
    fetchPage: async (after: string | null, limit: number): Promise<Kayit[]> => {
      cagri += 1;
      return sirali
        .filter((s) => after === null || s > after)
        .slice(0, limit)
        .map((slug) => ({ slug }));
    },
  };
}

const key = (k: Kayit) => k.slug;

test('tam listeyi atlamadan ve tekrarlamadan toplar', async () => {
  const sluglar = Array.from({ length: 3500 }, (_, i) => `urun-${String(i).padStart(5, '0')}`);
  const k = kaynak(sluglar);

  const sonuc = await collectByKeyset({ max: 45_000, pageSize: 1000, key, fetchPage: k.fetchPage });

  assert.equal(sonuc.length, 3500);
  assert.equal(new Set(sonuc.map(key)).size, 3500, 'tekrar eden kayıt olmamalı');
  assert.deepEqual(sonuc.map(key), [...sluglar].sort(), 'atlanan kayıt olmamalı');
});

test('sayfa boyutunun TAM katı olan listede sonsuz dönmez', async () => {
  // Kaynak son sayfadan sonra boş sayfa verir; döngü onu görüp durmalı.
  const sluglar = Array.from({ length: 2000 }, (_, i) => `u-${String(i).padStart(4, '0')}`);
  const k = kaynak(sluglar);

  const sonuc = await collectByKeyset({ max: 45_000, pageSize: 1000, key, fetchPage: k.fetchPage });

  assert.equal(sonuc.length, 2000);
  assert.equal(k.cagri, 3, '2 dolu sayfa + 1 boş sayfa beklenir');
});

test('max aşılmaz ve fazladan istek yapılmaz', async () => {
  const sluglar = Array.from({ length: 5000 }, (_, i) => `u-${String(i).padStart(4, '0')}`);
  const k = kaynak(sluglar);

  const sonuc = await collectByKeyset({ max: 1500, pageSize: 1000, key, fetchPage: k.fetchPage });

  assert.equal(sonuc.length, 1500);
  assert.equal(k.cagri, 2, 'ikinci sayfa 500 isteyip 500 almalı ve durmalı');
});

test('boş kaynakta tek istekle biter', async () => {
  const k = kaynak([]);
  const sonuc = await collectByKeyset({ max: 45_000, pageSize: 1000, key, fetchPage: k.fetchPage });

  assert.deepEqual(sonuc, []);
  assert.equal(k.cagri, 1);
});

test('max sıfır veya negatifse hiç istek yapılmaz', async () => {
  const k = kaynak(['a', 'b']);

  assert.deepEqual(await collectByKeyset({ max: 0, pageSize: 10, key, fetchPage: k.fetchPage }), []);
  assert.deepEqual(await collectByKeyset({ max: -5, pageSize: 10, key, fetchPage: k.fetchPage }), []);
  assert.equal(k.cagri, 0, 'veritabanına hiç gidilmemeli');
});

test('sayfa boyutu sıfırsa hiç istek yapılmaz -- sonsuz döngü yerine boş sonuç', async () => {
  const k = kaynak(['a', 'b']);
  assert.deepEqual(await collectByKeyset({ max: 10, pageSize: 0, key, fetchPage: k.fetchPage }), []);
  assert.equal(k.cagri, 0);
});
