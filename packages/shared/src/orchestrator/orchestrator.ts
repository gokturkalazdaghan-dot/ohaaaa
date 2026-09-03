/**
 * Yürütme motoru.
 *
 * NE YAPAR
 * Bir görev grafiğini alır, bağımlılıkları çözer, bağımsız adımları
 * PARALEL çalıştırır, her adımı kendi zaman aşımı ve yeniden deneme
 * bütçesiyle yürütür, döngüleri reddeder ve toplam bütçeyi zorlar.
 *
 * NE YAPMAZ
 * İşin kendisini yapmaz. Fiyat analizi, sıralama, doğrulama -- hepsi
 * ajanların işi. Orchestrator'ın tek işi KİMİN, NE ZAMAN, HANGİ
 * SINIRLARLA çalışacağına karar vermek.
 */

import type { Market } from '../market.js';
import type { AgentRegistry } from './registry.js';
import type {
  AgentContext,
  OrchestrationBudget,
  OrchestrationResult,
  StepResult,
  TaskNode,
  TelemetryEvent,
  ToolName,
} from './types.js';

export const VARSAYILAN_BUTCE: OrchestrationBudget = {
  maxAgents: 12,
  maxSteps: 24,
  maxRuntimeMs: 30_000,
};

export interface OrchestrateOptions {
  market: Market;
  tasks: readonly TaskNode[];
  registry: AgentRegistry;
  budget?: Partial<OrchestrationBudget>;
  /** Test edilebilirlik için enjekte edilir; üretimde `Date.now`. */
  now?: () => number;
}

/**
 * Grafiği katmanlara ayırır: her katman, önceki katmanlar bittiğinde
 * PARALEL çalışabilecek adımlardır.
 *
 * Döngü tespiti burada yapılıyor ve hata fırlatıyor. Döngüyü çalışma
 * anında adım sayacıyla yakalamak da mümkündü ama o, bütçeyi tüketip
 * "bütçe aşıldı" demek olurdu -- gerçek sebebi (grafik bozuk) gizleyen
 * bir mesaj.
 */
export function planLayers(tasks: readonly TaskNode[]): TaskNode[][] {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  for (const task of tasks) {
    for (const dep of task.dependsOn ?? []) {
      if (!byId.has(dep)) {
        throw new Error(`"${task.id}" tanımsız bir adıma bağlı: "${dep}"`);
      }
    }
  }

  const kalan = new Map(byId);
  const tamamlanan = new Set<string>();
  const katmanlar: TaskNode[][] = [];

  while (kalan.size > 0) {
    const hazir = [...kalan.values()].filter((t) =>
      (t.dependsOn ?? []).every((d) => tamamlanan.has(d)),
    );

    if (hazir.length === 0) {
      // Hiçbir adım hazır değilse kalanların bağımlılıkları birbirine
      // dönüyor demektir.
      throw new Error(
        'Görev grafiğinde döngü var: ' + [...kalan.keys()].join(' → '),
      );
    }

    katmanlar.push(hazir);
    for (const t of hazir) {
      kalan.delete(t.id);
      tamamlanan.add(t.id);
    }
  }

  return katmanlar;
}

