import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ISTEK_OMRU_MS, OnayKuyrugu, eksikler, muafiyetVerilemez, onayGerekiyorMu, sunulabilir,
} from './approval.js';
import type { OnayIstegi } from './approval.js';

const T = 1_700_000_000_000;

function istek(over: Partial<OnayIstegi> = {}): OnayIstegi {
  return {
    id: 'i1',
    konu: 'sema_degisikligi',
    agentId: 'schema-change-planner',
    ozet: 'product_groups uzerine listeleme indeksi',
    islem: 'CREATE INDEX CONCURRENTLY ...',
    kanitlar: [{ kaynak: 'EXPLAIN', gozlem: 'Sort dugumu 2762 ms', at: T }],
    geriAlma: 'DROP INDEX CONCURRENTLY ...',
    dogrulandi: true,
    denetlendi: true,
    olusturuldu: T,
    ...over,
  };
}

test('tam paketli istek sunulabilir', () => {
  assert.deepEqual(eksikler(istek()), []);
  assert.equal(sunulabilir(istek()), true);
});

test('geri alma plani olmayan istek sunulamaz', () => {
  assert.deepEqual(eksikler(istek({ geriAlma: '  ' })), ['geri_alma_yok']);
});

test('kanitsiz istek sunulamaz', () => {
  assert.deepEqual(eksikler(istek({ kanitlar: [] })), ['kanit_yok']);
});

test('dogrulanmamis ya da denetlenmemis istek insana GITMEZ', () => {
  assert.deepEqual(eksikler(istek({ dogrulandi: false })), ['dogrulanmadi']);
  assert.deepEqual(eksikler(istek({ denetlendi: false })), ['denetlenmedi']);
});

test('eksik istek kuyruga alinmaz', () => {
  const q = new OnayKuyrugu();
  assert.throws(() => q.sun(istek({ ozet: '' })), /Onay isteği eksik: ozet_yok/);
  assert.equal(q.bekleyenler.length, 0);
});

test('ayni kimlikle iki istek kabul edilmez', () => {
  const q = new OnayKuyrugu();
  q.sun(istek());
  assert.throws(() => q.sun(istek()), /kimliği zaten var/);
});

test('konu varsa onay her kosulda gerekir', () => {
  assert.equal(onayGerekiyorMu('uretim_dagitimi', ['read_catalog']), true);
});

test('konu yoksa yetki sinifi arac onay tetikler', () => {
  assert.equal(onayGerekiyorMu(null, ['read_catalog', 'write_catalog']), false);
  assert.equal(onayGerekiyorMu(null, ['write_repo']), true);
  assert.equal(onayGerekiyorMu(null, ['read_revenue']), true);
});

test('yikici islem ve secret degisikligi muafiyet KABUL ETMEZ', () => {
  assert.equal(muafiyetVerilemez('yikici_islem'), true);
  assert.equal(muafiyetVerilemez('secret_veya_faturalama'), true);
  assert.equal(muafiyetVerilemez('sema_degisikligi'), false);
});

test('onaylanmadan uygulanamaz', () => {
  const q = new OnayKuyrugu();
  q.sun(istek());
  assert.equal(q.durum('i1', T), 'bekliyor');
  assert.equal(q.uygulanabilir('i1', T), false);

  q.karar('i1', 'onaylandi', 'cto', 'olculdu', T);
  assert.equal(q.uygulanabilir('i1', T), true);
});

test('reddedilen istek uygulanamaz', () => {
  const q = new OnayKuyrugu();
  q.sun(istek());
  q.karar('i1', 'reddedildi', 'cto', 'risk yuksek', T);
  assert.equal(q.uygulanabilir('i1', T), false);
});

test('karar veren kimlik zorunlu', () => {
  const q = new OnayKuyrugu();
  q.sun(istek());
  assert.throws(() => q.karar('i1', 'onaylandi', '   '), /Karar veren kimlik zorunlu/);
});

test('suresi dolan istek onaylanamaz -- kaniti artik taze degil', () => {
  const q = new OnayKuyrugu();
  q.sun(istek());
  const sonra = T + ISTEK_OMRU_MS + 1;
  assert.equal(q.durum('i1', sonra), 'suresi_doldu');
  assert.throws(() => q.karar('i1', 'onaylandi', 'cto', '', sonra), /süresi doldu/);
  assert.equal(q.uygulanabilir('i1', sonra), false);
});

test('bilinmeyen kimlik uygulanabilir SAYILMAZ', () => {
  const q = new OnayKuyrugu();
  assert.equal(q.uygulanabilir('yok', T), false);
});
