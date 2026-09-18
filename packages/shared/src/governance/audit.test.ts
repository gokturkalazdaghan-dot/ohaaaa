import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BellekteDenetimDeposu, hassasIceriyor, izKontrol, zincirTam } from './audit.js';
import type { DenetimKaydi } from './audit.js';

const T = 1_700_000_000_000;

function kayit(over: Partial<DenetimKaydi> = {}): DenetimKaydi {
  return {
    taskId: 'g1', agentId: 'query-performance', at: T,
    araclar: ['read_db'], eylem: 'plan okundu',
    girdiOzeti: 'sha256:abc', ciktiOzeti: 'Sort dugumu 2762 ms',
    guven: 0.9,
    kanitlar: [{ kaynak: 'EXPLAIN ANALYZE', gozlem: '541 satir, 484 buffer', at: T }],
    dogrulayan: 'database-health', denetleyen: 'supreme-auditor', onaylayan: null,
    durum: 'denetlendi',
    ...over,
  };
}

test('temiz kayit yazilir', async () => {
  const d = new BellekteDenetimDeposu();
  await d.yaz(kayit());
  assert.equal((await d.gorevIzi('g1')).length, 1);
});

test('gorev kimligi olmayan kayit reddedilir', () => {
  assert.deepEqual(izKontrol(kayit({ taskId: ' ' })), ['gorev_kimligi_yok']);
});

test('hassas alan adi tespit edilir', () => {
  assert.equal(hassasIceriyor('kullanici eposta adresi'), true);
  assert.equal(hassasIceriyor('Authorization: Bearer ...'), true);
  assert.equal(hassasIceriyor('Sort dugumu 2762 ms'), false);
});

test('hassas veri iceren kayit YAZILMAZ', async () => {
  const d = new BellekteDenetimDeposu();
  await assert.rejects(
    d.yaz(kayit({ ciktiOzeti: 'api_key=sbp_123' })),
    /hassas_veri/,
  );
  assert.equal(d.tumu.length, 0);
});

test('kanit hassas veri tasiyorsa da reddedilir', () => {
  const k = kayit({ kanitlar: [{ kaynak: 'cookie store', gozlem: 'x', at: T }] });
  assert.ok(izKontrol(k).includes('hassas_veri'));
});

test('uygulanmis karar kanitsiz olamaz', () => {
  assert.ok(izKontrol(kayit({ durum: 'uygulandi', kanitlar: [] })).includes('kanit_yok'));
});

test('henuz dogrulanmamis adimda kanit eksikligi normal', () => {
  assert.deepEqual(izKontrol(kayit({ durum: 'yurutuldu', kanitlar: [] })), []);
});

test('yazilan kayit DEGISTIRILEMEZ', async () => {
  const d = new BellekteDenetimDeposu();
  await d.yaz(kayit());
  const okunan = (await d.gorevIzi('g1'))[0]!;
  assert.throws(() => { (okunan as { eylem: string }).eylem = 'degistirildi'; });
});

test('zincir tam: uygulanan adimin dogrulayani ve denetleyeni var', () => {
  assert.equal(zincirTam([kayit({ durum: 'uygulandi' })]), true);
});

test('dogrulayansiz uygulama zinciri KIRIK sayilir', () => {
  assert.equal(zincirTam([kayit({ durum: 'uygulandi', dogrulayan: null })]), false);
});

test('ajan kendi dogrulayicisiysa zincir KIRIK', () => {
  const k = kayit({ durum: 'uygulandi', dogrulayan: 'query-performance' });
  assert.equal(zincirTam([k]), false);
});

test('hic uygulanmamis gorevde zincir sorgusu gecer', () => {
  assert.equal(zincirTam([kayit({ durum: 'onay_bekliyor' })]), true);
});
