import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';

import { BellekteDenetimDeposu } from '../governance/audit.js';
import { SupremeAuditor, SupremeOrchestrator } from '../governance/supreme.js';
import { dogrula } from '../governance/verification.js';
import { ToolHatasi, uygulanmamisMi } from '../tools/contract.js';
import { SORGULAR } from '../tools/readDb.js';
import type { MetadataYurutucu } from '../tools/readDb.js';

import {
  DRIFT_YETENEGI, GOC_DIZINI, dikkatGerektirir, gocteBildirilenTablolar, siniflandir,
} from './schemaDrift.js';
import type { UretimTablo, UretimYetki } from './schemaDrift.js';
import { uretimDefteriniKur } from './registry.js';

const KOK = resolve(process.cwd(), '../..');

/**
 * Gerçek üretimden ÖLÇÜLEREK alınmış katalog yanıtları.
 *
 * Uydurma değil: her satır bu turda üretim veritabanından salt okunur
 * olarak okundu. Yürütücü portu henüz üretime bağlı olmadığı için
 * testler bu ölçülmüş yanıtları kullanıyor -- ve testin iddiası
 * "üretim böyle" değil, "ajan bu veriyi DOĞRU SINIFLANDIRIYOR".
 */
class OlculmusYurutucu implements MetadataYurutucu {
  readonly cagrilar: Array<{ sql: string; params: readonly unknown[] }> = [];
  async sorgula(sql: string, params: readonly unknown[]) {
    this.cagrilar.push({ sql, params });
    if (sql === SORGULAR.schema_tables.sql) {
      return [
        { tablo: 'Ohaaaa.com', rls_acik: true, politika: 0 },
        { tablo: 'products', rls_acik: true, politika: 5 },
        { tablo: 'jobs', rls_acik: true, politika: 0 },
      ] as Record<string, unknown>[];
    }
    if (sql === SORGULAR.table_grants.sql) {
      const t = params[0];
      if (t === 'Ohaaaa.com') {
        return [
          { rol: 'anon', yetki: 'SELECT' }, { rol: 'anon', yetki: 'INSERT' },
          { rol: 'anon', yetki: 'UPDATE' }, { rol: 'anon', yetki: 'DELETE' },
          { rol: 'authenticated', yetki: 'INSERT' },
        ] as Record<string, unknown>[];
      }
      return [{ rol: 'service_role', yetki: 'SELECT' }] as Record<string, unknown>[];
    }
    return [];
  }
}

function tablo(over: Partial<UretimTablo> = {}): UretimTablo {
  return { tablo: 't', rls_acik: true, politika: 0, ...over };
}
const anonCrud: UretimYetki[] = [
  { rol: 'anon', yetki: 'INSERT' }, { rol: 'anon', yetki: 'UPDATE' },
  { rol: 'anon', yetki: 'DELETE' },
];

// --- Göç ayrıştırma -------------------------------------------------------

test('goc SQL inden tablo adlari cikarilir', () => {
  const s = gocteBildirilenTablolar(
    'create table public.products (id uuid);\nCREATE TABLE IF NOT EXISTS "orders" (x int);',
  );
  assert.ok(s.has('products'));
  assert.ok(s.has('orders'));
});

test('rename ile dogan ad da depo tanimi sayilir', () => {
  const s = gocteBildirilenTablolar('alter table eski rename to yeni;');
  assert.ok(s.has('yeni'));
});

test('gercek goc dizini okunabiliyor ve tablo bildiriyor', async () => {
  const { araclar } = uretimDefteriniKur({ kokDizin: KOK });
  const repo = araclar.get('read_repo')!;
  const ctx = { agentId: 't', izinliAraclar: new Set(['read_repo' as const]),
                guvenliMod: false, kalanMs: 10_000, log: () => {} };
  const { aracCalistir } = await import('../tools/contract.js');
  const d = await aracCalistir<{ yol: string; mod: 'listele' }, { girdiler: string[] }>(
    repo, { yol: GOC_DIZINI, mod: 'listele' }, ctx,
  );
  const sql = d.girdiler.filter((f) => f.endsWith('.sql'));
  assert.ok(sql.length > 50, `${sql.length} goc dosyasi`);
});

