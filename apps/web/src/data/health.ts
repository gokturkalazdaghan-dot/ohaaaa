import 'server-only';

import { getServiceClient } from '@/lib/supabase/service';

/**
 * Sistem sağlığı okuma katmanı.
 *
 * NEDEN VAR
 * Denetimde ölçüldü: alım hattı aylardır hiç çalışmamıştı ve bunu kimse
 * fark etmedi. `ingest_runs = 0` bir başlangıç durumu sanılmıştı. Sessiz
 * başarısızlık, gürültülü başarısızlıktan pahalıdır — bozuk olduğunu
 * bilmediğin sistemi tamir edemezsin.
 */

export interface SystemAlert {
  code: string;
  severity: 'critical' | 'warning';
  subject: string;
  detail: string;
  observedAt: string;
}

export interface SourceHealth {
  sourceSlug: string;
  merchantSlug: string;
  market: string;
  state: 'saglikli' | 'yavas' | 'bayat' | 'basarisiz' | 'hic_calismadi';
  lastRunAt: string | null;
  minutesSinceRun: number | null;
  maxStalenessMinutes: number;
  lastItemCount: number | null;
  lastError: string | null;
  runCount: number;
  detail: string;
}

/**
 * Etkin alarmlar.
 *
 * `null` = okunamadı. Boş dizi = alarm YOK. İkisini karıştırmak, izleme
 * sisteminin kendisi çöktüğünde "her şey yolunda" demek olurdu — izlemenin
 * yapabileceği en kötü hata.
 */
export async function getSystemAlerts(): Promise<SystemAlert[] | null> {
  let supabase: ReturnType<typeof getServiceClient>;
  try {
    supabase = getServiceClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase.rpc('system_alerts');

  if (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Sistem alarmları okunamadı',
        error: error.message,
      }),
    );
    return null;
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    code: String(row.code),
    severity: row.severity === 'critical' ? 'critical' : 'warning',
    subject: String(row.subject),
    detail: String(row.detail),
    observedAt: String(row.observed_at),
  }));
}

/** Etkin kaynakların sağlık durumu. `null` = okunamadı. */
export async function getSourceHealth(): Promise<SourceHealth[] | null> {
  let supabase: ReturnType<typeof getServiceClient>;
  try {
    supabase = getServiceClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase.rpc('source_health');

  if (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Kaynak sağlığı okunamadı',
        error: error.message,
      }),
    );
    return null;
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    sourceSlug: String(row.source_slug),
    merchantSlug: String(row.merchant_slug),
    market: String(row.market),
    state: row.state as SourceHealth['state'],
    lastRunAt: row.last_run_at === null ? null : String(row.last_run_at),
    minutesSinceRun:
      row.minutes_since_run === null ? null : Number(row.minutes_since_run),
    maxStalenessMinutes: Number(row.max_staleness_minutes),
    lastItemCount: row.last_item_count === null ? null : Number(row.last_item_count),
    lastError: row.last_error === null ? null : String(row.last_error),
    runCount: Number(row.run_count),
    detail: String(row.detail),
  }));
}
