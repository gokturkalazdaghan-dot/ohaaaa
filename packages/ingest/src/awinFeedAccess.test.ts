import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  AWIN_DATAFEED_API_KEY_ENV,
  AWIN_OAUTH2_ENV,
  hasAwinOAuth2Credential,
  requireAwinOAuth2Credential,
  safeAwinError,
} from './awinFeedAccess.js';
import { clearSecretsForTest, redact } from './http/redact.js';

const SAHTE = 'sahte-kimlik-bilgisi-DEPODA-GERCEK-DEGER-YOK';

/* Deger DONDURULMEDEN "cekebilir miyiz" sorusu cevaplanabilmeli: cagiranlarin
 * cogunun bilmek istedigi budur ve siri eline almalari gerekmez. */
test('varlik kontrolu degeri aciga cikarmadan cevapliyor', () => {
  assert.equal(hasAwinOAuth2Credential({}), false);
  assert.equal(hasAwinOAuth2Credential({ [AWIN_OAUTH2_ENV]: '   ' }), false, 'bosluk = yok');
  assert.equal(hasAwinOAuth2Credential({ [AWIN_OAUTH2_ENV]: SAHTE }), true);
});

/* FAIL-CLOSED: bos dizeyle devam edip 401 yemek, 401 govdesini (icinde adres,
 * adreste kimlik bilgisi) log'a dusurmek olurdu. */
test('kimlik bilgisi yoksa duruyor ve dogru degisken adini soyluyor', () => {
  assert.throws(
    () => requireAwinOAuth2Credential({}),
    (e: unknown) => e instanceof Error && e.message.includes(AWIN_OAUTH2_ENV),
  );
});

/*
 * OKUNAN DEGER MASKELEME DEFTERINE GIRIYOR.
 *
 * `redactAwinKey` KALIP tabanli: yalnizca tanidigi adres bicimlerini temizler.
 * Defter DEGER tabanli: kimlik bilgisi hangi bicimde sizarsa sizsin yakalar.
 * Ikisi birbirinin yedegi ve `safeAwinError` ikisini birden uygular.
 */
test('okunan kimlik bilgisi maskeleniyor', () => {
  clearSecretsForTest();
  requireAwinOAuth2Credential({ [AWIN_OAUTH2_ENV]: SAHTE });

  const temiz = redact(`istek reddedildi, gonderilen: ${SAHTE}`);
  assert.ok(!temiz.includes(SAHTE), 'deger maskelenmemis');

  const hata = safeAwinError(new Error(`401, kimlik: ${SAHTE}`));
  assert.ok(!hata.includes(SAHTE), 'hata metninde deger kalmis');
  clearSecretsForTest();
});

/*
 * IKI AYRI KIMLIK YUZEYI, IKI AYRI DEGISKEN.
 *
 * `AWIN_OAUTH2` hesabin sahip oldugu OAuth2 kimlik bilgisi; Create-a-Feed
 * indirme adresindeki `apikey` ise AYRI bir yuzey. Ikisini tek degiskene
 * cokertmek, dogrulanmamis bir kimlik bilgisini feed adresine gomup ilk
 * gercek cagrida sessizce 401 almak olurdu.
 *
 * Bu iddia o ayrimi SABITLIYOR: biri digerinin yerine gecerse burasi duser.
 */
test('OAuth2 kimligi ile datafeed anahtari ayri degiskenler', () => {
  assert.equal(AWIN_OAUTH2_ENV, 'AWIN_OAUTH2');
  assert.notEqual(AWIN_OAUTH2_ENV, AWIN_DATAFEED_API_KEY_ENV);
});
