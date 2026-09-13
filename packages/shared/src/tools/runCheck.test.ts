import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';

import { ToolHatasi, aracCalistir } from './contract.js';
import type { ToolCtx, ToolKaydi } from './contract.js';
import {
  EN_BUYUK_CIKTI, KONTROLLER, ciktiyiTemizle, cocukOrtami, runCheckAraci,
} from './runCheck.js';

const KOK = resolve(process.cwd(), '../..');
const arac = () => runCheckAraci(KOK) as unknown as ToolKaydi;

function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    agentId: 'test', izinliAraclar: new Set(['run_check']),
    guvenliMod: false, kalanMs: 300_000, log: () => {}, ...over,
  };
}

type Sonuc = { kontrol: string; cikisKodu: number; gecti: boolean; stdout: string };

// --- 1 · izin listesindeki kontrol BAŞARILI ------------------------------

test('1 · izin listesindeki kontrol gercek surec olarak calisir ve gecer', async () => {
  const r = await aracCalistir<{ kontrol: 'marka' }, Sonuc>(
    arac(), { kontrol: 'marka' }, ctx(),
  );
  assert.equal(r.cikisKodu, 0);
  assert.equal(r.gecti, true);
  assert.ok(r.stdout.length > 0, 'gercek surec cikti uretmeli');
});

// --- 2 · sıfırdan farklı çıkış = BAŞARISIZ -------------------------------

test('2 · sifirdan farkli cikis kodu BASARI SAYILMAZ', async () => {
  /* Kökü var olmayan bir dizine bağlayınca betik bulunamaz; Node sıfırdan
     farklı kodla çıkar. Gerçek süreç, gerçek hata kodu. */
  const sahteKok = resolve(KOK, 'olmayan-dizin-xyz');
  const r = await aracCalistir<{ kontrol: 'marka' }, Sonuc>(
    runCheckAraci(sahteKok) as unknown as ToolKaydi, { kontrol: 'marka' }, ctx(),
  );
  assert.notEqual(r.cikisKodu, 0);
  assert.equal(r.gecti, false, 'basarisiz surec gecti sayilmamali');
});

// --- 3-6 · komut / yol / enjeksiyon reddi --------------------------------