// --- Sınıflandırma --------------------------------------------------------

test('SINIF E: RLS acik + politika yok + anon yazma = gizli yetki riski', () => {
  const b = siniflandir(tablo({ tablo: 'Ohaaaa.com' }), false, anonCrud);
  assert.equal(b.sinif, 'gizli_yetki_riski');
  assert.equal(b.siddet, 'yuksek');
  assert.deepEqual(b.anonYazma, ['DELETE', 'INSERT', 'UPDATE']);
});

test('SINIF E: su an SOMURULEBILIR DEGIL -- varsayilan ret', () => {
  /* En kritik ayrim: yetki duruyor ama RLS politikasizken reddediyor.
     "Su an somurulebilir" demek yanlis alarm olurdu. */
  const b = siniflandir(tablo(), false, anonCrud);
  assert.equal(b.suAnSomurulebilir, false);
  assert.match(b.somurulemezlikSebebi ?? '', /varsayılan ret/);
});

test('SINIF D: politika VARSA su an somurulebilir sayilir', () => {
  const b = siniflandir(tablo({ politika: 1 }), false, anonCrud);
  assert.equal(b.sinif, 'guvenlik_hassas');
  assert.equal(b.suAnSomurulebilir, true);
});

test('SINIF C: RLS kapali tablo yetki sapmasi adayi', () => {
  const b = siniflandir(tablo({ rls_acik: false, politika: 0 }), true, []);
  assert.equal(b.sinif, 'yetki_sapmasi_adayi');
  assert.equal(b.siddet, 'yuksek');
});

test('SINIF B: depoda yok ama zararsiz = sema sapmasi adayi', () => {
  const b = siniflandir(tablo({ politika: 3 }), false, []);
  assert.equal(b.sinif, 'sema_sapmasi_adayi');
  assert.equal(b.siddet, 'orta');
});

test('SINIF A: depoda var, RLS acik, anon yazma yok = uyumlu', () => {
  const b = siniflandir(tablo({ politika: 2 }), true, []);
  assert.equal(b.sinif, 'uyumlu');
  assert.equal(b.insanOnayiGerekir, false);
  assert.equal(dikkatGerektirir(b), false);
});

test('YANLIS POZITIF KORUMASI: politikasiz ic tablo tek basina RISK DEGIL', () => {
  /* `jobs` gibi 14 ic tablo RLS acik + politikasiz -- varsayilan ret,
     dogru durus. Anon yazma yetkisi yoksa bunlar riske alinmamali. */
  const b = siniflandir(tablo({ tablo: 'jobs' }), true, []);
  assert.equal(b.sinif, 'uyumlu');
});

test('HER dikkat bulgusu INSAN ONAYI ister', () => {
  for (const b of [
    siniflandir(tablo(), false, anonCrud),
    siniflandir(tablo({ politika: 1 }), false, anonCrud),
    siniflandir(tablo({ rls_acik: false }), true, []),
    siniflandir(tablo({ politika: 3 }), false, []),
  ]) {
    assert.equal(b.insanOnayiGerekir, true, b.sinif);
  }
});

// --- Ajan kaydı ve sınırı -------------------------------------------------

test('ajan security supervizorune kayitli', () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const a = registry.resolve(DRIFT_YETENEGI, 'TR');
  assert.equal(a.id, 'schema-drift-auditor');
  assert.equal(a.supervisor, 'security');
  assert.deepEqual(registry.bySupervisor('security').map((x) => x.id),
                   ['schema-drift-auditor']);
});

