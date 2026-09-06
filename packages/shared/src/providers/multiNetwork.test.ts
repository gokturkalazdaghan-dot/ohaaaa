import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CapabilityEvidenceError,
  PROVIDER_CAPABILITIES,
  ProviderError,
  UNVERIFIED_NETWORKS,
  callCapability,
  createUnverifiedProvider,
  getProvider,
  knownNetworks,
  matrixFromEvidence,
  networksWithCapability,
  supportsCapability,
  unverifiedEvidence,
  type CapabilityEvidenceMap,
} from './index.js';

/* =========================================================================
 * AŞAMA 7 — ÇOK AĞLI SAĞLAYICI MOTORU
 * -------------------------------------------------------------------------
 * Kovalanan tehlike: bir hatıraya dayanan `supported` beyanı. Var olmayan
 * bir uç noktaya gerçek istek göndermek demektir ve ağ tarafında bu, en
 * iyi ihtimalle 404, en kötüsünde kötüye kullanım sayılır.
 * ========================================================================= */

const ONBIR = 2 + UNVERIFIED_NETWORKS.length; // direct + awin + doğrulanmamışlar

test('1) on bir ağ kayıtlı; hepsi getProvider ile çözülüyor', () => {
  const aglar = knownNetworks();
  assert.equal(aglar.length, ONBIR);

  for (const ag of aglar) {
    assert.equal(getProvider(ag).network, ag);
  }

  // Mevcut iki yol bozulmadı.
  assert.ok(aglar.includes('direct'));
  assert.ok(aglar.includes('awin'));
});

test('2) BİLİNMEYEN AĞ hâlâ varsayılana DÜŞMÜYOR', () => {
  for (const yok of ['bilinmeyen', '', null, undefined]) {
    assert.throws(
      () => getProvider(yok),
      (e: unknown) => e instanceof ProviderError && e.code === 'unknown_network',
    );
  }
});

test('3) doğrulanmamış ağların HİÇBİR yeteneği supported değil', () => {
  for (const { network } of UNVERIFIED_NETWORKS) {
    const p = getProvider(network);
    for (const c of PROVIDER_CAPABILITIES) {
      assert.equal(
        p.capabilities[c],
        'unavailable',
        `${network}/${c}: sözleşme doğrulanmadı, supported olamaz`,
      );
    }
  }
});

test('4) unavailable ile manual_required KARIŞTIRILMIYOR', () => {
  // "Bakamadık" bir BOŞLUK, "elle yapılır" bir KARAR. İkincisini yazmak,
  // o ağa bir daha hiç bakılmaması demek.
  for (const { network } of UNVERIFIED_NETWORKS) {
    const p = getProvider(network);
    assert.ok(
      !Object.values(p.capabilities).includes('manual_required'),
      `${network}: doğrulanmamış ağ manual_required taşımamalı`,
    );
  }

  // direct GERÇEKTEN elle yapılır: karar verilmiş.
  assert.equal(getProvider('direct').capabilities.program_discovery, 'manual_required');
});

test('5) her yetenek çağrısı KAPALI BAŞARISIZ, ağa istek GİTMİYOR', () => {
  for (const { network } of UNVERIFIED_NETWORKS) {
    for (const c of PROVIDER_CAPABILITIES) {
      assert.throws(
        () => callCapability(network, c, (p) => (p as unknown as Record<string, unknown>)[c]),
        (e: unknown) => e instanceof ProviderError && e.code === 'capability_unavailable',
        `${network}/${c}`,
      );
    }
  }
});

test('6) postback FALSE dönmüyor, FIRLATIYOR', () => {
  // `false` "imza yanlış" demektir ve çağıran bunu saldırı sayar. Bilmediğimiz
  // bir şemayı "yanlış imza" gibi göstermek, doğrulama yapıyormuş gibi
  // görünüp hiçbir şey doğrulamamaktır.
  for (const { network } of UNVERIFIED_NETWORKS) {
    const p = getProvider(network);
    assert.throws(
      () => p.verifyPostback({ rawBody: '{}', headers: { get: () => null }, secret: 'x' }),
      (e: unknown) => e instanceof ProviderError && e.code === 'verification_unavailable',
    );
    assert.throws(
      () => p.normalizePostback({}),
      (e: unknown) => e instanceof ProviderError && e.code === 'verification_unavailable',
    );
  }
});

