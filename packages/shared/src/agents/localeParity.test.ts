import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';

import { SupremeAuditor, SupremeOrchestrator } from '../governance/supreme.js';
import { BellekteDenetimDeposu } from '../governance/audit.js';
import { dogrula } from '../governance/verification.js';
import type { AgentContext } from '../orchestrator/types.js';
import { aracCalistir } from '../tools/contract.js';
import type { ToolCtx } from '../tools/contract.js';

import {
  EN_AZ_ANAHTAR, EN_YOLU, TR_YOLU, YETENEK, localeParityAjani, pariteyiOlc,
  sozlukAyristir, yerTutucular,
} from './localeParity.js';
import { uretimDefteriniKur } from './registry.js';

const KOK = resolve(process.cwd(), '../..');
const VALIDATOR = 'localization-validator';

// --- Saf ölçüm mantığı ----------------------------------------------------

test('yer tutucular tekrarsiz ve sirali cikarilir', () => {
  assert.deepEqual(yerTutucular('{b} ve {a} ve {a}'), ['a', 'b']);
  assert.deepEqual(yerTutucular('yer tutucu yok'), []);
});

test('yer tutucu sapmasi YAKALANIR', () => {
  const tr = new Map([['k', 'En düşük {fiyat}']]);
  const en = new Map([['k', 'Lowest {price}']]);
  const s = pariteyiOlc(tr, en);
  assert.equal(s.temiz, false);
  assert.deepEqual(s.sapmalar, [{ anahtar: 'k', tr: ['fiyat'], en: ['price'] }]);
});

test('eksik yer tutucu da sapmadir', () => {
  const s = pariteyiOlc(new Map([['k', 'x {a}']]), new Map([['k', 'x']]));
  assert.equal(s.sapmalar.length, 1);
});

test('ayni yer tutucular temiz sayilir', () => {
  const s = pariteyiOlc(new Map([['k', '{a} x']]), new Map([['k', 'y {a}']]));
  assert.equal(s.temiz, true);
  assert.equal(s.yerTutuculu, 1);
});

test('ayni uzun metin UYARI uretir ama temizligi bozmaz', () => {
  const m = 'Bu metin iki dilde birebir ayni duruyor';
  const s = pariteyiOlc(new Map([['k', m]]), new Map([['k', m]]));
  assert.deepEqual(s.cevrilmemisAdaylari, ['k']);
  assert.equal(s.temiz, true);
});

test('kisa marka kalibi uyari uretmez', () => {
  const s = pariteyiOlc(new Map([['k', '{ad} · X']]), new Map([['k', '{ad} · X']]));
  assert.deepEqual(s.cevrilmemisAdaylari, []);
});

test('sozluk ayristirici gercek dosyayi okur', async () => {
  const { araclar } = uretimDefteriniKur({ kokDizin: KOK });
  const arac = araclar.get('read_repo')!;
  const ctx: ToolCtx = {
    agentId: 't', izinliAraclar: new Set(['read_repo']),
    guvenliMod: false, kalanMs: 5000, log: () => {},
  };
  const d = await aracCalistir<{ yol: string }, { icerik: string }>(arac, { yol: TR_YOLU }, ctx);
  const m = sozlukAyristir(d.icerik);
  assert.ok(m.size >= EN_AZ_ANAHTAR, `${m.size} anahtar`);
  assert.ok(m.has('hata.veriYok'));
});

// --- Registry ve routing --------------------------------------------------

test('uretim defterinde GERCEK ajan kayitli', () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const hepsi = registry.all();
  assert.equal(hepsi.length, 1);
  assert.equal(hepsi[0]?.id, 'localization-parity');
});

test('supervisor routing: ajan growth alanina bagli', () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  assert.deepEqual(registry.bySupervisor('growth').map((a) => a.id), ['localization-parity']);
  assert.deepEqual(registry.bySupervisor('catalog'), []);
});

