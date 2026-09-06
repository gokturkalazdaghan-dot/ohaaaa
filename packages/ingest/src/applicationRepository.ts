/**
 * Başvuru denetim izi ve durum geçişlerinin TEK yazma yolu.
 *
 * ======================================================================
 * ÖNCE TALEP ET, SONRA YAP
 * ======================================================================
 * Başvuru dış dünyada geri alınamaz bir eylemdir. Bu yüzden sıra şudur:
 * önce denetim satırı `idempotency_key` ile YAZILIR, sonra ağa istek
 * gider. Ters sırada olsaydı, istek gittikten sonra düşen bir süreç
 * gerçekten yapılmış bir başvurunun kaydını kaybederdi ve bir sonraki tur
 * aynı ağa ikinci kez başvururdu.
 *
 * ======================================================================
 * IDEMPOTENCY VERİTABANINDA
 * ======================================================================
 * "Önce SELECT, yoksa INSERT" kalıbı KULLANILMIYOR. O kalıp tam olarak
 * kaçındığımız yarışı üretir: iki eşzamanlı tur da "yok" görür, ikisi de
 * yazar, ağa iki başvuru gider. Burada tek yazma denemesi yapılıyor ve
 * benzersizlik ihlali (23505) "zaten talep edilmiş" olarak okunuyor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ApplicationState } from '@ohaaaa/shared/providers';

/** `public.application_attempt_result` ile birebir. */
export type AttemptResult =
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PENDING'
  | 'MANUAL_REQUIRED'
  | 'UNAVAILABLE'
  | 'NOT_IMPLEMENTED'
  | 'DUPLICATE'
  | 'FAILED';

/** `program_application_attempts_error_category_known` ile birebir. */
export type AttemptErrorCategory =
  | 'MANUAL_REQUIRED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CAPABILITY_NOT_IMPLEMENTED'
  | 'UNKNOWN_NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'DUPLICATE'
  | 'DATABASE_ERROR'
  | 'SECURITY_ERROR'
  | 'UNKNOWN_ERROR';

export interface AttemptClaim {
  programId: string | null;
  network: string;
  networkProgramId: string;
  idempotencyKey: string;
  correlationId: string | null;
  result: AttemptResult;
  errorCategory: AttemptErrorCategory | null;
  message: string | null;
}

export interface AttemptOutcome {
  result: AttemptResult;
  outcomeState: ApplicationState | null;
  errorCategory: AttemptErrorCategory | null;
  message: string | null;
  completedAt: string;
}

export interface ApplicationRepository {
  /**
   * Denemeyi talep eder.
   *
   * `true`  — talep bizim, ağa istek gidebilir.
   * `false` — bu anahtar zaten kullanılmış; ağa istek GİTMEZ.
   */
  claimAttempt(claim: AttemptClaim): Promise<boolean>;
  /** Talep edilmiş denemeyi sonuçlandırır. */
  completeAttempt(idempotencyKey: string, outcome: AttemptOutcome): Promise<void>;
  /** Programın durumunu ilerletir. Geçiş kapısı veritabanında. */
  transition(programId: string, state: ApplicationState): Promise<void>;
}

/** Benzersizlik ihlali — "zaten talep edilmiş"in tek doğru işareti. */
const TEKRAR = '23505';

export function createApplicationRepository(supabase: SupabaseClient): ApplicationRepository {
  return {
    async claimAttempt(claim: AttemptClaim): Promise<boolean> {
      const { error } = await supabase.from('program_application_attempts').insert({
        program_id: claim.programId,
        network: claim.network,
        network_program_id: claim.networkProgramId,
        idempotency_key: claim.idempotencyKey,
        correlation_id: claim.correlationId,
        result: claim.result,
        error_category: claim.errorCategory,
        message: claim.message,
      });

      if (!error) return true;

      /*
       * Yalnızca benzersizlik ihlali "zaten var" demektir. Her hatayı
       * öyle saymak, bir veritabanı arızasını sessizce "bu iş zaten
       * yapıldı"ya çevirirdi ve başvuru hiç yapılmadan yapılmış sayılırdı.
       */
      if (error.code === TEKRAR) return false;

      throw new Error(`Basvuru denemesi kaydedilemedi: ${error.message}`);
    },

    async completeAttempt(idempotencyKey: string, outcome: AttemptOutcome): Promise<void> {
      const { error } = await supabase
        .from('program_application_attempts')
        .update({
          result: outcome.result,
          outcome_state: outcome.outcomeState,
          error_category: outcome.errorCategory,
          message: outcome.message,
          completed_at: outcome.completedAt,
        })
        .eq('idempotency_key', idempotencyKey);

      if (error) throw new Error(`Deneme sonucu yazilamadi: ${error.message}`);
    },

    async transition(programId: string, state: ApplicationState): Promise<void> {
      /*
       * `application_state` DIŞINDA hiçbir sütuna dokunulmuyor. Özellikle
       * `merchant_id`: onboarding bağı başvuru turunun işi değil ve buradan
       * yazılabilseydi onay öncesi kanıtsız bir mağaza kaydı üretilebilirdi.
       */
      const { error } = await supabase
        .from('programs')
        .update({ application_state: state })
        .eq('id', programId);

      if (error) throw new Error(`Durum gecisi reddedildi: ${error.message}`);
    },
  };
}
