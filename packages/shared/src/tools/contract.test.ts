import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';

import { z } from 'zod';

import { ToolHatasi, aracCalistir, toolRiski, uygulanmamisMi } from './contract.js';
import type { ToolCtx, ToolKaydi, ToolTanimi } from './contract.js';
import { EN_BUYUK_BAYT, readRepoAraci } from './readRepo.js';
import { ToolKayitDefteri } from './registry.js';

/** Depo kökü: testler dist/ altından çalışıyor, cwd packages/shared. */
const KOK = resolve(process.cwd(), '../..');

function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    agentId: 'test-ajan',
    izinliAraclar: new Set(['read_repo']),
    guvenliMod: false,
    kalanMs: 5000,
    log: () => {},
    ...over,
  };
}

// --- Araç izni (least privilege) ------------------------------------------

test('izin listesinde olmayan arac CALISTIRILAMAZ', async () => {
  const arac = readRepoAraci(KOK) as unknown as ToolKaydi;
  await assert.rejects(
    aracCalistir(arac, { yol: 'package.json' }, ctx({ izinliAraclar: new Set() })),
    (e) => e instanceof ToolHatasi && e.kod === 'izin_yok',
  );
});

test('izin kontrolu girdi kontrolunden ONCE gelir', async () => {
  /* İzinsiz çağrıda girdinin geçerliliği ilgisiz bir sorudur; hata
     mesajı yanlış yeri göstermemeli. */
  const arac = readRepoAraci(KOK) as unknown as ToolKaydi;
  await assert.rejects(
    aracCalistir(arac, { bozuk: true }, ctx({ izinliAraclar: new Set() })),
    (e) => e instanceof ToolHatasi && e.kod === 'izin_yok',
  );
});

test('guvenli modda yan etkili arac reddedilir, okuma gecer', async () => {
  const arac = readRepoAraci(KOK) as unknown as ToolKaydi;
  const r = await aracCalistir<{ yol: string }, { bayt: number }>(
    arac, { yol: 'package.json' }, ctx({ guvenliMod: true }),
  );
  assert.ok(r.bayt > 0);

  const yazma: ToolKaydi = { ad: 'write_catalog', uygulanmamis: true, neden: 'yok' };
  await assert.rejects(
    aracCalistir(yazma, {}, ctx({
      guvenliMod: true, izinliAraclar: new Set(['write_catalog']),
    })),
    (e) => e instanceof ToolHatasi && e.kod === 'guvenli_mod',
  );
});

// --- Geçersiz girdi -------------------------------------------------------

