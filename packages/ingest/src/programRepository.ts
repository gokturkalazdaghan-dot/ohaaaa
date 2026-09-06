/**
 * `programs` tablosu deposu — keşfin tek yazma yolu.
 *
 * IDEMPOTENCY VERİTABANINDA, BURADA DEĞİL.
 *
 * Upsert `(network, network_program_id)` tekil kısıtına dayanıyor. Kod
 * tarafında "önce SELECT, yoksa INSERT" yapılabilirdi ama o kalıp iki
 * keşif turu aynı anda koştuğunda YARIŞ üretir: ikisi de "yok" görür,
 * ikisi de yazar. Tekil kısıt bunu veritabanı seviyesinde imkânsız kılar
 * ve `on conflict` ikinci turu güncellemeye çevirir.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { NormalizedProgram } from '@ohaaaa/shared/providers';

export interface ProgramUpsertResult {
  /** Yazılan/güncellenen satır sayısı. */
  written: number;
  /** Bu turda İLK KEZ görülen programlar. */
  firstSeen: string[];
}

/**
 * Keşfedilen programları yazar.
 *
 * `first_seen_at` YALNIZCA ekleme sırasında yazılır: `on conflict` yolunda
 * dokunulmaz. Güncellenseydi "bu programı ne zamandır tanıyoruz" bilgisi
 * her turda sıfırlanır ve bayat program tespiti anlamsızlaşırdı.
 *
 * `application_state` de güncellenmez -- o BİZİM durumumuz, ağın değil.
 * Keşif turu APPLIED bir programı DISCOVERED'a geri çekemez.
 */
export function createProgramRepository(supabase: SupabaseClient) {
  return {
    async upsertDiscovered(programs: NormalizedProgram[]): Promise<ProgramUpsertResult> {
      if (programs.length === 0) return { written: 0, firstSeen: [] };

      const oncekiler = await mevcutAnahtarlar(supabase, programs);

      const satirlar = programs.map((p) => ({
        network: p.network,
        network_program_id: p.networkProgramId,
        merchant_name: p.merchantName,
        homepage_url: p.homepageUrl,
        country_code: p.countryCode,
        market_code: p.marketCode,
        currency: p.currency,
        commission_rate: p.commissionRate,
        cookie_window_days: p.cookieWindowDays,
        feed_available: p.feedAvailable,
        product_count: p.productCount,
        application_supported: p.applicationSupported,
        deeplink_supported: p.deeplinkSupported,
        terms: p.terms,
        network_status: p.networkStatus,
        last_verified_at: p.lastVerifiedAt,
      }));

      const { error } = await supabase
        .from('programs')
        .upsert(satirlar, {
          onConflict: 'network,network_program_id',
          ignoreDuplicates: false,
        });

      if (error) throw new Error(`Program yazilamadi: ${error.message}`);

      const firstSeen = programs
        .map((p) => `${p.network}:${p.networkProgramId}`)
        .filter((anahtar) => !oncekiler.has(anahtar));

      return { written: satirlar.length, firstSeen };
    },
  };
}

/** Yazmadan ÖNCE var olan anahtarlar — "ilk kez görüldü" ölçümü için. */
async function mevcutAnahtarlar(
  supabase: SupabaseClient,
  programs: NormalizedProgram[],
): Promise<Set<string>> {
  const networks = [...new Set(programs.map((p) => p.network))];
  const ids = [...new Set(programs.map((p) => p.networkProgramId))];

  const { data, error } = await supabase
    .from('programs')
    .select('network, network_program_id')
    .in('network', networks)
    .in('network_program_id', ids);

  if (error) throw new Error(`Mevcut programlar okunamadi: ${error.message}`);

  return new Set(
    (data ?? []).map(
      (row: Record<string, unknown>) => `${String(row.network)}:${String(row.network_program_id)}`,
    ),
  );
}
