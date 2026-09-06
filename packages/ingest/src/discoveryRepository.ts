/**
 * Keşif turu denetim izi ve ağ imleci — tek yazma yolu.
 *
 * Başvuru motorundakiyle AYNI kalıp ve aynı sebeple: tur satırı
 * `idempotency_key` ile ÖNCE talep ediliyor, benzersizlik ihlali "bu tur
 * zaten çalışıyor/çalıştı" demek. İki zamanlayıcı aynı anda tetiklenirse
 * ikinci tur ağa TEK BİR İSTEK bile göndermiyor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type DiscoveryRunStatus =
  | 'running'
  | 'completed'
  | 'partial'
  | 'manual_required'
  | 'unavailable'
  | 'not_implemented'
  | 'failed';

/** `program_discovery_runs_error_category_known` ile birebir. */
export type DiscoveryErrorCategory =
  | 'MANUAL_REQUIRED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CAPABILITY_NOT_IMPLEMENTED'
  | 'UNKNOWN_NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'DATABASE_ERROR'
  | 'SECURITY_ERROR'
  | 'UNKNOWN_ERROR';

export interface DiscoveryRunClaim {
  network: string;
  idempotencyKey: string;
  correlationId: string | null;
  cursorStart: string | null;
}

export interface DiscoveryRunOutcome {
  status: DiscoveryRunStatus;
  cursorEnd: string | null;
  pagesFetched: number;
  programsSeen: number;
  programsWritten: number;
  firstSeenCount: number;
  malformedDropped: number;
  errorCategory: DiscoveryErrorCategory | null;
  message: string | null;
  finishedAt: string;
}

export interface DiscoveryRepository {
  /** `false` = bu tur zaten var; ağa istek GİTMEZ. */
  claimRun(claim: DiscoveryRunClaim): Promise<boolean>;
  completeRun(idempotencyKey: string, outcome: DiscoveryRunOutcome): Promise<void>;
  /**
   * Ağın imlecini ilerletir.
   *
   * YALNIZCA tur bir sayfayı BAŞARIYLA işledikten sonra çağrılır. Yarıda
   * kalmış bir turda ilerletmek, işlenmemiş sayfaları sonsuza kadar
   * atlamak demektir.
   */
  saveCursor(network: string, cursor: string | null, checkedAt: string): Promise<void>;
}

const TEKRAR = '23505';

export function createDiscoveryRepository(supabase: SupabaseClient): DiscoveryRepository {
  return {
    async claimRun(claim: DiscoveryRunClaim): Promise<boolean> {
      const { error } = await supabase.from('program_discovery_runs').insert({
        network: claim.network,
        idempotency_key: claim.idempotencyKey,
        correlation_id: claim.correlationId,
        cursor_start: claim.cursorStart,
        status: 'running',
      });

      if (!error) return true;

      // Yalnız benzersizlik ihlali "zaten var" demektir. Her hatayı öyle
      // saymak, bir veritabanı arızasını sessizce "bu tur yapıldı"ya
      // çevirirdi.
      if (error.code === TEKRAR) return false;

      throw new Error(`Kesif turu kaydedilemedi: ${error.message}`);
    },

    async completeRun(idempotencyKey: string, outcome: DiscoveryRunOutcome): Promise<void> {
      const { error } = await supabase
        .from('program_discovery_runs')
        .update({
          status: outcome.status,
          cursor_end: outcome.cursorEnd,
          pages_fetched: outcome.pagesFetched,
          programs_seen: outcome.programsSeen,
          programs_written: outcome.programsWritten,
          first_seen_count: outcome.firstSeenCount,
          malformed_dropped: outcome.malformedDropped,
          error_category: outcome.errorCategory,
          message: outcome.message,
          finished_at: outcome.finishedAt,
        })
        .eq('idempotency_key', idempotencyKey);

      if (error) throw new Error(`Tur sonucu yazilamadi: ${error.message}`);
    },

    async saveCursor(network: string, cursor: string | null, checkedAt: string): Promise<void> {
      const { error } = await supabase
        .from('affiliate_networks')
        .update({ discovery_cursor: cursor, discovery_checked_at: checkedAt })
        .eq('code', network);

      if (error) throw new Error(`Imlec yazilamadi: ${error.message}`);
    },
  };
}
