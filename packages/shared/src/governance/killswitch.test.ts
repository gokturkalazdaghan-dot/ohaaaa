import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KillSwitch, durdurmaKarari } from './killswitch.js';
import type { SistemSaglikSinyali } from './killswitch.js';

function sinyal(over: Partial<SistemSaglikSinyali> = {}): SistemSaglikSinyali {
  return {
    calistirma: 10,
    basarisiz: 0,
    dogrulamaReddi: 0,
    harcamaKurus: 0,
    butceKurus: 10_000,
    yazilanSatir: 0,
    yazmaTavani: 1000,
    butunlukTamam: true,
    guvenlikOlayi: false,
    ...over,
  };
}

test('saglikli sistemde durdurma yok', () => {
  assert.equal(durdurmaKarari(sinyal()), null);
});

test('guvenlik olayi her seyin onunde gelir', () => {
  assert.equal(durdurmaKarari(sinyal({ guvenlikOlayi: true })), 'guvenlik_olayi');
});

test('butunluk bozuksa veri bozulmasi', () => {
  assert.equal(durdurmaKarari(sinyal({ butunlukTamam: false })), 'veri_bozulmasi');
});

test('butce asimi durdurur', () => {
  assert.equal(
    durdurmaKarari(sinyal({ harcamaKurus: 10_001, butceKurus: 10_000 })),
    'maliyet_asimi',
  );
});

test('anormal yazma hacmi durdurur', () => {
  assert.equal(
    durdurmaKarari(sinyal({ yazilanSatir: 5000, yazmaTavani: 1000 })),
    'beklenmeyen_toplu_degisiklik',
  );
});

test('calistirmalarin yarisi basarisizsa durdurur', () => {
  assert.equal(
    durdurmaKarari(sinyal({ calistirma: 10, basarisiz: 5 })),
    'yaygin_ajan_hatasi',
  );
});

test('tekrarlayan dogrulama reddi durdurur', () => {
  assert.equal(
    durdurmaKarari(sinyal({ calistirma: 8, dogrulamaReddi: 4 })),
    'tekrarlayan_dogrulama_hatasi',
  );
});

test('az ornekte oran hesaplanmaz -- gurultu olay sayilmaz', () => {
  /* 3 çalıştırmanın 2'si başarısız: oran %66 ama örnek yetersiz. */
  assert.equal(durdurmaKarari(sinyal({ calistirma: 3, basarisiz: 2 })), null);
});

test('guvenli moda gecince yalnizca okuma araclari izinli', () => {
  const ks = new KillSwitch();
  assert.equal(ks.guvenliMod, false);
  assert.equal(ks.aracIzinli('write_catalog'), true);

  ks.durdur('guvenlik_olayi', 'test');
  assert.equal(ks.guvenliMod, true);
  assert.equal(ks.aracIzinli('write_catalog'), false);
  assert.equal(ks.aracIzinli('read_catalog'), true);
});

test('ilk durdurma sebebi korunur -- sonrakiler onun sonucu', () => {
  const ks = new KillSwitch();
  ks.durdur('guvenlik_olayi', 'ilk');
  ks.durdur('yaygin_ajan_hatasi', 'ikinci');
  assert.equal(ks.durum?.sebep, 'guvenlik_olayi');
  assert.equal(ks.durum?.kanit, 'ilk');
});

test('degerlendir, sinyal kotuyse otomatik durdurur', () => {
  const ks = new KillSwitch();
  assert.equal(ks.degerlendir(sinyal()), null);
  assert.equal(ks.guvenliMod, false);

  ks.degerlendir(sinyal({ butunlukTamam: false }));
  assert.equal(ks.guvenliMod, true);
  assert.equal(ks.durum?.sebep, 'veri_bozulmasi');
});

test('guvenli moddan cikis onaylayan kimlik olmadan REDDEDILIR', () => {
  const ks = new KillSwitch();
  ks.durdur('elle', 'bakim');
  assert.throws(() => ks.serbestBirak('   '), /onaylayan kimlik zorunlu/);
  assert.equal(ks.guvenliMod, true);

  ks.serbestBirak('cto');
  assert.equal(ks.guvenliMod, false);
});