test('yetenekle cozumleme calisir', () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  assert.equal(registry.resolve(YETENEK, 'TR').id, 'localization-parity');
});

test('ajan EN AZ YETKI tasiyor: yalnizca read_repo', () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  assert.deepEqual([...registry.all()[0]!.allowedTools], ['read_repo']);
});

// --- Gerçek yürütme -------------------------------------------------------

async function gercekCalistir() {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const depo = new BellekteDenetimDeposu();
  const o = new SupremeOrchestrator(registry, { denetim: depo });
  const r = await o.calistir('TR', [{ id: 'g', capability: YETENEK }]);
  return { ...r, orchestrator: o, depo };
}

test('GERCEK yurutme: ajan gercek dosyalari okur ve olcum uretir', async () => {
  const { onUcus, sonuc } = await gercekCalistir();
  assert.equal(onUcus.gecti, true);
  assert.equal(sonuc?.status, 'tamamlandi');

  const cikti = sonuc!.outputs.g as { anahtar: number; yerTutuculu: number; temiz: boolean };
  /* Gerçek depo verisi: ölçülen 135 anahtarın 52'si yer tutucu taşıyor. */
  assert.ok(cikti.anahtar >= EN_AZ_ANAHTAR);
  assert.ok(cikti.yerTutuculu > 0);
  assert.equal(cikti.temiz, true, 'depoda yer tutucu sapmasi VAR');
});

test('adim kanit ve guven TASIYOR', async () => {
  const { sonuc } = await gercekCalistir();
  const adim = sonuc!.steps[0]!;
  assert.equal(adim.agentId, 'localization-parity');
  assert.equal(adim.confidence, 1);
  assert.ok((adim.evidence ?? []).length >= 4);
});

test('validator olcumu BAGIMSIZ yeniden turetir ve dogrular', async () => {
  const { sonuc } = await gercekCalistir();
  const cikti = sonuc!.outputs.g;

  const { araclar } = uretimDefteriniKur({ kokDizin: KOK });
  const arac = araclar.get('read_repo')!;
  const ctx: ToolCtx = {
    agentId: VALIDATOR, izinliAraclar: new Set(['read_repo']),
    guvenliMod: false, kalanMs: 5000, log: () => {},
  };
  const tr = await aracCalistir<{ yol: string }, { icerik: string }>(arac, { yol: TR_YOLU }, ctx);
  const en = await aracCalistir<{ yol: string }, { icerik: string }>(arac, { yol: EN_YOLU }, ctx);
  const bagimsiz = pariteyiOlc(sozlukAyristir(tr.icerik), sozlukAyristir(en.icerik));

  assert.deepEqual(bagimsiz, cikti);

  const k = dogrula(
    { agentId: 'localization-parity', cikti, guven: 1,
      kanitlar: [{ kaynak: 'read_repo', gozlem: 'olculdu', at: Date.now() }],
      etki: 'orta' },
    VALIDATOR, { gecti: true },
  );
  assert.equal(k.gecti, true);
});

test('VALIDATOR REDDI: bagimsiz olcum ortusmezse gecmez', async () => {
  const k = dogrula(
    { agentId: 'localization-parity', cikti: { sahte: true }, guven: 1,
      kanitlar: [{ kaynak: 'read_repo', gozlem: 'x', at: Date.now() }], etki: 'orta' },
    VALIDATOR, { gecti: false, aciklama: 'olcum ortusmuyor' },
  );
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'teknik_kontrol_basarisiz'));
});

test('AUDITOR REDDI: ajan kendi dogrulayicisi olursa denetim gecmez', async () => {
  const a = new SupremeAuditor();
  const is = { agentId: 'localization-parity', cikti: {}, guven: 1,
               kanitlar: [{ kaynak: 'read_repo', gozlem: 'x', at: Date.now() }],
               etki: 'orta' as const };
  const d = a.denetleIs(
    is,
    [{ validatorId: 'localization-parity', karar: { gecti: true }, at: Date.now() }],
    [],
  );
  assert.equal(d.onaylandi, false);
  assert.ok(d.bulgular.includes('iz_yok'));
});

