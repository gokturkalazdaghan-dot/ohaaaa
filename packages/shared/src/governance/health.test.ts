import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AjanSagligi, EN_AZ_GOZLEM, bosMetrik, ekDogrulamaGerekir, gorevAlabilir,
  hakEdilenDurum, metrikEkle, ozetle, yazmaIzinli,
} from './health.js';
import type { CalistirmaSonucu } from './health.js';

function sonuc(over: Partial<CalistirmaSonucu> = {}): CalistirmaSonucu {
  return { basarili: true, dogrulamaReddi: false, guven: 0.9, gercektenDogru: true,
           denemeler: 1, sureMs: 100, maliyetKurus: 5, ...over };
}

function metrikler(n: number, over: Partial<CalistirmaSonucu> = {}) {
  let m = bosMetrik();
  for (let i = 0; i < n; i++) m = metrikEkle(m, sonuc(over));
  return m;
}

test('bos metrikte oranlar guvenli varsayilana duser', () => {
  const o = ozetle(bosMetrik());
  assert.equal(o.basariOrani, 1);
  assert.equal(o.hataOrani, 0);
  assert.equal(o.isabetOrani, null);
  assert.equal(o.guvenSapmasi, null);
});

test('yetersiz gozlemde durum saglikli kalir -- gurultu ceza degil', () => {
  const m = metrikler(EN_AZ_GOZLEM - 1, { basarili: false });
  assert.equal(hakEdilenDurum(m), 'saglikli');
});

test('yuksek hata orani karantina uretir', () => {
  const m = metrikler(10, { basarili: false, gercektenDogru: false });
  assert.equal(hakEdilenDurum(m), 'karantina');
});

test('orta hata orani kisitli uretir', () => {
  let m = bosMetrik();
  for (let i = 0; i < 10; i++) m = metrikEkle(m, sonuc({ basarili: i >= 4 }));
  assert.equal(hakEdilenDurum(m), 'kisitli');
});

test('dusuk hata orani uyari uretir', () => {
  let m = bosMetrik();
  for (let i = 0; i < 10; i++) m = metrikEkle(m, sonuc({ basarili: i >= 2 }));
  assert.equal(hakEdilenDurum(m), 'uyari');
});

test('dogrulama reddi tek basina kisitliya indirir', () => {
  /* Başarılı ama sürekli reddedilen çıktı: ajan çalışıyor, doğru çalışmıyor. */
  const m = metrikler(10, { basarili: true, dogrulamaReddi: true });
  assert.equal(hakEdilenDurum(m), 'kisitli');
});

test('guven sapmasi uyari uretir -- oldugundan emin gorunen ajan', () => {
  /* Güven 0.95 beyan ediyor, gerçekte %50 isabet ediyor. */
  let m = bosMetrik();
  for (let i = 0; i < 10; i++) {
    m = metrikEkle(m, sonuc({ guven: 0.95, gercektenDogru: i % 2 === 0 }));
  }
  const o = ozetle(m);
  assert.ok(o.guvenSapmasi !== null && o.guvenSapmasi > 0.4);
  assert.equal(hakEdilenDurum(m), 'uyari');
});

test('olculemeyen sonuclar isabet hesabina girmez', () => {
  const m = metrikler(10, { gercektenDogru: null });
  assert.equal(ozetle(m).isabetOrani, null);
  assert.equal(ozetle(m).guvenSapmasi, null);
});

test('yetki matrisi durumla birlikte daralir', () => {
  assert.equal(yazmaIzinli('saglikli'), true);
  assert.equal(yazmaIzinli('uyari'), true);
  assert.equal(yazmaIzinli('kisitli'), false);
  assert.equal(yazmaIzinli('karantina'), false);

  assert.equal(gorevAlabilir('kisitli'), true);
  assert.equal(gorevAlabilir('karantina'), false);

  assert.equal(ekDogrulamaGerekir('saglikli'), false);
  assert.equal(ekDogrulamaGerekir('uyari'), true);
});

test('defter yalnizca ASAGI iner, kendiliginden iyilesmez', () => {
  const s = new AjanSagligi('test');
  for (let i = 0; i < 10; i++) s.isle(sonuc({ basarili: false, gercektenDogru: false }));
  assert.equal(s.durum, 'karantina');

  /* Bundan sonra hep başarılı olsa bile karantinada kalır. */
  for (let i = 0; i < 50; i++) s.isle(sonuc());
  assert.equal(s.durum, 'karantina');
});

test('iyilestirme denetci kimligi olmadan REDDEDILIR', () => {
  const s = new AjanSagligi('test');
  s.karantinayaAl();
  assert.throws(() => s.iyilestir('  '), /denetçi kimliği zorunlu/);
  assert.equal(s.durum, 'karantina');

  s.iyilestir('supreme-auditor');
  assert.equal(s.durum, 'saglikli');
});

test('iyilestirme metrikleri sifirlar -- eski sayilar yeni hali cezalandirmasin', () => {
  const s = new AjanSagligi('test');
  for (let i = 0; i < 10; i++) s.isle(sonuc({ basarili: false }));
  s.iyilestir('supreme-auditor');
  assert.equal(s.metrikler.calistirma, 0);
  assert.equal(s.durum, 'saglikli');
});