/** Bir sözü zaman aşımına bağlar. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    /*
     * Zamanlayıcı temizlenmezse Node süreci, iş bittiği hâlde zaman aşımı
     * dolana kadar canlı kalır. Testlerde bu, paketin dakikalarca asılı
     * kalması demek olurdu.
     */
    const t = setTimeout(() => reject(new Error('zaman_asimi')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export async function orchestrate(
  options: OrchestrateOptions,
): Promise<OrchestrationResult> {
  const { market, tasks, registry } = options;
  const now = options.now ?? Date.now;
  const butce = { ...VARSAYILAN_BUTCE, ...options.budget };

  const baslangic = now();
  const telemetry: TelemetryEvent[] = [];
  const steps: StepResult[] = [];
  const outputs: Record<string, unknown> = {};
  const kullanilanAjanlar = new Set<string>();

  const kaydet = (event: string, data?: Record<string, unknown>) => {
    telemetry.push({ event, at: now(), ...(data ? { data } : {}) });
  };

  kaydet('orchestration_started', { market, taskCount: tasks.length });

  // --- Bütçe: adım sayısı GRAFİK ÇALIŞMADAN ÖNCE kontrol edilir --------
  // Yarısına kadar çalıştırıp sonra "bütçe aşıldı" demek, yan etkileri
  // yapılmış ama sonucu kullanılamayacak bir orchestration bırakırdı.
  if (tasks.length > butce.maxSteps) {
    kaydet('orchestration_rejected', { reason: 'max_steps', limit: butce.maxSteps });
    return {
      status: 'butce_asildi',
      market,
      steps: [],
      outputs: {},
      telemetry,
      agentsUsed: 0,
      durationMs: now() - baslangic,
      error: `Adım sayısı bütçeyi aşıyor: ${tasks.length} > ${butce.maxSteps}`,
    };
  }

  let katmanlar: TaskNode[][];
  try {
    katmanlar = planLayers(tasks);
  } catch (error) {
    const mesaj = error instanceof Error ? error.message : String(error);
    kaydet('orchestration_failed', { reason: 'plan', error: mesaj });
    return {
      status: 'basarisiz',
      market,
      steps: [],
      outputs: {},
      telemetry,
      agentsUsed: 0,
      durationMs: now() - baslangic,
      error: mesaj,
    };
  }

  let zorunluDustu = false;
  let isteğeBagliDustu = false;

  for (const katman of katmanlar) {
    if (now() - baslangic > butce.maxRuntimeMs) {
      kaydet('orchestration_rejected', { reason: 'max_runtime' });
      return {
        status: 'butce_asildi',
        market,
        steps,
        outputs,
        telemetry,
        agentsUsed: kullanilanAjanlar.size,
        durationMs: now() - baslangic,
        error: 'Toplam süre bütçesi aşıldı.',
      };
    }

    /*
     * KATMAN İÇİ PARALELLİK.
     *
     * Aynı katmandaki adımlar birbirine bağlı değildir; sırayla
     * çalıştırmak toplam süreyi adım sayısıyla çarpardı. Ürün ve fiyat
     * analizi aynı anda yapılabiliyorken kullanıcıyı iki kat bekletmek
     * için bir sebep yok.
     */
    const sonuclar = await Promise.all(
      katman.map((task) =>
        adimiCalistir({
          task,
          market,
          registry,
          outputs,
          butce,
          kullanilanAjanlar,
          now,
          kaydet,
        }),
      ),
    );

    for (const sonuc of sonuclar) {
      steps.push(sonuc);
      const task = katman.find((t) => t.id === sonuc.taskId)!;

      if (sonuc.status === 'tamamlandi') {
        outputs[sonuc.taskId] = sonuc.output;
      } else if (task.required === false) {
        isteğeBagliDustu = true;
      } else {
        zorunluDustu = true;
      }
    }

    // Zorunlu bir adım düştüyse SONRAKİ katmanlar çalıştırılmaz: onların
    // girdisi zaten eksik olurdu ve eksik girdiyle üretilen bir sonuç,
    // hiç sonuç üretmemekten kötüdür.
    if (zorunluDustu) break;
  }

  const status = zorunluDustu ? 'basarisiz' : isteğeBagliDustu ? 'kismi' : 'tamamlandi';

  kaydet('orchestration_completed', { status, agentsUsed: kullanilanAjanlar.size });

  return {
    status,
    market,
    steps,
    outputs,
    telemetry,
    agentsUsed: kullanilanAjanlar.size,
    durationMs: now() - baslangic,
  };
}

async function adimiCalistir(args: {
  task: TaskNode;
  market: Market;
  registry: AgentRegistry;
  outputs: Record<string, unknown>;
  butce: OrchestrationBudget;
  kullanilanAjanlar: Set<string>;
  now: () => number;
  kaydet: (event: string, data?: Record<string, unknown>) => void;
}): Promise<StepResult> {
  const { task, market, registry, outputs, butce, kullanilanAjanlar, now, kaydet } = args;
  const basladi = now();

  let agent;
  try {
    agent = registry.resolve(task.capability, market);
  } catch (error) {
    const mesaj = error instanceof Error ? error.message : String(error);
    kaydet('agent_unresolved', { taskId: task.id, error: mesaj });
    return {
      taskId: task.id,
      agentId: null,
      status: 'basarisiz',
      attempts: 0,
      durationMs: now() - basladi,
      error: mesaj,
    };
  }

  // Ajan bütçesi: farklı ajan sayısı sınırlı. Aynı ajanın birden çok
  // adımda kullanılması bütçeyi tüketmez -- sınırlanan çeşitlilik değil,
  // sistemin ne kadar yayıldığı.
  if (!kullanilanAjanlar.has(agent.id) && kullanilanAjanlar.size >= butce.maxAgents) {
    kaydet('agent_rejected', { taskId: task.id, reason: 'max_agents' });
    return {
      taskId: task.id,
      agentId: agent.id,
      status: 'atlandi',
      attempts: 0,
      durationMs: now() - basladi,
      error: 'Ajan bütçesi doldu.',
    };
  }
  kullanilanAjanlar.add(agent.id);

  const girdiler: Record<string, unknown> = {};
  for (const dep of task.dependsOn ?? []) girdiler[dep] = outputs[dep];

  const ctx: AgentContext = {
    market,
    // İZİN SINIRI BURADA ÇİZİLİR. Ajan bu kümeyi genişletemez; kayıt
    // defterinde ne yazıyorsa onu alır.
    tools: new Set<ToolName>(agent.allowedTools),
    deadline: basladi + agent.timeoutMs,
    inputs: girdiler,
    log: (event, data) => kaydet(event, { agentId: agent!.id, taskId: task.id, ...data }),
  };

  let sonHata = '';
  const denemeSayisi = Math.max(1, agent.maxRetries + 1);

  for (let deneme = 1; deneme <= denemeSayisi; deneme += 1) {
    kaydet('agent_started', { taskId: task.id, agentId: agent.id, attempt: deneme });

    try {
      const sonuc = await withTimeout(agent.run(task.input, ctx), agent.timeoutMs);

      kaydet('agent_completed', {
        taskId: task.id,
        agentId: agent.id,
        confidence: sonuc.confidence,
      });

      return {
        taskId: task.id,
        agentId: agent.id,
        status: 'tamamlandi',
        output: sonuc.output,
        confidence: sonuc.confidence,
        evidence: sonuc.evidence,
        attempts: deneme,
        durationMs: now() - basladi,
      };
    } catch (error) {
      sonHata = error instanceof Error ? error.message : String(error);
      const zamanAsimi = sonHata === 'zaman_asimi';

      kaydet(zamanAsimi ? 'agent_timeout' : 'agent_failed', {
        taskId: task.id,
        agentId: agent.id,
        attempt: deneme,
        error: sonHata,
      });

      if (deneme < denemeSayisi) {
        kaydet('agent_retry', { taskId: task.id, agentId: agent.id, attempt: deneme + 1 });
      }
    }
  }

  return {
    taskId: task.id,
    agentId: agent.id,
    status: sonHata === 'zaman_asimi' ? 'zaman_asimi' : 'basarisiz',
    attempts: denemeSayisi,
    durationMs: now() - basladi,
    error: sonHata,
  };
}
