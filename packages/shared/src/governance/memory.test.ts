import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Hafiza, OMURLER, hafizaKontrol } from './memory.js';
import type { HafizaKaydi } from './memory.js';

const T = 1_700_000_000_000;

function kayit(over: Partial<HafizaKaydi> = {}): HafizaKaydi {
  return {
    tur: 'dogrulanmis_gercek', anahtar: 'urun-123-gtin',
    deger: { gtin: '0123456789012' },
    kaynak: 'product_groups.gtin_normalized', dogrulandi: true, yazildi: T,
    ...over,
  };
}

test('dogrulanmis kayit yazilir ve okunur', () => {
  const h = new Hafiza();
  h.yaz(kayit());
  assert.deepEqual(h.oku('dogrulanmis_gercek', 'urun-123-gtin', T), { gtin: '0123456789012' });
});

test('kaynaksiz kayit REDDEDILIR', () => {
  assert.deepEqual(hafizaKontrol(kayit({ kaynak: '  ' })), ['kaynak_yok']);
  assert.throws(() => new Hafiza().yaz(kayit({ kaynak: '' })), /kaynak_yok/);
});

test('dogrulanmamis gercek hafizaya GIRMEZ', () => {
  assert.deepEqual(hafizaKontrol(kayit({ dogrulandi: false })), ['dogrulanmamis']);
});

test('gorev durumu ve hata gecmisi dogrulama istemez', () => {
  assert.deepEqual(hafizaKontrol(kayit({ tur: 'gorev_durumu', dogrulandi: false })), []);
  assert.deepEqual(hafizaKontrol(kayit({ tur: 'hata_gecmisi', dogrulandi: false })), []);
});

test('hassas veri hafizaya YAZILMAZ', () => {
  const h = new Hafiza();
  assert.throws(
    () => h.yaz(kayit({ deger: { api_key: 'sbp_x' } })),
    /hassas_veri/,
  );
  assert.equal(h.boyut, 0);
});

test('hassas anahtar adi da reddedilir', () => {
  assert.ok(hafizaKontrol(kayit({ anahtar: 'user-eposta' })).includes('hassas_veri'));
});

test('suresi dolan kayit OKUNMAZ', () => {
  const h = new Hafiza();
  h.yaz(kayit({ tur: 'urun_bilgisi' }));
  const sonra = T + OMURLER.urun_bilgisi + 1;
  assert.equal(h.oku('urun_bilgisi', 'urun-123-gtin', sonra), null);
  /* Kayıt hâlâ duruyor -- okuma yolu bakıma bağlı değil. */
  assert.equal(h.boyut, 1);
});

test('budama yalnizca suresi dolanlari siler', () => {
  const h = new Hafiza();
  h.yaz(kayit({ tur: 'urun_bilgisi', anahtar: 'eski' }));
  h.yaz(kayit({ tur: 'sistem_bilgisi', anahtar: 'yeni' }));
  const sonra = T + OMURLER.urun_bilgisi + 1;
  assert.equal(h.budama(sonra), 1);
  assert.equal(h.boyut, 1);
  assert.notEqual(h.oku('sistem_bilgisi', 'yeni', sonra), null);
});

test('farkli turler ayni anahtari paylasabilir', () => {
  const h = new Hafiza();
  h.yaz(kayit({ tur: 'urun_bilgisi', anahtar: 'x', deger: 1 }));
  h.yaz(kayit({ tur: 'magaza_bilgisi', anahtar: 'x', deger: 2 }));
  assert.equal(h.oku('urun_bilgisi', 'x', T), 1);
  assert.equal(h.oku('magaza_bilgisi', 'x', T), 2);
});

test('olmayan kayit null doner', () => {
  assert.equal(new Hafiza().oku('urun_bilgisi', 'yok', T), null);
});
