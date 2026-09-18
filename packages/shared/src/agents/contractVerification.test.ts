import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';

import { BellekteDenetimDeposu } from '../governance/audit.js';
import { SupremeAuditor, SupremeOrchestrator } from '../governance/supreme.js';
import { dogrula } from '../governance/verification.js';
import { aracCalistir } from '../tools/contract.js';
import type { ToolCtx } from '../tools/contract.js';

import { CALISTIRILAN, SOZLESME_YETENEGI, kontrolDokumu } from './contractVerification.js';
import { uretimDefteriniKur } from './registry.js';

const KOK = resolve(process.cwd(), '../..');
const VALIDATOR = 'contract-verification-validator';

type Cikti = {
  calistirilan: number; gecen: number; temiz: boolean;
  kalan: Array<{ kontrol: string }>;
  sonuclar: Array<{ kontrol: string; cikisKodu: number; gecti: boolean }>;
};

async function calistir(o?: SupremeOrchestrator) {
  const { registry, araclar } = uretimDefteriniKur({ kokDizin: KOK });
  const depo = new BellekteDenetimDeposu();
  const orch = o ?? new SupremeOrchestrator(registry, { denetim: depo });
  const r = await orch.calistir('TR', [{ id: 'g', capability: SOZLESME_YETENEGI }]);
  return { ...r, orchestrator: orch, depo, registry, araclar };
}

// --- 19 · süpervizör yönlendirmesi ---------------------------------------

test('19 · yetenek engineering supervizorune yonlendirilir', () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const a = registry.resolve(SOZLESME_YETENEGI, 'TR');
  assert.equal(a.id, 'contract-verification');
  assert.equal(a.supervisor, 'engineering');
  assert.deepEqual(registry.bySupervisor('engineering').map((x) => x.id),
                   ['contract-verification']);
  /* Diğer dilimin ajanı başka alanda kalıyor -- alanlar karışmıyor. */
  assert.deepEqual(registry.bySupervisor('growth').map((x) => x.id),
                   ['localization-parity']);
});

test('19b · ajan EN AZ YETKI tasiyor: yalnizca run_check', () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  assert.deepEqual([...registry.resolve(SOZLESME_YETENEGI, 'TR').allowedTools], ['run_check']);
});

// --- 20 · tam yürütme zinciri --------------------------------------------

test('20 · GERCEK zincir: orchestrator -> ajan -> gercek surecler -> sonuc', async () => {
  const { onUcus, sonuc } = await calistir();
  assert.equal(onUcus.gecti, true);
  assert.equal(sonuc?.status, 'tamamlandi');

  const cikti = sonuc!.outputs.g as Cikti;
  assert.equal(cikti.calistirilan, CALISTIRILAN.length);
  assert.equal(cikti.gecen, CALISTIRILAN.length);
  assert.equal(cikti.temiz, true);
  /* Her kontrol gerçekten çalıştı ve çıkış kodu okundu. */
  for (const r of cikti.sonuclar) {
    assert.equal(r.cikisKodu, 0, r.kontrol);
    assert.equal(r.gecti, true);
  }
});

test('20b · adim kanit ve guven tasiyor, kanitta BETIK YOLU YOK', async () => {
  const { sonuc } = await calistir();
  const adim = sonuc!.steps[0]!;
  assert.equal(adim.agentId, 'contract-verification');
  assert.equal(adim.confidence, 0.9);
  const kanit = (adim.evidence ?? []).join(' ');
  assert.ok(kanit.includes('marka:'));
  /* Denetim izinin hassas veri suzgeci dosya adini yakalamisti; kanit
     o yuzden yalnizca kontrol kimligi tasiyor. */
  assert.equal(kanit.includes('.mjs'), false);
  assert.equal(kanit.toLowerCase().includes('secret'), false);
});

// --- 15 · validator ------------------------------------------------------

