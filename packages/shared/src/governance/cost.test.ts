import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MaliyetYoneticisi, basamakSirasi, modelBasamagi } from './cost.js';
import type { ModelTalebi } from './cost.js';

function yonetici(pencere = 10_000, gorev = 500) {
  return new MaliyetYoneticisi({ gorevTavaniKurus: gorev, pencereTavaniKurus: pencere });
}

/** Büyük modele kadar tüm ucuz basamakları gerekçeli olarak denemiş talep. */
function tamTalep(over: Partial<ModelTalebi> = {}): ModelTalebi {
  return {
    agentId: 'test',
    hedefBasamak: 'buyuk_model',
    denenenler: [
      { basamak: 'deterministik', neden: 'kural yok' },
      { basamak: 'sorgu', neden: 'sonuc bos' },
      { basamak: 'onbellek', neden: 'anahtar yok' },
      { basamak: 'mevcut_veri', neden: 'alan doldurulmamis' },
      { basamak: 'kucuk_model', neden: 'guven 0.3' },
    ],
    tahminiKurus: 100,
    ...over,
  };
}

test('basamaklar ucuzdan pahaliya siralanir', () => {
  assert.ok(basamakSirasi('deterministik') < basamakSirasi('sorgu'));
  assert.ok(basamakSirasi('kucuk_model') < basamakSirasi('buyuk_model'));
  assert.equal(modelBasamagi('sorgu'), false);
  assert.equal(modelBasamagi('kucuk_model'), true);
});

test('model gerektirmeyen basamak butce kapisinda beklemez', () => {
  const k = yonetici().degerlendir({
    agentId: 'x', hedefBasamak: 'sorgu', denenenler: [], tahminiKurus: 0,
  });
  assert.equal(k.izin, true);
});

test('ucuz basamak atlanirsa model REDDEDILIR', () => {
  const k = yonetici().degerlendir(
    tamTalep({ denenenler: [{ basamak: 'deterministik', neden: 'kural yok' }] }),
  );
  assert.equal(k.izin, false);
  if (!k.izin) assert.equal(k.kod, 'ucuz_basamak_atlandi');
});

test('gerekcesiz deneme kaydi kapiyi GECMEZ', () => {
  /* Kutu doldurmak yetmiyor: neden yetmediği yazılmalı. */
  const eksik = tamTalep().denenenler.map((d) =>
    d.basamak === 'onbellek' ? { ...d, neden: '  ' } : d,
  );
  const k = yonetici().degerlendir(tamTalep({ denenenler: eksik }));
  assert.equal(k.izin, false);
  if (!k.izin) assert.equal(k.kod, 'gerekce_yok');
});

test('tum basamaklar gerekceli denenmisse izin verilir', () => {
  const k = yonetici().degerlendir(tamTalep());
  assert.equal(k.izin, true);
});

test('gorev tavanini asan tek cagri reddedilir', () => {
  const k = yonetici(10_000, 50).degerlendir(tamTalep({ tahminiKurus: 100 }));
  assert.equal(k.izin, false);
  if (!k.izin) assert.equal(k.kod, 'gorev_tavani');
});

test('pencere tavani dolunca reddedilir', () => {
  const y = yonetici(150, 500);
  y.harca(100);
  const k = y.degerlendir(tamTalep({ tahminiKurus: 100 }));
  assert.equal(k.izin, false);
  if (!k.izin) assert.equal(k.kod, 'pencere_tavani');
});

test('harcama GERCEKLESEN uzerinden islenir, tahmin uzerinden degil', () => {
  const y = yonetici();
  y.degerlendir(tamTalep({ tahminiKurus: 10 }));
  y.harca(400); // tahmin 10'du, gerçek 400
  assert.equal(y.harcananKurus, 400);
  assert.equal(y.kalanKurus, 9600);
});

test('negatif harcama reddedilir', () => {
  assert.throws(() => yonetici().harca(-1), /negatif/);
});

test('asildi bayragi kill switch icin sinyal uretir', () => {
  const y = yonetici(100);
  assert.equal(y.asildi, false);
  y.harca(101);
  assert.equal(y.asildi, true);
});

test('kucuk model icin yalnizca ondan ucuz basamaklar aranir', () => {
  const k = yonetici().degerlendir(tamTalep({
    hedefBasamak: 'kucuk_model',
    denenenler: [
      { basamak: 'deterministik', neden: 'kural yok' },
      { basamak: 'sorgu', neden: 'bos' },
      { basamak: 'onbellek', neden: 'yok' },
      { basamak: 'mevcut_veri', neden: 'eksik' },
    ],
  }));
  assert.equal(k.izin, true);
});
