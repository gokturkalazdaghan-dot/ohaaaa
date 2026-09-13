import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AgentRegistry } from '../orchestrator/registry.js';
import type { AgentDefinition, AgentResult, ToolName } from '../orchestrator/types.js';

import { SupremeAuditor, SupremeOrchestrator } from './supreme.js';
import { BellekteDenetimDeposu } from './audit.js';
import type { DenetimKaydi } from './audit.js';
import { MaliyetYoneticisi } from './cost.js';
import type { DogrulamaKaydi, IsCiktisi } from './verification.js';

const T = 1_700_000_000_000;

function ajan(
  id: string, capability: string, tools: ToolName[] = ['read_catalog'],
): AgentDefinition {
  return {
    id, supervisor: 'catalog', capabilities: [capability],
    allowedTools: tools, timeoutMs: 1000, maxRetries: 0,
    marketScope: 'all', enabled: true,
    async run(): Promise<AgentResult> { return { output: id, confidence: 1 }; },
  };
}

function kayitli(...ajanlar: AgentDefinition[]): AgentRegistry {
  const r = new AgentRegistry();
  for (const a of ajanlar) r.register(a);
  return r;
}

// --- Ön uçuş ---------------------------------------------------------------

test('temiz durumda okuma gorevi gecer', () => {
  const s = new SupremeOrchestrator(kayitli(ajan('a', 'oku')));
  const o = s.onUcus([{ id: 't1', capability: 'oku' }], 'TR', T);
  assert.equal(o.gecti, true);
  assert.deepEqual(o.engeller, []);
});

test('yetenegi saglayan ajan yoksa engellenir', () => {
  const s = new SupremeOrchestrator(kayitli(ajan('a', 'oku')));
  const o = s.onUcus([{ id: 't1', capability: 'baska' }], 'TR', T);
  assert.equal(o.gecti, false);
  assert.equal(o.engeller[0]?.kod, 'ajan_bulunamadi');
});

test('guvenli modda yazma gorevi engellenir, okuma gecer', () => {
  const s = new SupremeOrchestrator(
    kayitli(ajan('yaz', 'yazma', ['write_catalog']), ajan('oku', 'okuma')),
  );
  s.killSwitch.durdur('veri_bozulmasi', 'test');

  const yazma = s.onUcus([{ id: 't1', capability: 'yazma' }], 'TR', T);
  assert.equal(yazma.gecti, false);
  assert.equal(yazma.engeller[0]?.kod, 'guvenli_mod');

  const okuma = s.onUcus([{ id: 't2', capability: 'okuma' }], 'TR', T);
  assert.equal(okuma.gecti, true);
});

test('karantinadaki ajan gorev ALAMAZ', () => {
  const s = new SupremeOrchestrator(kayitli(ajan('a', 'oku')));
  s.ajanSagligi('a').karantinayaAl();
  const o = s.onUcus([{ id: 't1', capability: 'oku' }], 'TR', T);
  assert.equal(o.engeller[0]?.kod, 'ajan_karantinada');
});

test('kisitli ajan okuyabilir ama YAZAMAZ', () => {
  const s = new SupremeOrchestrator(
    kayitli(ajan('yaz', 'yazma', ['write_catalog']), ajan('oku', 'okuma')),
  );
  s.ajanSagligi('yaz').iyilestir('auditor', 'kisitli');
  s.ajanSagligi('oku').iyilestir('auditor', 'kisitli');

  assert.equal(s.onUcus([{ id: 't1', capability: 'yazma' }], 'TR', T).engeller[0]?.kod,
               'ajan_yazma_kisitli');
  assert.equal(s.onUcus([{ id: 't2', capability: 'okuma' }], 'TR', T).gecti, true);
});

test('uyari durumundaki ajan ek dogrulama listesine girer', () => {
  const s = new SupremeOrchestrator(kayitli(ajan('a', 'oku')));
  s.ajanSagligi('a').iyilestir('auditor', 'uyari');
  const o = s.onUcus([{ id: 't1', capability: 'oku' }], 'TR', T);
  assert.equal(o.gecti, true);
  assert.deepEqual(o.ekDogrulama, ['a']);
});

test('yetki sinifi arac tasiyan ajan ONAYSIZ calisamaz', () => {
  const s = new SupremeOrchestrator(kayitli(ajan('ddl', 'sema', ['propose_ddl'])));
  const o = s.onUcus([{ id: 't1', capability: 'sema' }], 'TR', T);
  assert.equal(o.gecti, false);
  assert.equal(o.engeller[0]?.kod, 'onay_bekliyor');
});

test('onay verilince yetki sinifi gorev gecer', () => {
  const s = new SupremeOrchestrator(kayitli(ajan('ddl', 'sema', ['propose_ddl'])));
  s.onaylar.sun({
    id: 'onay:t1', konu: 'sema_degisikligi', agentId: 'ddl',
    ozet: 'indeks', islem: 'CREATE INDEX ...',
    kanitlar: [{ kaynak: 'EXPLAIN', gozlem: 'Sort 2762 ms', at: T }],
    geriAlma: 'DROP INDEX ...', dogrulandi: true, denetlendi: true, olusturuldu: T,
  });
  s.onaylar.karar('onay:t1', 'onaylandi', 'cto', '', T);
  assert.equal(s.onUcus([{ id: 't1', capability: 'sema' }], 'TR', T).gecti, true);
});

test('butce asilmissa tum plan engellenir', () => {
  const m = new MaliyetYoneticisi({ gorevTavaniKurus: 10, pencereTavaniKurus: 10 });
  m.harca(11);
  const s = new SupremeOrchestrator(kayitli(ajan('a', 'oku')), { maliyet: m });
  const o = s.onUcus([{ id: 't1', capability: 'oku' }], 'TR', T);
  assert.equal(o.gecti, false);
  assert.ok(o.engeller.some((e) => e.kod === 'butce_yok'));
});

