import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KANIT_TAZELIK_MS, denetle, dogrula, uretimeGecebilir } from './verification.js';
import type { DogrulamaKaydi, IsCiktisi, Kanit } from './verification.js';

const SIMDI = 1_700_000_000_000;

function kanit(over: Partial<Kanit> = {}): Kanit {
  return { kaynak: 'price_points', gozlem: 'onceki fiyat 129900', at: SIMDI, ...over };
}

function is(over: Partial<IsCiktisi> = {}): IsCiktisi {
  return { agentId: 'deal-detection', cikti: { indirim: 0.4 }, guven: 0.9,
           kanitlar: [kanit()], etki: 'yuksek', ...over };
}

const GECTI = { gecti: true } as const;

test('kanitli, guvenli, teknik kontrolu gecmis is DOGRULANIR', () => {
  assert.deepEqual(dogrula(is(), 'price-history', GECTI, SIMDI), { gecti: true });
});

test('ajan KENDI ciktisini dogrulayamaz', () => {
  const k = dogrula(is(), 'deal-detection', GECTI, SIMDI);
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'kendi_kendini_dogrulama'));
});

test('kanitsiz cikti REDDEDILIR', () => {
  const k = dogrula(is({ kanitlar: [] }), 'v', GECTI, SIMDI);
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'kanit_yok'));
});

test('bos alanli kanit kanit SAYILMAZ', () => {
  const k = dogrula(is({ kanitlar: [kanit({ gozlem: '   ' })] }), 'v', GECTI, SIMDI);
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'kanit_yok'));
});

test('yuksek etkili iste bayat kanit reddedilir', () => {
  const eski = kanit({ at: SIMDI - KANIT_TAZELIK_MS - 1 });
  const k = dogrula(is({ kanitlar: [eski] }), 'v', GECTI, SIMDI);
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'bayat_kanit'));
});

test('dusuk etkili iste tazelik aranmaz', () => {
  const eski = kanit({ at: SIMDI - KANIT_TAZELIK_MS * 10 });
  const k = dogrula(is({ etki: 'dusuk', guven: 0.1, kanitlar: [eski] }), 'v', GECTI, SIMDI);
  assert.equal(k.gecti, true);
});

test('yuksek etkili is icin dusuk guven reddedilir', () => {
  const k = dogrula(is({ guven: 0.6 }), 'v', GECTI, SIMDI);
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'guven_etkiye_gore_dusuk'));
});

test('teknik kontrol basarisizsa reddedilir', () => {
  const k = dogrula(is(), 'v', { gecti: false, aciklama: 'test kirildi' }, SIMDI);
  assert.equal(k.gecti, false);
  if (!k.gecti) {
    const r = k.redler.find((x) => x.kod === 'teknik_kontrol_basarisiz');
    assert.equal(r?.aciklama, 'test kirildi');
  }
});

test('tum redler birlikte raporlanir -- ilkinde durulmaz', () => {
  const k = dogrula(is({ guven: 0, kanitlar: [] }), 'deal-detection',
                    { gecti: false }, SIMDI);
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.equal(k.redler.length, 4);
});

// --- Auditor ---

function dk(over: Partial<DogrulamaKaydi> = {}): DogrulamaKaydi {
  return { validatorId: 'price-history', karar: GECTI, at: SIMDI, ...over };
}

test('duzgun zincir denetimi GECER', () => {
  assert.deepEqual(denetle(is(), [dk()], 'supreme-auditor'), { gecti: true });
});

test('hic dogrulama yoksa zincir EKSIK', () => {
  const k = denetle(is(), [], 'supreme-auditor');
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'zincir_eksik'));
});

test('isi yapan ajan dogrulayici olarak gorunuyorsa denetim REDDEDER', () => {
  const k = denetle(is(), [dk({ validatorId: 'deal-detection' })], 'supreme-auditor');
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'kendi_kendini_dogrulama'));
});

test('denetci ayni zamanda dogrulayici olamaz', () => {
  const k = denetle(is(), [dk({ validatorId: 'ayni' })], 'ayni');
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'kendi_kendini_dogrulama'));
});

test('denetci isi yapan ajan olamaz', () => {
  const k = denetle(is(), [dk()], 'deal-detection');
  assert.equal(k.gecti, false);
});

test('basarisiz dogrulama denetime TASINIR', () => {
  const basarisiz = dk({ karar: { gecti: false, redler: [{ kod: 'kanit_yok', aciklama: 'x' }] } });
  const k = denetle(is(), [basarisiz], 'supreme-auditor');
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'kanit_yok'));
});

test('uretime gecis IKI katman da gecmeden olmaz', () => {
  const red = { gecti: false, redler: [{ kod: 'kanit_yok' as const, aciklama: '' }] };
  assert.equal(uretimeGecebilir(GECTI, GECTI), true);
  assert.equal(uretimeGecebilir(GECTI, red), false);
  assert.equal(uretimeGecebilir(red, GECTI), false);
  assert.equal(uretimeGecebilir(red, red), false);
});