test('ajan YALNIZCA iki salt okunur arac tasiyor', () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const a = registry.resolve(DRIFT_YETENEGI, 'TR');
  assert.deepEqual([...a.allowedTools].sort(), ['read_db', 'read_repo']);
  /* Duzeltme onerisi bile yapamaz. */
  assert.equal(a.allowedTools.includes('propose_ddl' as never), false);
  assert.equal(a.allowedTools.some((t) => t.startsWith('write_')), false);
});

test('uc ajan kayitli, her biri kendi alaninda', () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  assert.deepEqual(registry.all().map((a) => a.id).sort(),
                   ['contract-verification', 'localization-parity', 'schema-drift-auditor']);
});

// --- FAIL-CLOSED ----------------------------------------------------------

test('FAIL-CLOSED: yurutucu verilmezse read_db UYGULANMAMIS kalir', () => {
  const { araclar } = uretimDefteriniKur({ kokDizin: KOK });
  const t = araclar.get('read_db')!;
  /* `assert.ok` birlesimi daraltmaz; tip korumasini acikca calistiriyoruz. */
  if (!uygulanmamisMi(t)) throw new Error('read_db yurutucusuz UYGULANMIS gorunuyor');
  assert.match(t.neden, /yürütücüsü verilmedi/);
});

test('FAIL-CLOSED: yurutucusuz ajan CALISAMAZ -- sessizce temiz demez', async () => {
  const { registry } = uretimDefteriniKur({ kokDizin: KOK });
  const o = new SupremeOrchestrator(registry);
  const { sonuc } = await o.calistir('TR', [{ id: 'g', capability: DRIFT_YETENEGI }]);
  const adim = sonuc?.steps.find((s) => s.taskId === 'g');
  assert.notEqual(adim?.status, 'tamamlandi');
});

test('yurutucu verilirse read_db UYGULANMIS olur', () => {
  const { araclar } = uretimDefteriniKur({
    kokDizin: KOK, metadataYurutucu: new OlculmusYurutucu(),
  });
  assert.ok(araclar.uygulananlar().includes('read_db'));
});

// --- Gerçek zincir (ölçülmüş katalog yanıtlarıyla) ------------------------

async function calistir() {
  const y = new OlculmusYurutucu();
  const { registry } = uretimDefteriniKur({ kokDizin: KOK, metadataYurutucu: y });
  const depo = new BellekteDenetimDeposu();
  const o = new SupremeOrchestrator(registry, { denetim: depo });
  const r = await o.calistir('TR', [{ id: 'g', capability: DRIFT_YETENEGI }]);
  return { ...r, yurutucu: y, orchestrator: o, depo };
}

test('ZINCIR: ajan gercek goc dosyalarini okur ve katalogu siniflandirir', async () => {
  const { onUcus, sonuc, yurutucu } = await calistir();
  assert.equal(onUcus.gecti, true);
  assert.equal(sonuc?.status, 'tamamlandi');

  const c = sonuc!.outputs.g as {
    uretimTablo: number; depoTablo: number; gocDosyasi: number;
    bulgular: Array<{ nesne: string; sinif: string; suAnSomurulebilir: boolean }>;
  };
  assert.equal(c.uretimTablo, 3);
  assert.ok(c.gocDosyasi > 50, 'gercek goc dosyalari okunmali');
  assert.ok(c.depoTablo > 30, 'gercek depo tablolari cikarilmali');

  const oh = c.bulgular.find((b) => b.nesne.includes('Ohaaaa.com'));
  assert.ok(oh, 'Ohaaaa.com bulgusu uretilmeli');
  assert.equal(oh!.sinif, 'gizli_yetki_riski');
  assert.equal(oh!.suAnSomurulebilir, false);

  /* Uretilen HER SQL sabit kumeden. */
  const sabitler = new Set<string>(Object.values(SORGULAR).map((s) => s.sql));
  for (const cg of yurutucu.cagrilar) assert.ok(sabitler.has(cg.sql));
});