test('7) doğrulanmamış ağlarda HİÇBİR yetenek metodu TANIMLI DEĞİL', () => {
  // Tanımlı olsaydı sözleşme varmış izlenimi verir ve biri beyanı
  // supported'a çevirdiğinde uydurma kod canlıya çıkardı.
  for (const { network } of UNVERIFIED_NETWORKS) {
    const p = getProvider(network) as unknown as Record<string, unknown>;
    for (const metot of [
      'discoverPrograms', 'lookupProgram', 'submitApplication',
      'applicationStatus', 'programMetadata', 'discoverFeeds', 'buildDeeplink',
    ]) {
      assert.equal(p[metot], undefined, `${network}.${metot} tanımlı olmamalı`);
    }
  }
});

// =========================================================================
// KANIT KURALI
// =========================================================================
test('8) KANITSIZ "supported" modül seviyesinde REDDEDİLİYOR', () => {
  const kanit = unverifiedEvidence('test') as CapabilityEvidenceMap;
  kanit.deeplink = { support: 'supported', source: null, verifiedAt: null, note: 'hatıradan' };

  assert.throws(
    () => matrixFromEvidence('test-ag', kanit),
    (e: unknown) => e instanceof CapabilityEvidenceError && /kanitsiz/.test(e.message),
  );
});

test('9) kanıt https ve tarihli olmalı', () => {
  const temel = () => unverifiedEvidence('test') as CapabilityEvidenceMap;

  const httpOlan = temel();
  httpOlan.deeplink = {
    support: 'supported', source: 'http://ornek.example/docs',
    verifiedAt: '2026-09-07T00:00:00Z', note: 'x',
  };
  assert.throws(() => matrixFromEvidence('t', httpOlan), CapabilityEvidenceError);

  const tarihsiz = temel();
  tarihsiz.deeplink = {
    support: 'supported', source: 'https://ornek.example/docs',
    verifiedAt: null, note: 'x',
  };
  assert.throws(() => matrixFromEvidence('t', tarihsiz), CapabilityEvidenceError);

  const gecerli = temel();
  gecerli.deeplink = {
    support: 'supported', source: 'https://ornek.example/docs',
    verifiedAt: '2026-09-07T00:00:00Z', note: 'x',
  };
  assert.equal(matrixFromEvidence('t', gecerli).deeplink, 'supported');
});

test('10) GEREKÇE her durum için zorunlu', () => {
  const kanit = unverifiedEvidence('test') as CapabilityEvidenceMap;
  kanit.feed_discovery = { support: 'unavailable', source: null, verifiedAt: null, note: '  ' };

  assert.throws(
    () => matrixFromEvidence('t', kanit),
    (e: unknown) => e instanceof CapabilityEvidenceError && /gerekce/.test(e.message),
  );
});

test('11) matris kanıttan TÜRETİLİYOR — ayrışma imkânsız', () => {
  const kanit = unverifiedEvidence('sebep') as CapabilityEvidenceMap;
  const matris = matrixFromEvidence('t', kanit);

  for (const c of PROVIDER_CAPABILITIES) {
    assert.equal(matris[c], kanit[c].support);
  }
});

test('12) eksik kanıt kaydı sessizce geçmiyor', () => {
  const eksik = unverifiedEvidence('x') as Record<string, unknown>;
  delete eksik.deeplink;

  assert.throws(
    () => matrixFromEvidence('t', eksik as CapabilityEvidenceMap),
    CapabilityEvidenceError,
  );
});

// =========================================================================
// MEVCUT AKIŞ BOZULMADI
// =========================================================================
test('13) AWIN deeplink hâlâ supported — çalışan gelir yolu korundu', () => {
  assert.equal(supportsCapability('awin', 'deeplink'), true);
  assert.deepEqual(networksWithCapability('deeplink').sort(), ['awin', 'direct']);
});

test('14) direct postback ve komisyon hâlâ supported', () => {
  assert.equal(supportsCapability('direct', 'transaction_postback'), true);
  assert.equal(supportsCapability('direct', 'commission_normalization'), true);
});

test('15) hiçbir ağ discovery/application/feed desteklemiyor — sahte otomasyon yok', () => {
  for (const c of ['program_discovery', 'application_submit', 'feed_discovery'] as const) {
    assert.deepEqual(networksWithCapability(c), [], `${c}: doğrulanmış sözleşme yok`);
  }
});

test('16) yeni ağ eklemek registry dışına taşmıyor', () => {
  const p = createUnverifiedProvider({ network: 'yeni_ag', displayName: 'Yeni Ağ' });

  assert.equal(p.network, 'yeni_ag');
  assert.ok(PROVIDER_CAPABILITIES.every((c) => p.capabilities[c] === 'unavailable'));
  // Kayda eklenmeden çözülemez: sessizce tanınmaz.
  assert.throws(() => getProvider('yeni_ag'), ProviderError);
});
