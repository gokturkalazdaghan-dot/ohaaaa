import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  SUPABASE_SERVICE_KEY_ENV_NAMES,
  SUPABASE_URL_ENV_NAMES,
  readEnvValue,
  resolveEnvName,
} from './envNames.js';

const SAHTE = 'sahte-deger-DEPODA-GERCEK-SIR-YOK';

/*
 * AYNI SIR, FARKLI ADLAR.
 *
 * Iki kez olculdu: Awin kimligi panoda `AWIN_OAUTH2` ortamda `awin_OAuth2`;
 * Supabase servis rolu kodda `SUPABASE_SERVICE_ROLE_KEY`, hesap sahibinin
 * ekledigi ad `my_supabase_role_key`. Tek ada kilitlenen okuyucu, sir ortamda
 * DURURKEN "tanimli degil" der -- ve o hata sirrin hic eklenmemis olmasiyla
 * ayni gorunur.
 */
test('servis rolu anahtari her iki OLCULEN adla da bulunuyor', () => {
  for (const ad of SUPABASE_SERVICE_KEY_ENV_NAMES) {
    assert.equal(resolveEnvName(SUPABASE_SERVICE_KEY_ENV_NAMES, { [ad]: SAHTE }), ad);
    assert.equal(readEnvValue(SUPABASE_SERVICE_KEY_ENV_NAMES, { [ad]: SAHTE }), SAHTE);
  }
  assert.equal(resolveEnvName(SUPABASE_SERVICE_KEY_ENV_NAMES, {}), null);
  assert.equal(readEnvValue(SUPABASE_SERVICE_KEY_ENV_NAMES, {}), null);
});

/* SIRA ONEMLI: kodun kendi sozlesmesi olan ad ONCE gelir; boylece ikisi de
 * tanimliysa kanonik olan kazanir ve davranis ongorulebilir kalir. */
test('kanonik ad once deneniyor', () => {
  const ad = resolveEnvName(SUPABASE_SERVICE_KEY_ENV_NAMES, {
    SUPABASE_SERVICE_ROLE_KEY: 'kanonik',
    my_supabase_role_key: 'digeri',
  });
  assert.equal(ad, 'SUPABASE_SERVICE_ROLE_KEY');
  assert.equal(SUPABASE_SERVICE_KEY_ENV_NAMES[0], 'SUPABASE_SERVICE_ROLE_KEY');
});

/* Bos/bosluk deger "var" sayilmaz: bos bir anahtarla devam etmek, ilk gercek
 * cagrida 401 yemek ve sebebi "Supabase reddetti" sanmak demekti. */
test('bosluktan ibaret deger yok sayiliyor', () => {
  assert.equal(resolveEnvName(SUPABASE_SERVICE_KEY_ENV_NAMES, { SUPABASE_SERVICE_ROLE_KEY: '   ' }), null);
  assert.equal(resolveEnvName(SUPABASE_URL_ENV_NAMES, { SUPABASE_URL: '' }), null);
});

/* Liste OLCUME bagli kalir; tahminle ad eklenirse hangi adin gercekten
 * gozlemlendigi kaybolur. */
test('aranan adlar yalnizca olculen/sozlesme adlari', () => {
  assert.deepEqual([...SUPABASE_SERVICE_KEY_ENV_NAMES],
    ['SUPABASE_SERVICE_ROLE_KEY', 'my_supabase_role_key']);
  assert.deepEqual([...SUPABASE_URL_ENV_NAMES],
    ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']);
});