test('denetim izi gercek calistirmadan sonra YAZILIR', async () => {
  const { orchestrator, depo, sonuc } = await gercekCalistir();
  await orchestrator.izeYaz({
    taskId: 'g', agentId: 'localization-parity', at: Date.now(),
    araclar: ['read_repo'], eylem: 'parite olculdu',
    girdiOzeti: `${TR_YOLU}+${EN_YOLU}`, ciktiOzeti: 'sapma=0',
    guven: 1,
    kanitlar: [{ kaynak: 'read_repo', gozlem: 'olculdu', at: Date.now() }],
    dogrulayan: VALIDATOR, denetleyen: 'supreme-auditor', onaylayan: null,
    durum: 'uygulandi',
  });
  const iz = await depo.gorevIzi('g');
  assert.equal(iz.length, 1);
  assert.equal(iz[0]?.dogrulayan, VALIDATOR);
  assert.ok(sonuc);
});

test('SAGLIK: basarili calistirma saglikli birakir ve guven sapmasi sifir', async () => {
  const { orchestrator, sonuc } = await gercekCalistir();
  const s = orchestrator.ajanSagligi('localization-parity');
  s.isle({ basarili: true, dogrulamaReddi: false, guven: 1, gercektenDogru: true,
           denemeler: 1, sureMs: sonuc!.steps[0]!.durationMs, maliyetKurus: 0 });
  assert.equal(s.durum, 'saglikli');
  assert.equal(s.ozet.guvenSapmasi, 0);
});

test('KARANTINA: karantinadaki ajan gercekten calistirilmaz', async () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const o = new SupremeOrchestrator(registry);
  o.ajanSagligi('localization-parity').karantinayaAl();
  const { onUcus, sonuc } = await o.calistir('TR', [{ id: 'g', capability: YETENEK }]);
  assert.equal(onUcus.gecti, false);
  assert.equal(sonuc, null);
  assert.equal(onUcus.engeller[0]?.kod, 'ajan_karantinada');
});

test('FAIL-CLOSED: guvenli modda okuma ajani CALISIR (teshis korlesmesin)', async () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const o = new SupremeOrchestrator(registry);
  o.killSwitch.durdur('guvenlik_olayi', 'test');
  const { onUcus } = await o.calistir('TR', [{ id: 'g', capability: YETENEK }]);
  assert.equal(onUcus.gecti, true);
});

test('FAIL-CLOSED: sozluk ayristirmasi guvenilmezse ajan HATA VERIR', async () => {
  /* Kök yanlış verilirse dosyalar okunamaz; ajan "temiz" demez, düşer. */
  const ajan = localeParityAjani({
    tool: () => ({ ad: 'read_repo', uygulanmamis: true, neden: 'test' }),
    toolCtx: (): ToolCtx => ({
      agentId: 'localization-parity', izinliAraclar: new Set(['read_repo']),
      guvenliMod: false, kalanMs: 5000, log: () => {},
    }),
  });
  const ctx = {
    market: 'TR' as const, tools: new Set(['read_repo' as const]),
    deadline: Date.now() + 5000, inputs: {}, log: () => {},
  };
  await assert.rejects(ajan.run(undefined, ctx as AgentContext));
});

test('FAIL-CLOSED: yetersiz anahtarda ajan temiz rapor VERMEZ', async () => {
  const kisa = "export const TR = {\n  'a': 'x',\n} as const;\n";
  const m = sozlukAyristir(kisa);
  assert.ok(m.size < EN_AZ_ANAHTAR);
  /* Ajan bu durumda `pariteyiOlc` çağırmadan hata fırlatıyor -- ölçüm
     yapılmamışken "sapma yok" demek, kontrolü hiç yapmamak olurdu. */
});
