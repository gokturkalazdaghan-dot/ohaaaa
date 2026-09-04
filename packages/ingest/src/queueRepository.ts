import type { SupabaseClient } from '@supabase/supabase-js';

import type { QueueJob, QueueRepository } from '@ohaaaa/shared';

/**
 * Kuyruk deposunun Supabase uygulaması.
 *
 * Worker (`runWorkerOnce`) veritabanını tanımıyor; yalnızca dört işlem
 * bilen bir arayüz görüyor. Bu dosya o arayüzü mevcut SQL fonksiyonlarına
 * bağlıyor: `claim_jobs`, `complete_job`, `fail_job`, `extend_lease`.
 *
 * Yeni bir kuyruk mantığı YOK. Öncelik sırası, kiralama, geri çekilme ve
 * ölü mektup kararlarının hepsi SQL tarafında -- burada yalnızca çağrı
 * ve tip dönüşümü var.
 */
export function createQueueRepository(
  supabase: SupabaseClient,
  options: { workerId?: string; leaseSeconds?: number } = {},
): QueueRepository {
  const workerId = options.workerId ?? `worker-${process.pid}`;
  const leaseSeconds = options.leaseSeconds ?? 300;

  return {
    async claim(limit, kind) {
      const { data, error } = await supabase.rpc('claim_jobs', {
        p_limit: limit,
        p_kind: kind ?? null,
        p_lease_seconds: leaseSeconds,
        p_worker_id: workerId,
      });

      if (error) throw new Error(`İşler alınamadı: ${error.message}`);

      return (data ?? []).map(
        (row: Record<string, unknown>): QueueJob => ({
          id: String(row.id),
          kind: String(row.kind),
          /*
           * Yük her zaman bir nesne olmalı. Bozuk bir satırda `null`
           * gelirse işleyici `job.payload['source_id']` okurken çökerdi
           * ve hata "kuyruk bozuk" yerine "undefined okunamıyor" diye
           * görünürdü.
           */
          payload:
            row.payload && typeof row.payload === 'object'
              ? (row.payload as Record<string, unknown>)
              : {},
          attempt: Number(row.attempt ?? 0),
          market: row.market === null || row.market === undefined ? null : String(row.market),
          sourceId:
            row.source_id === null || row.source_id === undefined
              ? null
              : String(row.source_id),
        }),
      );
    },

    async complete(jobId) {
      const { error } = await supabase.rpc('complete_job', { p_job_id: jobId });
      if (error) throw new Error(`İş tamamlanamadı: ${error.message}`);
    },

    async fail(jobId, errorMessage, permanent) {
      const { error } = await supabase.rpc('fail_job', {
        p_job_id: jobId,
        p_error: errorMessage,
        p_permanent: permanent,
      });
      if (error) throw new Error(`İş başarısız işaretlenemedi: ${error.message}`);
    },

    async extendLease(jobId, seconds) {
      const { error } = await supabase.rpc('extend_lease', {
        p_job_id: jobId,
        p_seconds: seconds,
      });
      if (error) throw new Error(`Kira uzatılamadı: ${error.message}`);
    },
  };
}

export interface ScheduledSource {
  sourceId: string;
  jobId: string;
  reason: string;
}

/**
 * Zamanlayıcı: due kaynaklar için SOURCE_SYNC işi açar.
 *
 * KARAR SQL'DE, BURADA DEĞİL.
 *
 * `schedule_due_sources()` hem "hangi kaynak due" hem de "zaten açık iş
 * var mı" sorularını TEK işlemde yanıtlıyor. Bu mantığı TypeScript'e
 * taşımak, iki çağrı arasında yarış durumu açardı: iki zamanlayıcı aynı
 * anda "due" listesini okuyup ikisi de iş açabilirdi.
 */
export async function scheduleDueSources(
  supabase: SupabaseClient,
  limit = 100,
): Promise<ScheduledSource[]> {
  const { data, error } = await supabase.rpc('schedule_due_sources', {
    p_limit: limit,
  });

  if (error) throw new Error(`Zamanlama yapılamadı: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    sourceId: String(row.source_id),
    jobId: String(row.job_id),
    reason: String(row.reason),
  }));
}
