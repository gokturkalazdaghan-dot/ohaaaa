import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AgentRegistry } from './registry.js';
import { orchestrate, planLayers } from './orchestrator.js';
import type { AgentDefinition, AgentResult, ToolName } from './types.js';

/** Test ajanı üreticisi — gövdesi çağıran tarafından verilir. */
function ajan(
  over: Partial<AgentDefinition> & { id: string; capabilities: string[] },
): AgentDefinition {
  return {
    supervisor: 'commerce',
    allowedTools: ['read_catalog'] as ToolName[],
    timeoutMs: 1000,
    maxRetries: 0,
    marketScope: 'all',
    enabled: true,
    async run(): Promise<AgentResult> {
      return { output: over.id, confidence: 1 };
    },
    ...over,
  };
}

// --- Planlama -------------------------------------------------------------

test('bağımsız adımlar aynı katmana düşer', () => {
  const katmanlar = planLayers([
    { id: 'a', capability: 'x' },
    { id: 'b', capability: 'y' },
    { id: 'c', capability: 'z', dependsOn: ['a', 'b'] },
  ]);
  assert.equal(katmanlar.length, 2);
  assert.deepEqual(katmanlar[0]!.map((t) => t.id).sort(), ['a', 'b']);
  assert.deepEqual(katmanlar[1]!.map((t) => t.id), ['c']);
});

test('zincirleme bağımlılık ayrı katmanlar üretir', () => {
  const katmanlar = planLayers([
    { id: 'a', capability: 'x' },
    { id: 'b', capability: 'y', dependsOn: ['a'] },
    { id: 'c', capability: 'z', dependsOn: ['b'] },
  ]);
  assert.equal(katmanlar.length, 3);
});

/*
 * DÖNGÜ PLANLAMA ANINDA REDDEDİLİR.
 *
 * Çalışma anında adım sayacıyla da yakalanabilirdi ama o, bütçeyi
 * tüketip "bütçe aşıldı" demek olurdu -- gerçek sebebi (grafik bozuk)
 * gizleyen bir mesaj.
 */
test('döngü planlama anında reddedilir', () => {
  assert.throws(
    () =>
      planLayers([
        { id: 'a', capability: 'x', dependsOn: ['b'] },
        { id: 'b', capability: 'y', dependsOn: ['a'] },
      ]),
    /döngü/i,
  );
});

test('tanımsız bağımlılık reddedilir', () => {
  assert.throws(
    () => planLayers([{ id: 'a', capability: 'x', dependsOn: ['yok'] }]),
    /tanımsız/i,
  );
});

// --- Yetenek yönlendirmesi ------------------------------------------------

test('ajan ADLA değil YETENEKLE seçilir', async () => {
  const r = new AgentRegistry();
  r.register(ajan({ id: 'fiyat-v3', capabilities: ['fiyat_analizi'] }));

  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [{ id: 'f', capability: 'fiyat_analizi' }],
  });

  assert.equal(sonuc.status, 'tamamlandi');
  assert.equal(sonuc.steps[0]!.agentId, 'fiyat-v3');
});

test('yeteneği sağlayan ajan yoksa adım başarısız', async () => {
  const sonuc = await orchestrate({
    market: 'TR',
    registry: new AgentRegistry(),
    tasks: [{ id: 'f', capability: 'olmayan' }],
  });
  assert.equal(sonuc.status, 'basarisiz');
  assert.match(sonuc.steps[0]!.error!, /etkin ajan yok/);
});

/*
 * BELİRSİZLİK SESSİZCE ÇÖZÜLMEZ.
 *
 * "İlkini al" demek, hangi ajanın çalıştığını kayıt sırasına bağlamaktır
 * -- ve iki ajanın aynı yeteneği iddia etmesi çözülmesi gereken bir
 * yapılandırma hatasıdır, çalışma anında kura çekilecek bir durum değil.
 */
test('aynı yeteneği iki ajan sağlıyorsa hata verir', () => {
  const r = new AgentRegistry();
  r.register(ajan({ id: 'a1', capabilities: ['siralama'] }));
  r.register(ajan({ id: 'a2', capabilities: ['siralama'] }));
  assert.throws(() => r.resolve('siralama', 'TR'), /birden çok ajan/);
});

test('aynı kimlikle ikinci kayıt reddedilir', () => {
  const r = new AgentRegistry();
  r.register(ajan({ id: 'x', capabilities: ['a'] }));
  assert.throws(() => r.register(ajan({ id: 'x', capabilities: ['b'] })), /zaten kayıtlı/);
});

// --- Pazar izolasyonu -----------------------------------------------------

test('pazar kapsamı dışındaki ajan SEÇİLMEZ', async () => {
  const r = new AgentRegistry();
  r.register(ajan({ id: 'sadece-de', capabilities: ['fiyat'], marketScope: ['DE'] }));

  const tr = await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [{ id: 'f', capability: 'fiyat' }],
  });
  assert.equal(tr.status, 'basarisiz');

  const de = await orchestrate({
    market: 'DE',
    registry: r,
    tasks: [{ id: 'f', capability: 'fiyat' }],
  });
  assert.equal(de.status, 'tamamlandi');
});