test('on ucus gecmezse MOTOR HIC CAGRILMAZ', async () => {
  let calisti = false;
  const a = ajan('a', 'oku');
  a.run = async () => { calisti = true; return { output: 1, confidence: 1 }; };
  const s = new SupremeOrchestrator(kayitli(a));
  s.killSwitch.durdur('guvenlik_olayi', 'test');
  s.ajanSagligi('a').karantinayaAl();

  const { onUcus, sonuc } = await s.calistir('TR', [{ id: 't1', capability: 'oku' }], T);
  assert.equal(onUcus.gecti, false);
  assert.equal(sonuc, null);
  assert.equal(calisti, false);
});

test('on ucus gecince mevcut motor calisir', async () => {
  const s = new SupremeOrchestrator(kayitli(ajan('a', 'oku')));
  const { onUcus, sonuc } = await s.calistir('TR', [{ id: 't1', capability: 'oku' }], T);
  assert.equal(onUcus.gecti, true);
  assert.equal(sonuc?.status, 'tamamlandi');
  assert.equal(sonuc?.outputs.t1, 'a');
});

// --- Supreme Auditor -------------------------------------------------------

function is(over: Partial<IsCiktisi> = {}): IsCiktisi {
  return { agentId: 'worker', cikti: 1, guven: 0.9,
           kanitlar: [{ kaynak: 'db', gozlem: 'x', at: T }], etki: 'orta', ...over };
}

function izKaydi(over: Partial<DenetimKaydi> = {}): DenetimKaydi {
  return {
    taskId: 'g1', agentId: 'worker', at: T, araclar: ['read_catalog'],
    eylem: 'okundu', girdiOzeti: 'sha:1', ciktiOzeti: 'sonuc',
    guven: 0.9, kanitlar: [{ kaynak: 'db', gozlem: 'x', at: T }],
    dogrulayan: 'validator', denetleyen: 'supreme-auditor', onaylayan: null,
    durum: 'uygulandi', ...over,
  };
}

const dk: DogrulamaKaydi = { validatorId: 'validator', karar: { gecti: true }, at: T };

test('duzgun zincir denetimi onaylanir', () => {
  const a = new SupremeAuditor();
  const d = a.denetleIs(is(), [dk], [izKaydi()]);
  assert.equal(d.onaylandi, true);
  assert.deepEqual(d.bulgular, []);
});

test('iz yoksa denetim GECMEZ -- bulamadim sonuc degildir', () => {
  const a = new SupremeAuditor();
  const d = a.denetleIs(is(), [dk], []);
  assert.equal(d.onaylandi, false);
  assert.ok(d.bulgular.includes('iz_yok'));
});

test('kirik zincir yakalanir', () => {
  const a = new SupremeAuditor();
  const d = a.denetleIs(is(), [dk], [izKaydi({ dogrulayan: null })]);
  assert.equal(d.onaylandi, false);
  assert.ok(d.bulgular.includes('zincir_kirik'));
});

test('denetci ayni zamanda dogrulayici ise bagimsizlik YOK', () => {
  const a = new SupremeAuditor();
  const kendi: DogrulamaKaydi = { validatorId: 'supreme-auditor', karar: { gecti: true }, at: T };
  const d = a.denetleIs(is(), [kendi], [izKaydi({ dogrulayan: 'supreme-auditor' })]);
  assert.equal(d.onaylandi, false);
  assert.ok(d.bulgular.includes('denetci_bagimsiz_degil'));
});

test('basarisiz dogrulama denetimi dusurur', () => {
  const a = new SupremeAuditor();
  const red: DogrulamaKaydi = {
    validatorId: 'validator', at: T,
    karar: { gecti: false, redler: [{ kod: 'kanit_yok', aciklama: '' }] },
  };
  const d = a.denetleIs(is(), [red], [izKaydi()]);
  assert.equal(d.onaylandi, false);
  assert.ok(d.bulgular.includes('dogrulama_gecmedi'));
});

test('denetci Orchestrator kararindaki tutarsizligi yakalar', () => {
  const a = new SupremeAuditor();
  assert.equal(a.denetleKoordinasyon({ gecti: true, engeller: [], ekDogrulama: [] }), true);
  /* "Geçti" diyor ama engel listesi dolu -- koordinasyon kendi kuralını çiğnemiş. */
  assert.equal(a.denetleKoordinasyon({
    gecti: true,
    engeller: [{ taskId: 't', kod: 'guvenli_mod', aciklama: '' }],
    ekDogrulama: [],
  }), false);
});

test('uretim onayi IKI katman birden ister', () => {
  const a = new SupremeAuditor();
  const d = a.denetleIs(is(), [dk], [izKaydi()]);
  assert.equal(a.uretimOnayi({ gecti: true }, d), true);
  assert.equal(
    a.uretimOnayi({ gecti: false, redler: [{ kod: 'kanit_yok', aciklama: '' }] }, d),
    false,
  );
});

test('bos denetci kimligi reddedilir', () => {
  assert.throws(() => new SupremeAuditor('  '), /Denetçi kimliği zorunlu/);
});

test('orchestrator denetim izine yazabilir', async () => {
  const depo = new BellekteDenetimDeposu();
  const s = new SupremeOrchestrator(kayitli(ajan('a', 'oku')), { denetim: depo });
  await s.izeYaz(izKaydi());
  assert.equal((await depo.gorevIzi('g1')).length, 1);
});