test('ZINCIR: uyumlu tablo bulgu listesine GIRMEZ', async () => {
  const { sonuc } = await calistir();
  const c = sonuc!.outputs.g as { bulgular: Array<{ nesne: string }> };
  assert.equal(c.bulgular.some((b) => b.nesne.includes('products')), false);
  assert.equal(c.bulgular.some((b) => b.nesne.includes('jobs')), false);
});

test('VALIDATOR: olcumu bagimsiz yeniden turetir', async () => {
  const { sonuc } = await calistir();
  const c = sonuc!.outputs.g as { bulgular: unknown[] };

  /* Farkli yol: dogrulayici kendi yurutucusuyle yeniden okur. */
  const y2 = new OlculmusYurutucu();
  const tablolar = await y2.sorgula(SORGULAR.schema_tables.sql, []);
  const bagimsiz = [];
  for (const t of tablolar as unknown as UretimTablo[]) {
    const g = await y2.sorgula(SORGULAR.table_grants.sql, [t.tablo]);
    const b = siniflandir(t, ['products', 'jobs'].includes(t.tablo),
                          g as unknown as UretimYetki[]);
    if (dikkatGerektirir(b)) bagimsiz.push(b);
  }
  assert.deepEqual(bagimsiz, c.bulgular);

  const k = dogrula(
    { agentId: 'schema-drift-auditor', cikti: c, guven: 0.85,
      kanitlar: [{ kaynak: 'read_db', gozlem: 'katalog okundu', at: Date.now() }],
      etki: 'orta' },
    'schema-drift-validator', { gecti: true },
  );
  assert.equal(k.gecti, true);
});

test('VALIDATOR REDDI: olcumler ortusmezse gecmez', () => {
  const k = dogrula(
    { agentId: 'schema-drift-auditor', cikti: {}, guven: 0.85,
      kanitlar: [{ kaynak: 'read_db', gozlem: 'x', at: Date.now() }], etki: 'orta' },
    'schema-drift-validator', { gecti: false, aciklama: 'bulgular ortusmuyor' },
  );
  assert.equal(k.gecti, false);
});

test('VALIDATOR REDDI: ajan kendi dogrulayicisi olamaz', () => {
  const k = dogrula(
    { agentId: 'schema-drift-auditor', cikti: {}, guven: 0.85,
      kanitlar: [{ kaynak: 'read_db', gozlem: 'x', at: Date.now() }], etki: 'orta' },
    'schema-drift-auditor', { gecti: true },
  );
  assert.equal(k.gecti, false);
  if (!k.gecti) assert.ok(k.redler.some((r) => r.kod === 'kendi_kendini_dogrulama'));
});

test('AUDITOR: duzgun zincir onaylanir, izsiz zincir REDDEDILIR', async () => {
  const a = new SupremeAuditor();
  const is = { agentId: 'schema-drift-auditor', cikti: {}, guven: 0.85,
               kanitlar: [{ kaynak: 'read_db', gozlem: 'x', at: Date.now() }],
               etki: 'orta' as const };
  const dk = { validatorId: 'schema-drift-validator', karar: { gecti: true as const },
               at: Date.now() };
  assert.equal(a.denetleIs(is, [dk], []).onaylandi, false);

  const { orchestrator, depo } = await calistir();
  await orchestrator.izeYaz({
    taskId: 'g', agentId: 'schema-drift-auditor', at: Date.now(),
    araclar: ['read_db', 'read_repo'], eylem: 'sema sapmasi denetimi',
    girdiOzeti: 'schema_tables+table_grants', ciktiOzeti: 'dikkat=1',
    guven: 0.85,
    kanitlar: [{ kaynak: 'read_db', gozlem: 'katalog okundu', at: Date.now() }],
    dogrulayan: 'schema-drift-validator', denetleyen: 'supreme-auditor',
    onaylayan: null, durum: 'uygulandi',
  });
  const iz = await depo.gorevIzi('g');
  assert.equal(a.denetleIs(is, [dk], iz).onaylandi, true);
});

