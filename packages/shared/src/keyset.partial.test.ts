import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectByKeyset } from './keyset.js';

/*
 * SITE HARITASI KISMI BASARISIZLIK DAVRANISI.
 *
 * `getSitemapProducts` bir sayfa okunamadiginda BOS SAYFA dondurup
 * `eksik` bayragini kaldiriyor. Buradaki testler o desenin -- "bos sayfa
 * donguyu bitirir, o ana kadar toplanan KORUNUR" -- gecerli oldugunu
 * kilitliyor. Desen bozulursa harita sessizce kisalirdi.
 */

type Kayit = { slug: string };

function sayfali(toplam: number, hataliSayfa: number | null) {
  let cagri = 0;
  const tumu: Kayit[] = Array.from({ length: toplam }, (_, i) => ({
    slug: String(i).padStart(5, '0'),
  }));

  return {
    get cagriSayisi() {
      return cagri;
    },
    fetchPage: async (after: string | null, limit: number): Promise<Kayit[]> => {
      const buSayfa = cagri++;
      if (hataliSayfa !== null && buSayfa === hataliSayfa) return [];
      const bas = after === null ? 0 : tumu.findIndex((k) => k.slug === after) + 1;
      return tumu.slice(bas, bas + limit);
    },
  };
}

test('hatasiz durumda TUM kayitlar toplanir', async () => {
  const kaynak = sayfali(250, null);
  const cikti = await collectByKeyset<Kayit>({
    max: 1000,
    pageSize: 100,
    key: (k) => k.slug,
    fetchPage: kaynak.fetchPage,
  });

  assert.equal(cikti.length, 250);
});

/*
 * ASIL DAVRANIS: ucuncu sayfa duserse ilk iki sayfa KORUNUR.
 * Uretimdeki eski hal bunun yerine 0 kayitla donuyordu.
 */
test('bir sayfa duserse o ana kadar toplanan KORUNUR', async () => {
  const kaynak = sayfali(500, 2);
  const cikti = await collectByKeyset<Kayit>({
    max: 1000,
    pageSize: 100,
    key: (k) => k.slug,
    fetchPage: kaynak.fetchPage,
  });

  assert.equal(cikti.length, 200);
  assert.equal(cikti[0]!.slug, '00000');
  assert.equal(cikti[199]!.slug, '00199');
});

test('ILK sayfa duserse hic kayit toplanmaz -- cagiran bunu 5xx olarak ayirt eder', async () => {
  const kaynak = sayfali(500, 0);
  const cikti = await collectByKeyset<Kayit>({
    max: 1000,
    pageSize: 100,
    key: (k) => k.slug,
    fetchPage: kaynak.fetchPage,
  });

  assert.equal(cikti.length, 0);
});

test('gercekten bos katalog da 0 dondurur -- ayrimi BAYRAK yapar, uzunluk DEGIL', async () => {
  const kaynak = sayfali(0, null);
  const cikti = await collectByKeyset<Kayit>({
    max: 1000,
    pageSize: 100,
    key: (k) => k.slug,
    fetchPage: kaynak.fetchPage,
  });

  // Iki durum da 0: bu yuzden `SitemapProductPage.complete` bayragi sart.
  assert.equal(cikti.length, 0);
});
