import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aracRiski, enYuksekRisk, guvenliModdaIzinli, onayGerektirir } from './tools.js';

test('okuma araclari yan etkisiz sinifta', () => {
  for (const t of ['read_catalog', 'read_analytics', 'read_db', 'run_check'] as const) {
    assert.equal(aracRiski(t), 'okuma', t);
  }
});

test('gelir ve kullanici verisi OKUMA olmasina ragmen yetki sinifinda', () => {
  /* Sızdırılması geri alınamaz; "okuma zararsızdır" varsayımı tam olarak
     burada kırılıyor. */
  assert.equal(aracRiski('read_revenue'), 'yetki');
  assert.equal(aracRiski('read_user_scoped'), 'yetki');
});

test('kod yazma ve sema onerisi yetki sinifinda', () => {
  assert.equal(aracRiski('write_repo'), 'yetki');
  assert.equal(aracRiski('propose_ddl'), 'yetki');
});

test('call_model yazma sinifinda -- para harciyor', () => {
  assert.equal(aracRiski('call_model'), 'yazma');
});

test('en yuksek risk, en tehlikeli araca gore belirlenir', () => {
  assert.equal(enYuksekRisk(['read_catalog', 'read_analytics']), 'okuma');
  assert.equal(enYuksekRisk(['read_catalog', 'write_price']), 'yazma');
  assert.equal(enYuksekRisk(['read_catalog', 'write_price', 'propose_ddl']), 'yetki');
});

test('bos arac listesi okuma sayilir', () => {
  assert.equal(enYuksekRisk([]), 'okuma');
});

test('yetki sinifi arac tasiyan ajan onay gerektirir', () => {
  assert.equal(onayGerektirir(['read_catalog']), false);
  assert.equal(onayGerektirir(['write_catalog']), false);
  assert.equal(onayGerektirir(['write_repo']), true);
});

test('guvenli modda yalnizca okuma serbest', () => {
  assert.equal(guvenliModdaIzinli('read_db'), true);
  assert.equal(guvenliModdaIzinli('http_fetch'), true);
  assert.equal(guvenliModdaIzinli('write_catalog'), false);
  assert.equal(guvenliModdaIzinli('call_model'), false);
  /* Teşhis ajanları körleşmemeli: olay sırasında okuma açık kalır. */
  assert.equal(guvenliModdaIzinli('read_ops'), true);
});