test('15 · validator kontrolleri BAGIMSIZ yeniden calistirir', async () => {
  const { sonuc, araclar } = await calistir();
  const cikti = sonuc!.outputs.g as Cikti;

  const vctx: ToolCtx = {
    agentId: VALIDATOR, izinliAraclar: new Set(['run_check']),
    guvenliMod: false, kalanMs: 300_000, log: () => {},
  };
  const bagimsiz: Array<{ kontrol: string; cikisKodu: number }> = [];
  for (const kontrol of CALISTIRILAN) {
    const r = await aracCalistir<{ kontrol: typeof kontrol }, { kontrol: string; cikisKodu: number }>(
      araclar.get('run_check')!, { kontrol }, vctx,
    );
    bagimsiz.push({ kontrol: r.kontrol, cikisKodu: r.cikisKodu });
  }
  assert.deepEqual(
    bagimsiz,
    cikti.sonuclar.map((r) => ({ kontrol: r.kontrol, cikisKodu: r.cikisKodu })),
  );

  const k = dogrula(
    { agentId: 'contract-verification', cikti, guven: 0.9,
      kanitlar: [{ kaynak: 'run_check', gozlem: 'marka: cikis 0', at: Date.now() }],
      etki: 'orta' },
    VALIDATOR, { gecti: true },
  );
  assert.equal(k.gecti, true);
});

test('15b · VALIDATOR REDDI: cikis kodlari ortusmezse gecmez', () => {
  const k = dogrula(
    { agentId: 'contract-verification', cikti: {}, guven: 0.9,
      kanitlar: [{ kaynak: 'run_check', gozlem: 'x', at: Date.now() }], etki: 'orta' },
    VALIDATOR, { gecti: false, aciklama: 'bagimsiz cikis kodlari ORTUSMUYOR' },
  );
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'teknik_kontrol_basarisiz'));
});

test('15c · ajan KENDI dogrulayicisi olamaz', () => {
  const k = dogrula(
    { agentId: 'contract-verification', cikti: {}, guven: 0.9,
      kanitlar: [{ kaynak: 'run_check', gozlem: 'x', at: Date.now() }], etki: 'orta' },
    'contract-verification', { gecti: true },
  );
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'kendi_kendini_dogrulama'));
});

// --- 16 · auditor --------------------------------------------------------

test('16 · AUDITOR REDDI: iz yoksa denetim gecmez', () => {
  const a = new SupremeAuditor();
  const d = a.denetleIs(
    { agentId: 'contract-verification', cikti: {}, guven: 0.9,
      kanitlar: [{ kaynak: 'run_check', gozlem: 'x', at: Date.now() }], etki: 'orta' },
    [{ validatorId: VALIDATOR, karar: { gecti: true }, at: Date.now() }],
    [],
  );
  assert.equal(d.onaylandi, false);
  assert.ok(d.bulgular.includes('iz_yok'));
});

test('16b · denetim izi gercek calistirmadan sonra yazilir ve zincir TAM', async () => {
  const { orchestrator, depo } = await calistir();
  await orchestrator.izeYaz({
    taskId: 'g', agentId: 'contract-verification', at: Date.now(),
    araclar: ['run_check'], eylem: '3 kontrol calistirildi',
    girdiOzeti: CALISTIRILAN.join('+'), ciktiOzeti: 'gecen=3/3',
    guven: 0.9,
    kanitlar: [{ kaynak: 'run_check', gozlem: 'marka: cikis 0', at: Date.now() }],
    dogrulayan: VALIDATOR, denetleyen: 'supreme-auditor', onaylayan: null,
    durum: 'uygulandi',
  });
  const iz = await depo.gorevIzi('g');
  assert.equal(iz.length, 1);

  const a = new SupremeAuditor();
  const d = a.denetleIs(
    { agentId: 'contract-verification', cikti: {}, guven: 0.9,
      kanitlar: [{ kaynak: 'run_check', gozlem: 'x', at: Date.now() }], etki: 'orta' },
    [{ validatorId: VALIDATOR, karar: { gecti: true }, at: Date.now() }],
    iz,
  );
  assert.equal(d.onaylandi, true);
});

