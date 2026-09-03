/**
 * Çok ajanlı yürütme motorunun sözleşmeleri.
 *
 * NEDEN LLM YOK
 * Orchestrator bir dil modeli DEĞİLDİR; koordinasyon mantığıdır. Hangi
 * ajanın ne zaman, hangi girdiyle, hangi bütçeyle çalışacağına karar
 * verir. Ajanların KENDİSİ bir model çağırabilir -- ama motorun çalışması
 * için bu gerekmez.
 *
 * Bu ayrım kasıtlı ve pratik sonucu şu: motor bugün, `ANTHROPIC_API_KEY`
 * gelmeden, gerçek girdilerle test edilebiliyor. Anahtar geldiğinde
 * değişen tek şey bir ajanın gövdesi olacak; zamanlama, yeniden deneme,
 * bütçe ve izin mantığı yeniden yazılmayacak.
 */

import type { Market } from '../market.js';

/** 12 Süpervizör. Ajanlar bunlardan birine ait olmak zorunda. */
export const SUPERVISORS = [
  'ai_brain',
  'global_governor',
  'seo',
  'ads',
  'marketing',
  'revenue',
  'commerce',
  'automotive',
  'travel_local',
  'merchant',
  'intelligence',
  'risk_quality',
] as const;

export type SupervisorId = (typeof SUPERVISORS)[number];

/**
 * Bir ajanın erişebileceği araçlar.
 *
 * İzinler ADLA değil YETENEKLE verilir ve ajanın kendisi bu listeyi
 * genişletemez: `AgentContext` yalnızca burada yazan araçları taşır.
 * Bir sıralama ajanının ödeme aracına erişmesi için önce kaydının
 * değişmesi gerekir -- çalışma anında yetki yükseltmesi mümkün değil.
 */
export type ToolName =
  | 'read_catalog'
  | 'read_price_history'
  | 'read_merchant'
  | 'read_market_config'
  | 'read_revenue'
  | 'write_agent_decision'
  | 'call_model';

export interface AgentContext {
  /** Bu görevin pazarı. Ajan başka pazarın verisini istememeli. */
  market: Market;
  /** Yalnızca izin verilen araçlar. Liste dışına çıkmak tip hatası. */
  tools: ReadonlySet<ToolName>;
  /** Orchestrator'ın verdiği kalan süre; ajan buna saygı göstermeli. */
  deadline: number;
  /** Bağımlı olduğu adımların çıktıları. */
  inputs: Readonly<Record<string, unknown>>;
  /** Yapılandırılmış telemetri; PII yazılmaz. */
  log(event: string, data?: Record<string, unknown>): void;
}

export interface AgentResult<O = unknown> {
  output: O;
  /**
   * Ajanın kendi sonucuna güveni (0–1).
   *
   * ZORUNLU ve bu kasıtlı: güven bildirmeyen bir ajanın çıktısı,
   * doğrulanmış bir gerçekle aynı ağırlıkta muamele görürdü. Madde 22
   * tam olarak bunu yasaklıyor -- model çıktısı gerçek kabul edilemez.
   */
  confidence: number;
  /** Sonucun neye dayandığı. Boş bırakmak "kanıtım yok" demektir. */
  evidence?: string[];
}

export interface AgentDefinition<I = unknown, O = unknown> {
  id: string;
  supervisor: SupervisorId;
  /** Bu ajanın sağladığı yetenekler. Seçim ADLA değil bununla yapılır. */
  capabilities: string[];
  allowedTools: readonly ToolName[];
  timeoutMs: number;
  maxRetries: number;
  /** 'all' ya da yalnızca belirli pazarlar. Pazar izolasyonunun ajan ucu. */
  marketScope: 'all' | readonly Market[];
  enabled: boolean;
  run(input: I, ctx: AgentContext): Promise<AgentResult<O>>;
}

/** Yürütme grafiğinin bir düğümü. */
export interface TaskNode {
  id: string;
  /** Hangi yetenek gerekiyor. Ajan buna göre seçilir. */
  capability: string;
  input?: unknown;
  /** Bu adımdan ÖNCE bitmesi gereken adımlar. */
  dependsOn?: readonly string[];
  /**
   * Bu adım başarısız olursa tüm orchestration düşsün mü?
   *
   * Varsayılan `true`. İkincil bir adımın (ör. öneri zenginleştirme)
   * çökmesi yüzünden kullanıcının aramasını tamamen kaybetmek yanlış
   * takas olurdu.
   */
  required?: boolean;
}

export interface OrchestrationBudget {
  maxAgents: number;
  maxSteps: number;
  maxRuntimeMs: number;
}

export interface TelemetryEvent {
  event: string;
  at: number;
  taskId?: string;
  agentId?: string;
  data?: Record<string, unknown>;
}

export type OrchestrationStatus =
  | 'tamamlandi'
  | 'kismi'
  | 'basarisiz'
  | 'butce_asildi';

export interface StepResult {
  taskId: string;
  agentId: string | null;
  status: 'tamamlandi' | 'basarisiz' | 'atlandi' | 'zaman_asimi';
  output?: unknown;
  confidence?: number;
  evidence?: string[];
  attempts: number;
  durationMs: number;
  error?: string;
}

export interface OrchestrationResult {
  status: OrchestrationStatus;
  market: Market;
  steps: StepResult[];
  outputs: Record<string, unknown>;
  telemetry: TelemetryEvent[];
  agentsUsed: number;
  durationMs: number;
  error?: string;
}