test('AUDIT: kayitta sir/kimlik/PII YOK', async () => {
  const { orchestrator, depo } = await calistir();
  await orchestrator.izeYaz({
    taskId: 'g2', agentId: 'schema-drift-auditor', at: Date.now(),
    araclar: ['read_db'], eylem: 'denetim',
    girdiOzeti: 'schema_tables', ciktiOzeti: 'dikkat=1 sinif=gizli_yetki_riski',
    guven: 0.85,
    kanitlar: [{ kaynak: 'read_db', gozlem: 'anon yazma: DELETE,INSERT,UPDATE', at: Date.now() }],
    dogrulayan: 'schema-drift-validator', denetleyen: 'supreme-auditor',
    onaylayan: null, durum: 'uygulandi',
  });
  const iz = await depo.gorevIzi('g2');
  const metin = JSON.stringify(iz).toLowerCase();
  for (const y of ['password', 'secret', 'token', 'postgresql://', 'eyj']) {
    assert.equal(metin.includes(y), false, `${y} ize sizmis`);
  }
});

test('SAGLIK: basarili calistirma saglikli birakir, guven sapmasi negatif', async () => {
  const { orchestrator, sonuc } = await calistir();
  const s = orchestrator.ajanSagligi('schema-drift-auditor');
  s.isle({ basarili: true, dogrulamaReddi: false, guven: 0.85, gercektenDogru: true,
           denemeler: 1, sureMs: sonuc!.steps[0]!.durationMs, maliyetKurus: 0 });
  assert.equal(s.durum, 'saglikli');
  assert.ok((s.ozet.guvenSapmasi ?? 0) < 0);
});

test('SAGLIK: tekrarlayan yanlis pozitif KARANTINAYA gotururur', async () => {
  const { registry } = uretimDefteriniKur({
    kokDizin: KOK, metadataYurutucu: new OlculmusYurutucu(),
  });
  const o = new SupremeOrchestrator(registry);
  const s = o.ajanSagligi('schema-drift-auditor');
  for (let i = 0; i < 10; i++) {
    s.isle({ basarili: false, dogrulamaReddi: true, guven: 0.85, gercektenDogru: false,
             denemeler: 1, sureMs: 10, maliyetKurus: 0 });
  }
  assert.equal(s.durum, 'karantina');
  const { onUcus, sonuc } = await o.calistir('TR', [{ id: 'g', capability: DRIFT_YETENEGI }]);
  assert.equal(onUcus.gecti, false);
  assert.equal(sonuc, null);
  assert.equal(onUcus.engeller[0]?.kod, 'ajan_karantinada');
});

test('DUZELTME YOK: ajan hicbir yazma araci CAGIRAMAZ', async () => {
  const { yurutucu } = await calistir();
  /* Uretilen her SQL select ile basliyor; yazma ifadesi hic uretilmedi. */
  for (const c of yurutucu.cagrilar) {
    assert.match(c.sql.trim(), /^select/i);
    assert.equal(/\b(insert|update|delete|drop|alter|grant|revoke|truncate)\b/i.test(c.sql),
                 false);
  }
});

test('izin disi arac cagrisi REDDEDILIR', async () => {
  const { araclar } = uretimDefteriniKur({
    kokDizin: KOK, metadataYurutucu: new OlculmusYurutucu(),
  });
  const { aracCalistir } = await import('../tools/contract.js');
  await assert.rejects(
    aracCalistir(araclar.get('read_db')!, { sorgu: 'schema_tables' }, {
      agentId: 'schema-drift-auditor',
      izinliAraclar: new Set(['read_repo' as const]),
      guvenliMod: false, kalanMs: 5000, log: () => {},
    }),
    (e) => e instanceof ToolHatasi && e.kod === 'izin_yok',
  );
});