test('devre dışı ajan seçilmez', async () => {
  const r = new AgentRegistry();
  r.register(ajan({ id: 'kapali', capabilities: ['fiyat'], enabled: false }));
  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [{ id: 'f', capability: 'fiyat' }],
  });
  assert.equal(sonuc.status, 'basarisiz');
});

// --- İzin sınırı ----------------------------------------------------------

/*
 * Ajan bağlamdaki araç kümesini GENİŞLETEMEZ. Kayıt defterinde ne
 * yazıyorsa onu alır; çalışma anında yetki yükseltmesi yok.
 */
test('ajan yalnızca izin verilen araçları görür', async () => {
  const r = new AgentRegistry();
  let gorulen: string[] = [];

  r.register(
    ajan({
      id: 'sinirli',
      capabilities: ['oku'],
      allowedTools: ['read_catalog'],
      async run(_i, ctx) {
        gorulen = [...ctx.tools];
        return { output: null, confidence: 1 };
      },
    }),
  );

  await orchestrate({ market: 'TR', registry: r, tasks: [{ id: 't', capability: 'oku' }] });

  assert.deepEqual(gorulen, ['read_catalog']);
  assert.ok(!gorulen.includes('call_model'));
  assert.ok(!gorulen.includes('read_revenue'));
});

// --- Paralellik ve bağımlılık --------------------------------------------

test('aynı katmandaki adımlar paralel çalışır', async () => {
  const r = new AgentRegistry();
  let esZamanli = 0;
  let enYuksek = 0;

  for (const id of ['p1', 'p2', 'p3']) {
    r.register(
      ajan({
        id,
        capabilities: [id],
        async run() {
          esZamanli += 1;
          enYuksek = Math.max(enYuksek, esZamanli);
          await new Promise((res) => setTimeout(res, 20));
          esZamanli -= 1;
          return { output: id, confidence: 1 };
        },
      }),
    );
  }

  await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [
      { id: 'p1', capability: 'p1' },
      { id: 'p2', capability: 'p2' },
      { id: 'p3', capability: 'p3' },
    ],
  });

  // Sırayla çalışsalardı en yüksek eşzamanlılık 1 olurdu.
  assert.equal(enYuksek, 3);
});

test('bağımlı adım öncekinin çıktısını girdi olarak alır', async () => {
  const r = new AgentRegistry();
  let alinan: unknown;

  r.register(ajan({ id: 'ilk', capabilities: ['ilk'], async run() {
    return { output: { fiyat: 1200 }, confidence: 1 };
  } }));
  r.register(ajan({ id: 'ikinci', capabilities: ['ikinci'], async run(_i, ctx) {
    alinan = ctx.inputs['a'];
    return { output: null, confidence: 1 };
  } }));

  await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [
      { id: 'a', capability: 'ilk' },
      { id: 'b', capability: 'ikinci', dependsOn: ['a'] },
    ],
  });

  assert.deepEqual(alinan, { fiyat: 1200 });
});

// --- Zaman aşımı ve yeniden deneme ---------------------------------------

test('zaman aşımına uğrayan ajan adımı düşürür', async () => {
  const r = new AgentRegistry();
  r.register(
    ajan({
      id: 'yavas',
      capabilities: ['yavas'],
      timeoutMs: 20,
      async run() {
        await new Promise((res) => setTimeout(res, 200));
        return { output: 'gec', confidence: 1 };
      },
    }),
  );

  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [{ id: 't', capability: 'yavas' }],
  });

  assert.equal(sonuc.steps[0]!.status, 'zaman_asimi');
  assert.ok(sonuc.telemetry.some((e) => e.event === 'agent_timeout'));
});

test('geçici hata yeniden denenir ve başarılı olabilir', async () => {
  const r = new AgentRegistry();
  let deneme = 0;

  r.register(
    ajan({
      id: 'kararsiz',
      capabilities: ['kararsiz'],
      maxRetries: 2,
      async run() {
        deneme += 1;
        if (deneme < 3) throw new Error('gecici');
        return { output: 'nihayet', confidence: 0.9 };
      },
    }),
  );

  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [{ id: 't', capability: 'kararsiz' }],
  });

  assert.equal(sonuc.status, 'tamamlandi');
  assert.equal(sonuc.steps[0]!.attempts, 3);
  assert.equal(sonuc.outputs['t'], 'nihayet');
});

test('deneme hakkı bitince adım başarısız', async () => {
  const r = new AgentRegistry();
  r.register(
    ajan({
      id: 'hep-bozuk',
      capabilities: ['bozuk'],
      maxRetries: 1,
      async run() {
        throw new Error('kalici');
      },
    }),
  );

  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [{ id: 't', capability: 'bozuk' }],
  });

  assert.equal(sonuc.status, 'basarisiz');
  assert.equal(sonuc.steps[0]!.attempts, 2);
});