test('16c · denetim izi HASSAS veriyi reddeder', async () => {
  const depo = new BellekteDenetimDeposu();
  await assert.rejects(
    depo.yaz({
      taskId: 'g', agentId: 'contract-verification', at: Date.now(),
      araclar: ['run_check'], eylem: 'x',
      girdiOzeti: 'sha:1', ciktiOzeti: 'scripts/verify-secrets.mjs calisti',
      guven: 0.9, kanitlar: [], dogrulayan: VALIDATOR,
      denetleyen: 'supreme-auditor', onaylayan: null, durum: 'yurutuldu',
    }),
    /hassas_veri/,
  );
});

// --- 17 · fail-closed ----------------------------------------------------

test('17 · FAIL-CLOSED: guvenli modda okuma sinifi arac calisir', async () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const o = new SupremeOrchestrator(registry);
  o.killSwitch.durdur('guvenlik_olayi', 'test');
  const { onUcus } = await o.calistir('TR', [{ id: 'g', capability: SOZLESME_YETENEGI }]);
  assert.equal(onUcus.gecti, true);
});

test('17b · FAIL-CLOSED: izin listesi disindaki betik CALISTIRILAMAZ', () => {
  /* DB ya da sunucu isteyen dogrulamalar listede yok; ajan onlari
     calistiramaz cunku kimlikleri hic tanimli degil. */
  const kimlikler = kontrolDokumu().map((k) => k.kimlik);
  assert.deepEqual(kimlikler.sort(), ['basliklar', 'marka', 'sirlar']);
});

// --- 18 · sağlık ---------------------------------------------------------

test('18 · saglik: basarili calistirma saglikli birakir', async () => {
  const { orchestrator, sonuc } = await calistir();
  const s = orchestrator.ajanSagligi('contract-verification');
  s.isle({ basarili: true, dogrulamaReddi: false, guven: 0.9, gercektenDogru: true,
           denemeler: 1, sureMs: sonuc!.steps[0]!.durationMs, maliyetKurus: 0 });
  assert.equal(s.durum, 'saglikli');
  /* 0.9 beyan edip dogru cikmak NEGATIF sapma verir -- guvenli yon. */
  assert.ok((s.ozet.guvenSapmasi ?? 0) < 0);
});

test('18b · SAGLIK BOZULMASI: tekrarlayan dogrulama reddi kisitliya indirir', async () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const o = new SupremeOrchestrator(registry);
  const s = o.ajanSagligi('contract-verification');
  for (let i = 0; i < 10; i++) {
    s.isle({ basarili: true, dogrulamaReddi: true, guven: 0.9, gercektenDogru: false,
             denemeler: 1, sureMs: 10, maliyetKurus: 0 });
  }
  assert.equal(s.durum, 'kisitli');
  /* Kisitli ajan okuma yapabilir; run_check okuma sinifi oldugu icin
     gorev hala gecer -- ama yazma sinifi bir arac tasisaydi engellenirdi. */
  const { onUcus } = await o.calistir('TR', [{ id: 'g', capability: SOZLESME_YETENEGI }]);
  assert.equal(onUcus.gecti, true);
  assert.ok(onUcus.ekDogrulama.includes('contract-verification'));
});

test('18c · KARANTINA: karantinadaki ajan calistirilmaz', async () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const o = new SupremeOrchestrator(registry);
  o.ajanSagligi('contract-verification').karantinayaAl();
  const { onUcus, sonuc } = await o.calistir('TR', [{ id: 'g', capability: SOZLESME_YETENEGI }]);
  assert.equal(onUcus.gecti, false);
  assert.equal(sonuc, null);
  assert.equal(onUcus.engeller[0]?.kod, 'ajan_karantinada');
});