test('semaya uymayan girdi reddedilir', async () => {
  const arac = readRepoAraci(KOK) as unknown as ToolKaydi;
  await assert.rejects(
    aracCalistir(arac, { yol: '' }, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'gecersiz_girdi',
  );
});

test('mutlak yol REDDEDILIR', async () => {
  const arac = readRepoAraci(KOK) as unknown as ToolKaydi;
  await assert.rejects(
    aracCalistir(arac, { yol: '/etc/passwd' }, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'gecersiz_girdi',
  );
});

test('kok disina cikan yol REDDEDILIR', async () => {
  const arac = readRepoAraci(KOK) as unknown as ToolKaydi;
  await assert.rejects(
    aracCalistir(arac, { yol: '../../../../etc/passwd' }, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'izin_yok',
  );
});

test('olmayan dosya ic_hata uretir', async () => {
  const arac = readRepoAraci(KOK) as unknown as ToolKaydi;
  await assert.rejects(
    aracCalistir(arac, { yol: 'yok/olmayan-dosya.txt' }, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'ic_hata',
  );
});

test('gercek dosya okunur', async () => {
  const arac = readRepoAraci(KOK) as unknown as ToolKaydi;
  const r = await aracCalistir<{ yol: string }, { icerik: string; bayt: number }>(
    arac, { yol: 'package.json' }, ctx(),
  );
  assert.ok(r.icerik.includes('ohaaaa-ecosystem'));
  assert.ok(r.bayt > 0 && r.bayt < EN_BUYUK_BAYT);
});

// --- Uygulanmamış araçlar -------------------------------------------------

test('uygulanmamis arac cagrilinca ACIKCA hata verir', async () => {
  const t: ToolKaydi = { ad: 'call_model', uygulanmamis: true, neden: 'anahtar yok' };
  assert.equal(uygulanmamisMi(t), true);
  await assert.rejects(
    aracCalistir(t, {}, ctx({ izinliAraclar: new Set(['call_model']) })),
    (e) => e instanceof ToolHatasi && e.kod === 'uygulanmamis',
  );
});

test('kayit defteri uygulanan ve uygulanmayanlari AYIRIR', () => {
  const d = new ToolKayitDefteri(KOK);
  assert.deepEqual(d.uygulananlar().sort(), ['read_repo', 'run_check']);
  assert.equal(d.uygulanmayanlar().length, 23);
  /* Uygulanmamış her araç gerekçe taşıyor. */
  for (const ad of d.uygulanmayanlar()) {
    const t = d.get(ad);
    assert.ok(t && uygulanmamisMi(t) && t.neden.length > 0, ad);
  }
});

test('kok verilmezse read_repo de uygulanmamis sayilir', () => {
  const d = new ToolKayitDefteri();
  assert.deepEqual(d.uygulananlar(), []);
  assert.equal(d.uygulanmayanlar().length, 25);
});

test('arac riski PHASE 1 siniflandirmasina bagli', () => {
  assert.equal(toolRiski('read_repo'), 'okuma');
  assert.equal(toolRiski('write_repo'), 'yetki');
  assert.equal(toolRiski('call_model'), 'yazma');
});

// --- Zaman aşımı ve yeniden deneme ----------------------------------------

function yavasArac(gecikmeMs: number, retries: number): ToolTanimi<unknown, { ok: true }> {
  return {
    ad: 'read_repo',
    aciklama: 'test',
    girdiSemasi: z.object({}).passthrough(),
    ciktiSemasi: z.object({ ok: z.literal(true) }),
    varsayilanTimeoutMs: 30,
    maxRetries: retries,
    async calistir() {
      await new Promise((r) => setTimeout(r, gecikmeMs));
      return { ok: true as const };
    },
  };
}

test('zaman asimi yakalanir', async () => {
  await assert.rejects(
    aracCalistir(yavasArac(200, 0) as unknown as ToolKaydi, {}, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'zaman_asimi',
  );
});

test('gecici hata maxRetries kadar yeniden DENENIR', async () => {
  let cagri = 0;
  const t: ToolTanimi<unknown, { ok: true }> = {
    ...yavasArac(0, 2),
    async calistir() {
      cagri++;
      if (cagri < 3) throw new Error('gecici');
      return { ok: true as const };
    },
  };
  const r = await aracCalistir<unknown, { ok: true }>(t as unknown as ToolKaydi, {}, ctx());
  assert.equal(r.ok, true);
  assert.equal(cagri, 3);
});

test('yeniden denenemez hata TEKRARLANMAZ', async () => {
  let cagri = 0;
  const t: ToolTanimi<unknown, { ok: true }> = {
    ...yavasArac(0, 5),
    async calistir() {
      cagri++;
      throw new ToolHatasi('gecersiz_girdi', 'read_repo', 'kalici', false);
    },
  };
  await assert.rejects(aracCalistir(t as unknown as ToolKaydi, {}, ctx()));
  assert.equal(cagri, 1);
});

test('sozlesmesini bozan cikti yeniden DENENMEZ', async () => {
  let cagri = 0;
  const t: ToolTanimi<unknown, { ok: true }> = {
    ...yavasArac(0, 3),
    async calistir() { cagri++; return { ok: false } as unknown as { ok: true }; },
  };
  await assert.rejects(
    aracCalistir(t as unknown as ToolKaydi, {}, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'gecersiz_cikti',
  );
  assert.equal(cagri, 1);
});

test('kalan sure arac timeoutundan kisaysa kalan sure gecerlidir', async () => {
  await assert.rejects(
    aracCalistir(yavasArac(100, 0) as unknown as ToolKaydi, {}, ctx({ kalanMs: 10 })),
    (e) => e instanceof ToolHatasi && e.kod === 'zaman_asimi',
  );
});