// --- Zorunlu / isteğe bağlı adım -----------------------------------------

/*
 * İkincil bir adımın çökmesi yüzünden kullanıcının aramasını tamamen
 * kaybetmek yanlış takas. `required: false` bunu ayırıyor.
 */
test('isteğe bağlı adım düşerse orchestration KISMİ tamamlanır', async () => {
  const r = new AgentRegistry();
  r.register(ajan({ id: 'ana', capabilities: ['ana'] }));
  r.register(ajan({ id: 'ek', capabilities: ['ek'], async run() {
    throw new Error('ikincil hata');
  } }));

  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [
      { id: 'a', capability: 'ana' },
      { id: 'b', capability: 'ek', required: false },
    ],
  });

  assert.equal(sonuc.status, 'kismi');
  assert.equal(sonuc.outputs['a'], 'ana');
  assert.equal(sonuc.outputs['b'], undefined);
});

test('zorunlu adım düşerse sonraki katmanlar çalışmaz', async () => {
  const r = new AgentRegistry();
  let sonrakiCalisti = false;

  r.register(ajan({ id: 'ilk', capabilities: ['ilk'], async run() {
    throw new Error('cokti');
  } }));
  r.register(ajan({ id: 'sonraki', capabilities: ['sonraki'], async run() {
    sonrakiCalisti = true;
    return { output: null, confidence: 1 };
  } }));

  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [
      { id: 'a', capability: 'ilk' },
      { id: 'b', capability: 'sonraki', dependsOn: ['a'] },
    ],
  });

  assert.equal(sonuc.status, 'basarisiz');
  // Eksik girdiyle üretilen bir sonuç, hiç sonuç üretmemekten kötüdür.
  assert.equal(sonrakiCalisti, false);
});

// --- Bütçe ----------------------------------------------------------------

test('adım bütçesi AŞILIRSA hiçbir adım çalıştırılmaz', async () => {
  const r = new AgentRegistry();
  let calisti = false;
  r.register(ajan({ id: 'a', capabilities: ['a'], async run() {
    calisti = true;
    return { output: null, confidence: 1 };
  } }));

  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    budget: { maxSteps: 1 },
    tasks: [
      { id: '1', capability: 'a' },
      { id: '2', capability: 'a' },
    ],
  });

  assert.equal(sonuc.status, 'butce_asildi');
  // Yarısını çalıştırıp sonra reddetmek, yan etkileri yapılmış ama
  // sonucu kullanılamayacak bir orchestration bırakırdı.
  assert.equal(calisti, false);
});

test('ajan bütçesi dolunca yeni ajan çalıştırılmaz', async () => {
  const r = new AgentRegistry();
  r.register(ajan({ id: 'a1', capabilities: ['c1'] }));
  r.register(ajan({ id: 'a2', capabilities: ['c2'] }));

  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    budget: { maxAgents: 1 },
    tasks: [
      { id: 't1', capability: 'c1' },
      { id: 't2', capability: 'c2' },
    ],
  });

  const atlanan = sonuc.steps.filter((s) => s.status === 'atlandi');
  assert.equal(atlanan.length, 1);
  assert.equal(sonuc.agentsUsed, 1);
});

test('süre bütçesi aşılınca sonraki katman çalışmaz', async () => {
  const r = new AgentRegistry();
  r.register(ajan({ id: 'a', capabilities: ['a'] }));
  r.register(ajan({ id: 'b', capabilities: ['b'] }));

  // Sahte saat: her okumada 10 saniye ilerliyor.
  let t = 0;
  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    budget: { maxRuntimeMs: 5_000 },
    now: () => (t += 10_000),
    tasks: [
      { id: 'x', capability: 'a' },
      { id: 'y', capability: 'b', dependsOn: ['x'] },
    ],
  });

  assert.equal(sonuc.status, 'butce_asildi');
});

// --- Telemetri ------------------------------------------------------------

test('orchestration telemetrisi başlangıç ve bitişi kaydeder', async () => {
  const r = new AgentRegistry();
  r.register(ajan({ id: 'a', capabilities: ['a'] }));

  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [{ id: 't', capability: 'a' }],
  });

  const olaylar = sonuc.telemetry.map((e) => e.event);
  assert.ok(olaylar.includes('orchestration_started'));
  assert.ok(olaylar.includes('agent_started'));
  assert.ok(olaylar.includes('agent_completed'));
  assert.ok(olaylar.includes('orchestration_completed'));
});

test('güven değeri sonuca taşınır', async () => {
  const r = new AgentRegistry();
  r.register(ajan({ id: 'a', capabilities: ['a'], async run() {
    return { output: 'x', confidence: 0.42, evidence: ['3 olcum'] };
  } }));

  const sonuc = await orchestrate({
    market: 'TR',
    registry: r,
    tasks: [{ id: 't', capability: 'a' }],
  });

  assert.equal(sonuc.steps[0]!.confidence, 0.42);
  assert.deepEqual(sonuc.steps[0]!.evidence, ['3 olcum']);
});