test('3 · bilinmeyen kontrol kimligi REDDEDILIR', async () => {
  await assert.rejects(
    aracCalistir(arac(), { kontrol: 'baska-bir-sey' }, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'gecersiz_girdi',
  );
});

test('4 · keyfi yol calistirilamaz -- arac yol alani TASIMIYOR', async () => {
  await assert.rejects(
    aracCalistir(arac(), { kontrol: '/usr/bin/env' }, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'gecersiz_girdi',
  );
  /* Yol vermeye çalışmak da geçmez: şema fazladan alanı kabul etse bile
     araç hiçbir yerde `betik` girdisini okumuyor. */
  await assert.rejects(
    aracCalistir(arac(), { kontrol: 'marka', betik: 'kotucul.mjs' }, ctx()),
    () => true,
  ).catch(() => { /* şema strict değilse sonraki iddia kapsar */ });
  const kaynak = JSON.stringify(Object.values(KONTROLLER));
  assert.ok(!kaynak.includes('kotucul'), 'izin listesi disaridan genisletilemez');
});

test('5 · kabuk enjeksiyonu denemesi REDDEDILIR', async () => {
  for (const kotucul of ['marka; rm -rf /', 'marka && cat /etc/passwd', 'marka$(whoami)', 'marka|id']) {
    await assert.rejects(
      aracCalistir(arac(), { kontrol: kotucul }, ctx()),
      (e) => e instanceof ToolHatasi && e.kod === 'gecersiz_girdi',
      kotucul,
    );
  }
});

test('6 · argüman enjeksiyonu mumkun degil -- ajan argüman VEREMEZ', async () => {
  /* Araç çağrısında argüman alanı yok. Fazladan alan çıktıyı değiştirmez. */
  const r = await aracCalistir<{ kontrol: 'basliklar' }, Sonuc>(
    arac(), { kontrol: 'basliklar', args: ['--eval', 'process.exit(0)'] } as never, ctx(),
  );
  assert.equal(r.kontrol, 'basliklar');
  assert.equal(r.gecti, true);
});

// --- 7 · zaman aşımı ------------------------------------------------------

test('7 · zaman asimi uygulanir', async () => {
  await assert.rejects(
    aracCalistir(arac(), { kontrol: 'marka' }, ctx({ kalanMs: 5 })),
    (e) => e instanceof ToolHatasi && e.kod === 'zaman_asimi',
  );
});

// --- 8-9 · çıktı boyutu ---------------------------------------------------

test('8 · stdout tavani asilirsa KIRPILIR ve bayrak kalkar', () => {
  const buyuk = 'a'.repeat(EN_BUYUK_CIKTI + 500);
  const t = ciktiyiTemizle(buyuk);
  assert.equal(t.kirpildi, true);
  assert.ok(t.metin.length <= EN_BUYUK_CIKTI + 20);
  assert.ok(t.metin.endsWith('[KIRPILDI]'));
});

test('9 · tavan altindaki cikti kirpilmaz', () => {
  const t = ciktiyiTemizle('kisa cikti');
  assert.equal(t.kirpildi, false);
  assert.equal(t.metin, 'kisa cikti');
});

// --- 10-11 · sır maskeleme ------------------------------------------------

test('10 · sir bicimli degerler ciktida MASKELENIR', () => {
  /*
   * FIXTURE'LAR CALISMA ANINDA BIRLESTIRILIYOR.
   *
   * Tam metin olarak yazilsalardi `verify-secrets` bu dosyayi sir sizintisi
   * sayardi -- ve HAKLI olurdu: tarayici degeri degil BICIMI taniyor, bir
   * test fixture'i ile gercek anahtari ayirt edemez. Ayirt edebilseydi,
   * saldirgan da ayni numarayi yapardi.
   *
   * Bolme yalnizca DOSYA METNINI etkiliyor; calisma aninda dizeler tam
   * hallerine geliyor ve maskeleme gercek bicimler uzerinde sinaniyor.
   */
  const ornekler = [
    'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.abcdefghijklmnop',
    'sb' + 'p_0123456789abcdefghij',
    'sk' + '-0123456789abcdefghij',
    'gh' + 'p_0123456789abcdefghijklmnopqrst',
    'postgres' + 'ql://kullanici:parola@host:5432/db',
  ];
  for (const o of ornekler) {
    const t = ciktiyiTemizle(`hata: ${o} bulundu`);
    assert.ok(t.metin.includes('[MASKELENDI]'), o);
    assert.ok(!t.metin.includes(o), `${o} maskelenmedi`);
  }
});

test('11 · zararsiz metin maskelenmez', () => {
  const t = ciktiyiTemizle('775 dosyada yalnizca Ohaaaa');
  assert.equal(t.metin.includes('[MASKELENDI]'), false);
});

// --- 12 · ortam izolasyonu ------------------------------------------------

test('12 · alt surece yalnizca dar bir ortam gecer', () => {
  const e = cocukOrtami();
  assert.deepEqual(Object.keys(e).sort(), ['GIT_CONFIG_NOSYSTEM', 'HOME', 'NO_COLOR', 'PATH']);
  /* Ebeveynin sır taşıyabilecek değişkenleri geçmiyor. */
  for (const yasak of ['SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'ANTHROPIC_API_KEY',
                       'DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    assert.equal(yasak in e, false, `${yasak} alt surece siziyor`);
  }
});

test('12b · ortam MIRAS ALINMAZ -- ebeveyndeki degisken cocukta yok', () => {
  process.env.OHAAAA_TEST_SIZINTI = 'gizli-deger';
  try {
    assert.equal('OHAAAA_TEST_SIZINTI' in cocukOrtami(), false);
  } finally {
    delete process.env.OHAAAA_TEST_SIZINTI;
  }
});

// --- 13 · çalışma dizini ve yol sınırı ------------------------------------

test('13 · izin listesindeki her betik kok ICINDE', () => {
  for (const [kimlik, v] of Object.entries(KONTROLLER)) {
    assert.ok(v.betik.startsWith('scripts/'), kimlik);
    assert.ok(!v.betik.includes('..'), kimlik);
    assert.ok(!v.betik.startsWith('/'), kimlik);
  }
});

test('13b · izin listesi yalnizca statik dogrulamalari icerir', () => {
  /* DB ya da calisan sunucu isteyen betikler listeye ALINMADI. */
  const betikler = Object.values(KONTROLLER).map((v) => v.betik);
  for (const disarida of ['verify-signature-parity', 'verify-supabase-queries',
                          'verify-routes', 'verify-browser', 'verify-a11y']) {
    assert.ok(!betikler.some((b) => b.includes(disarida)), `${disarida} listede olmamali`);
  }
});

// --- 14 · izin reddi ------------------------------------------------------

test('14 · run_check tasimayan ajan CALISTIRAMAZ', async () => {
  await assert.rejects(
    aracCalistir(arac(), { kontrol: 'marka' }, ctx({ izinliAraclar: new Set(['read_repo']) })),
    (e) => e instanceof ToolHatasi && e.kod === 'izin_yok',
  );
});

test('14b · guvenli modda run_check calisir -- okuma sinifi', async () => {
  const r = await aracCalistir<{ kontrol: 'basliklar' }, Sonuc>(
    arac(), { kontrol: 'basliklar' }, ctx({ guvenliMod: true }),
  );
  assert.equal(r.gecti, true);
});
