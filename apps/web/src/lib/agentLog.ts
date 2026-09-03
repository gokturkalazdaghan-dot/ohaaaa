import 'server-only';

/**
 * Ajan kararlarının kaydı.
 *
 * NE YAPAR: bir yapay zekâ kararını, dayanağını, güvenini ve karar anında ne
 * beklendiğini yazar. Sonra gerçekte ne olduğunu aynı satıra işler.
 *
 * NE YAPMAZ: öğrenmez. Şu an öğrenilecek veri yok (katalog boş). Bu katman,
 * öğrenmenin ileride üzerine kurulacağı ÖLÇÜMÜ biriktirir. Ölçüm olmadan
 * yazılan bir öğrenme döngüsü kendi uydurduğu sayılarla kendini besler.
 *
 * KAYIT HİÇBİR AKIŞI DÜŞÜRMEZ
 * Arama, kararın kaydedilip kaydedilmediğinden bağımsız çalışmalı. Bir
 * telemetri yazımı yüzünden kullanıcının araması başarısız olamaz; bu yüzden
 * her çağrı kendi hatasını yutar.
 *
 * SUNUCU ANAHTARIYLA YAZILIR
 * Tabloya istemci yazamaz (yetki verilmedi). Ajanın performans kaydı ölçtüğü
 * kişi tarafından doldurulabilir olsaydı, "başarı oranı" istemcinin
 * gönderdiği sayıya dönerdi.
 */

import { createHash } from 'node:crypto';

export type AgentKind = 'search_intent' | 'listing_risk' | 'visual_search';

interface DecisionInput {
  agent: AgentKind;
  model: string;
  promptVersion: string;
  /** Ham girdi; kısaltılarak saklanır. */
  input: string;
  decision: Record<string, unknown>;
  confidence?: number | null;
  evidence?: Record<string, unknown>;
  expectedOutcome?: Record<string, unknown>;
  /** Oturumu bağlamak için; kimliğe çevrilemez bir özet. */
  sessionSeed?: string | null;
}

/** Yeni bir karar yazar ve kimliğini döner (yazılamazsa null). */
export async function logAgentDecision(input: DecisionInput): Promise<string | null> {
  try {
    const { getServiceClient } = await import('@/lib/supabase/service');

    const { data, error } = await getServiceClient()
      .from('agent_decisions')
      .insert({
        agent: input.agent,
        model: input.model,
        prompt_version: input.promptVersion,
        /*
         * Girdi KISALTILIR. Arama cümlesi kişisel bilgi içerebilir ("eşime
         * hediye", bir adres, bir marka tercihi) ve tam metni süresiz
         * saklamanın ölçüm açısından bir faydası yok.
         */
        input_digest: input.input.trim().slice(0, 300),
        decision: input.decision,
        confidence: input.confidence ?? null,
        evidence: input.evidence ?? {},
        expected_outcome: input.expectedOutcome ?? {},
        session_hash: input.sessionSeed
          ? createHash('sha256').update(input.sessionSeed).digest('hex').slice(0, 64)
          : null,
      })
      .select('id')
      .maybeSingle();

    if (error || !data) return null;
    return String(data.id);
  } catch {
    return null;
  }
}

/**
 * Kararın GERÇEK sonucunu işler.
 *
 * `success` alanı doğruluk oranının tek kaynağı; bu yüzden ne anlama geldiği
 * her ajan için tek yerde tanımlı olmalı. Arama için: kullanıcı çözümlenen
 * filtreyle gerçekten sonuç gördü mü.
 */
export async function recordAgentOutcome(
  decisionId: string,
  outcome: { success: boolean } & Record<string, unknown>,
): Promise<void> {
  try {
    const { getServiceClient } = await import('@/lib/supabase/service');

    await getServiceClient()
      .from('agent_decisions')
      .update({ actual_outcome: outcome, measured_at: new Date().toISOString() })
      .eq('id', decisionId);
  } catch {
    // Ölçüm yazılamadıysa satır "henüz ölçülmedi" olarak kalır -- yanlış bir
    // sonuç yazmaktansa boş kalması doğru.
  }
}
