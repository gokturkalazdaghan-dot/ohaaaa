/**
 * Kimlik doğrulama başlığı testleri.
 *
 * BU TESTLERDE GERÇEK KİMLİK BİLGİSİ YOKTUR. Kullanılan değerler uydurma
 * dizgilerdir; testlerin iddiası ya "başlık doğru üretildi" ya da
 * "bu dizgi çıktıda görünmüyor".
 */

import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';

import { buildAuthHeaders, isAuthType } from './auth.js';
import { IngestError } from './errors.js';
import { clearSecretsForTest, redact } from './http/redact.js';

const SAHTE_JETON = 'tk_ornek_9f4c2b7e51a08d63';

afterEach(() => {
  clearSecretsForTest();
});

// --- query: mevcut davranış korunur ---------------------------------------

/*
 * `query` yönteminde başlık YOKTUR: kimlik bilgisi adres şablonunda
 * taşınır. Bu testin asıl işi, yeni yöntemlerin mevcut kaynakları
 * bozmadığını kilitlemek.
 */
test('query yöntemi başlık üretmez', () => {
  assert.deepEqual(buildAuthHeaders({ authType: 'query' }, {}), {});
  // Yöntem belirtilmemişse varsayılan da query.
  assert.deepEqual(buildAuthHeaders({}, {}), {});
});

// --- bearer ---------------------------------------------------------------

test('bearer başlığı ortamdaki değerden üretilir', () => {
  const h = buildAuthHeaders(
    { authType: 'bearer', authSecretRef: 'OHAAAA_TEST_AUTH' },
    { OHAAAA_TEST_AUTH: SAHTE_JETON },
  );
  assert.equal(h.authorization, `Bearer ${SAHTE_JETON}`);
});

/*
 * Üretilen jeton ANINDA maskeleme defterine yazılmalı. Yazılmasaydı, bir
 * hata metnine düşen başlık değeri veritabanına ve CI günlüğüne olduğu gibi
 * girerdi -- adres şablonunda kapatılan sızıntının başlık üzerinden geri
 * açılması demekti.
 */
test('bearer jetonu maskeleme defterine yazılır', () => {
  buildAuthHeaders(
    { authType: 'bearer', authSecretRef: 'OHAAAA_TEST_AUTH' },
    { OHAAAA_TEST_AUTH: SAHTE_JETON },
  );
  const cikti = redact(`istek reddedildi: Authorization: Bearer ${SAHTE_JETON}`);
  assert.ok(!cikti.includes(SAHTE_JETON), cikti);
});

// --- basic ----------------------------------------------------------------

test('basic başlığı kullanici:parola değerini base64 kodlar', () => {
  const h = buildAuthHeaders(
    { authType: 'basic', authSecretRef: 'OHAAAA_TEST_AUTH' },
    { OHAAAA_TEST_AUTH: `yayinci:${SAHTE_JETON}` },
  );
  const beklenen = Buffer.from(`yayinci:${SAHTE_JETON}`, 'utf8').toString('base64');
  assert.equal(h.authorization, `Basic ${beklenen}`);
});

/*
 * HEM HAM HEM KODLANMIŞ BİÇİM MASKELENMELİ.
 *
 * Yalnızca ham değeri deftere yazmak, başlığa giren base64 biçiminin
 * maskelenmeden kalması demekti -- ve başlığa giren biçim tam olarak
 * loglara düşme ihtimali olan biçimdir.
 */
test('basic kimliğinin base64 biçimi de maskelenir', () => {
  const ham = `yayinci:${SAHTE_JETON}`;
  buildAuthHeaders(
    { authType: 'basic', authSecretRef: 'OHAAAA_TEST_AUTH' },
    { OHAAAA_TEST_AUTH: ham },
  );
  const kodlanmis = Buffer.from(ham, 'utf8').toString('base64');

  const cikti = redact(`401 — Authorization: Basic ${kodlanmis}`);
  assert.ok(!cikti.includes(kodlanmis), `kodlanmis kimlik sizdi: ${cikti}`);
  assert.ok(!cikti.includes(SAHTE_JETON), cikti);
});

test('basic için iki nokta yoksa açık yapılandırma hatası', () => {
  assert.throws(
    () =>
      buildAuthHeaders(
        { authType: 'basic', authSecretRef: 'OHAAAA_TEST_AUTH' },
        { OHAAAA_TEST_AUTH: 'yalnizca-parola' },
      ),
    (e: IngestError) => {
      assert.equal(e.errorClass, 'CONFIG_ERROR');
      assert.equal(e.permanent, true);
      return true;
    },
  );
});

// --- Eksik yapılandırma ---------------------------------------------------

/*
 * KİMLİKSİZ İSTEK GÖNDERİLMEZ.
 *
 * Eksik yapılandırmada sessizce başlıksız devam etmek, sağlayıcıdan 401
 * almak ve sebebi "sağlayıcı reddetti" sanmak olurdu. Hata KALICI: değişken
 * eklenmeden hiçbir deneme geçemez.
 */
test('auth_secret_ref boşsa kalıcı yapılandırma hatası', () => {
  assert.throws(
    () => buildAuthHeaders({ authType: 'bearer', authSecretRef: null }, {}),
    (e: IngestError) => {
      assert.equal(e.errorClass, 'CONFIG_ERROR');
      assert.equal(e.permanent, true);
      return true;
    },
  );
});

test('değişken ortamda yoksa hata DEĞİŞKEN ADINI söyler, değerini değil', () => {
  assert.throws(
    () => buildAuthHeaders({ authType: 'bearer', authSecretRef: 'OHAAAA_TEST_AUTH' }, {}),
    (e: IngestError) => {
      assert.ok(e.message.includes('OHAAAA_TEST_AUTH'), e.message);
      assert.equal(e.errorClass, 'CONFIG_ERROR');
      return true;
    },
  );
});

// --- Tip koruması ---------------------------------------------------------

test('isAuthType yalnızca bilinen yöntemleri kabul eder', () => {
  assert.ok(isAuthType('query'));
  assert.ok(isAuthType('bearer'));
  assert.ok(isAuthType('basic'));
  assert.ok(!isAuthType('oauth2'));
  assert.ok(!isAuthType(null));
  assert.ok(!isAuthType(42));
});
