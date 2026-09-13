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

/**
 * ALAN SÜPERVİZÖRLERİ. Her ajan bunlardan birine ait olmak zorunda.
 *
 * LİSTE SİSTEMDEN TÜRETİLDİ, İLERİYE DÖNÜK YAZILMADI.
 *
 * Önceki hâli on iki ad sayıyordu: `ai_brain`, `global_governor`, `seo`,
 * `ads`, `marketing`, `revenue`, `commerce`, `automotive`, `travel_local`,
 * `merchant`, `intelligence`, `risk_quality`.
 *
 * Görev haritası çıkarılırken ölçüldü: `automotive`, `travel_local`, `ads`
 * ve `marketing` için üretimde TEK BİR TABLO ve depoda tek bir kod yolu
 * yok. Buna karşılık en çok kodun bulunduğu dört alanın -- alım hattı,
 * arama, mühendislik/QA, veri altyapısı -- hiç süpervizörü yoktu.
 *
 * Boş bir alan zararsız görünür ama değildir: bir ajanı nereye koyacağını
 * bilmeyen geliştirici onu en yakın adı taşıyan kutuya atar ve sahiplik
 * sessizce kaybolur. Aşağıdaki on alanın her biri, depoda çalışan kod VE
 * üretimde veri tutan tablolarla eşleşiyor.
 *
 * Sayı sabit değil: ihtiyaç çıkarsa alan eklenir ya da birleştirilir.
 * Değişmeyen kural, her alanın gerçek bir sorumluluğa karşılık gelmesi.
 */
export const SUPERVISORS = [
  /** Alım hattı, normalizasyon, eşleştirme, katalog kalitesi. */
  'catalog',
  /** Fiyat doğrulama, geçmiş, anomali, fırsat, kur, toplam maliyet. */
  'pricing',
  /** Mağaza kalitesi, ortaklık programı, tıklama ve ödeme mutabakatı. */
  'merchant',
  /** Sorgu niyeti, isabet, öneri, görsel arama, kişiselleştirme. */
  'search',
  /** SEO, içerik, yerelleştirme, pazar açılışı. */
  'growth',
  /** Kod değişikliği, test, derleme, diff denetimi, güvenlik taraması. */
  'engineering',
  /** Veritabanı sağlığı, sorgu performansı, kuyruk, hata, olay müdahale. */
  'infra',
  /** Sipariş, kargo, satıcı siparişi, destek, yorum moderasyonu. */
  'commerce',
  /** Listeleme riski, dolandırıcılık, yasal uyum. */
  'risk',
  /** İş zekâsı, rakip analizi, fırsat keşfi, raporlama, deney. */
  'intelligence',
] as const;

export type SupervisorId = (typeof SUPERVISORS)[number];

/**
 * Bir ajanın erişebileceği araçlar.
 *
 * İzinler ADLA değil YETENEKLE verilir ve ajanın kendisi bu listeyi
 * genişletemez: `AgentContext` yalnızca burada yazan araçları taşır.
 * Bir sıralama ajanının ödeme aracına erişmesi için önce kaydının
 * değişmesi gerekir -- çalışma anında yetki yükseltmesi mümkün değil.
 *
 * ARAÇLAR TABLOYA DEĞİL YETENEĞE GÖRE BÖLÜNDÜ.
 *
 * Her tablo için ayrı bir araç tanımlamak (`read_products`, `read_vendors`,
 * `read_carriers`...) listeyi kırk kaleme çıkarır ve hiçbir şey kazandırmaz:
 * katalog okuyan bir ajan zaten hepsini ister. Bölme çizgisi, izin kararının
 * gerçekten değiştiği yerde: okuma/yazma, kullanıcı verisi, para, kod,
 * şema. Yirmi beş araç bu çizgilerin sonucudur.
 */
export type ToolName =
  // --- Okuma ---
  | 'read_catalog'
  | 'read_price_history'
  | 'read_merchant'
  | 'read_market_config'
  | 'read_revenue'
  | 'read_orders'
  /** Oturum sahibinin KENDİ verisi. Ajan başkasının verisini isteyemez. */
  | 'read_user_scoped'
  | 'read_analytics'
  /** Alım çalıştırmaları, kuyruk, devre kesici, API kayıtları. */
  | 'read_ops'
  /** Şema ve plan incelemesi. Veri değil, yapı okur. */
  | 'read_db'
  // --- Yazma ---
  | 'write_catalog'
  | 'write_price'
  | 'write_risk_flag'
  | 'write_moderation'
  | 'write_content'
  | 'write_ops'
  | 'write_agent_decision'
  /**
   * Şema değişikliği ÖNERİR, uygulamaz.
   *
   * Adı bilerek `apply_ddl` değil: bu aracı taşıyan ajan bir plan, risk
   * analizi ve geri alma metni üretir. Uygulamayı insan onayı yapar.
   */
  | 'propose_ddl'
  // --- Dış dünya ve mühendislik ---
  | 'call_model'
  | 'http_fetch'
  | 'browser'
  | 'read_repo'
  | 'write_repo'
  /** typecheck, lint, test, build. */
  | 'run_check'
  | 'read_ci';

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
