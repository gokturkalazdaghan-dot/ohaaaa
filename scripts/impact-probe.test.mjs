import assert from 'node:assert/strict';
import { test } from 'node:test';

import { basicAuth, campaignsUrl, summarize } from './impact-probe.mjs';

test('Basic kimlik SID:Token biçiminde', () => {
  assert.equal(basicAuth('IRabc', 'tok'), 'Basic ' + Buffer.from('IRabc:tok').toString('base64'));
});

test('adres SID ile kurulur', () => {
  assert.equal(
    campaignsUrl('IRabc'),
    'https://api.impact.com/Mediapartners/IRabc/Campaigns?PageSize=100',
  );
});

test('401 yetki reddi olarak raporlanır', () => {
  const s = summarize(401, null);
  assert.equal(s.ok, false);
  assert.equal(s.status, 401);
});

test('200 cevabında yalnızca sayılar döner, isimler sızmaz', () => {
  const s = summarize(200, {
    '@total': '3',
    Campaigns: [{ CampaignName: 'Gizli Marka' }, { CampaignName: 'Diğer' }],
  });
  assert.deepEqual(s, { ok: true, status: 200, campaigns_total: 3, campaigns_on_page: 2 });
  assert.ok(!JSON.stringify(s).includes('Gizli'));
});

test('JSON olmayan 200 beklenmeyen cevaptır', () => {
  assert.equal(summarize(200, null).ok, false);
});
