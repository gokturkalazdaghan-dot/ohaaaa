import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PROVIDER_CAPABILITIES,
  allCapabilities,
  requireCapability,
  type CapabilityMatrix,
} from './capabilities.js';
import { awinProvider } from './awin.js';
import { directProvider } from './direct.js';
import {
  getProvider,
  knownNetworks,
  networksWithCapability,
  supportsCapability,
} from './registry.js';
import { ProviderError, type AffiliateProvider } from './types.js';

/* =========================================================================
 * §49 — AĞ YETENEK SÖZLEŞMESİ
 * -------------------------------------------------------------------------
 * Kovalanan tehlike: BEYAN İLE KODUN AYRIŞMASI. Bir sağlayıcı bir yeteneği
 * "destekliyorum" diye işaretleyip metodu yazmamış olabilir; ya da metot
 * yazılmış ama beyan güncellenmemiş olabilir. İkisi de çalışma anında,
 * gerçek bir program keşfi ya da başvurusu sırasında patlardı.
 * ========================================================================= */

const KAYITLI = knownNetworks().map((n) => getProvider(n));

// --- 1) Her sağlayıcı HER yetenek için açık bir değer beyan ediyor -------
// Varsayılan olsaydı, yeni bir yetenek eklendiğinde tüm sağlayıcılar onu
// sessizce alırdı -- ve `supported` varsayılanı felaket olurdu.
test('her saglayici her yetenek icin acik deger beyan ediyor', () => {
  for (const provider of KAYITLI) {
    for (const capability of PROVIDER_CAPABILITIES) {
      const deger = provider.capabilities[capability];
      assert.ok(
        deger === 'supported' || deger === 'manual_required' || deger === 'unavailable',
        `${provider.network}/${capability} gecersiz: ${String(deger)}`,
      );
    }
  }
});

// --- 2) BEYAN İLE KOD TUTARLI ------------------------------------------
// Bu dosyanın asıl iddiası.
test('supported beyan edilen her yetenegin kodu VAR', () => {
  const metotlar: Partial<Record<string, keyof AffiliateProvider>> = {
    program_discovery: 'discoverPrograms',
    program_lookup: 'lookupProgram',
    application_submit: 'submitApplication',
    application_status: 'applicationStatus',
    program_metadata: 'programMetadata',
    feed_discovery: 'discoverFeeds',
  };

  for (const provider of KAYITLI) {
    for (const [capability, metot] of Object.entries(metotlar)) {
      if (provider.capabilities[capability as never] !== 'supported') continue;
      assert.equal(
        typeof provider[metot as keyof AffiliateProvider],
        'function',
        `${provider.network}: ${capability} supported ama ${String(metot)} yok`,
      );
    }
  }
});

// --- 3) requireCapability üç durumu AYRI kodlarla reddediyor ------------
// Tek bir "desteklenmiyor" hatası, "elle yapılır" kararı ile "bakmadık"
// boşluğunu aynı kefeye koyardı; ikisinin aksiyonu farklı.
test('manual_required -> manual_required hatasi', () => {
  const sahte = { network: 't', capabilities: allCapabilities('manual_required') };
  assert.throws(
    () => requireCapability(sahte, 'program_discovery', undefined),
    (e: ProviderError) => e.code === 'manual_required',
  );
});

test('unavailable -> capability_unavailable hatasi', () => {
  const sahte = { network: 't', capabilities: allCapabilities('unavailable') };
  assert.throws(
    () => requireCapability(sahte, 'program_discovery', undefined),
    (e: ProviderError) => e.code === 'capability_unavailable',
  );
});

test('supported ama kod yok -> capability_not_implemented', () => {
  const sahte = { network: 't', capabilities: allCapabilities('supported') };
  assert.throws(
    () => requireCapability(sahte, 'program_discovery', undefined),
    (e: ProviderError) => e.code === 'capability_not_implemented',
  );
});

test('supported ve kod var -> metot doner', () => {
  const sahte = { network: 't', capabilities: allCapabilities('supported') };
  const f = () => 42;
  assert.equal(requireCapability(sahte, 'program_discovery', f), f);
});

// --- 4) AWIN'İN GERÇEK DURUMU -------------------------------------------
// Awin'in postback sözleşmesi bu ortamdan doğrulanamadı. Bunu `supported`
// göstermek, ilk gerçek dönüşümde ya yanlış tutar kaydetmek ya da
// doğrulamayı anlamsız kılmak olurdu.
test('awin: deeplink supported, postback UNAVAILABLE', () => {
  assert.equal(awinProvider.capabilities.deeplink, 'supported');
  assert.equal(awinProvider.capabilities.transaction_postback, 'unavailable');
  assert.equal(awinProvider.capabilities.commission_normalization, 'unavailable');
});

test('awin: kesif/basvuru sozlesmesi dogrulanmadi -> unavailable', () => {
  for (const c of [
    'program_discovery',
    'program_lookup',
    'application_submit',
    'application_status',
    'program_metadata',
    'feed_discovery',
  ] as const) {
    assert.equal(awinProvider.capabilities[c], 'unavailable', c);
  }
});

// --- 5) DIRECT: "elle" bir KARAR, boşluk değil --------------------------
test('direct: kesif manual_required (unavailable DEGIL)', () => {
  assert.equal(directProvider.capabilities.program_discovery, 'manual_required');
  assert.equal(directProvider.capabilities.transaction_postback, 'supported');
});

// --- 6) Registry sorgulari ----------------------------------------------
test('networksWithCapability yalnizca supported olanlari veriyor', () => {
  assert.deepEqual(networksWithCapability('deeplink'), ['awin', 'direct']);
  assert.deepEqual(networksWithCapability('program_discovery'), []);
  assert.deepEqual(networksWithCapability('transaction_postback'), ['direct']);
});

test('supportsCapability awin postback icin false', () => {
  assert.equal(supportsCapability('awin', 'transaction_postback'), false);
  assert.equal(supportsCapability('awin', 'deeplink'), true);
});

// --- 7) Bilinmeyen ag hala fail-closed ----------------------------------
test('bilinmeyen ag yetenek sorgusunda da varsayilana DUSMUYOR', () => {
  assert.throws(
    () => supportsCapability('cj', 'deeplink'),
    (e: ProviderError) => e.code === 'unknown_network',
  );
});
