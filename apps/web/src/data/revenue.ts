import 'server-only';

/**
 * Gelir kalemleri ve tahsilat defteri okuma katmanı.
 *
 * EN ÖNEMLİ AYRIM BURADA YAPILIR: "ağ bize borçlu" ile "para hesabımızda"
 * aynı sayı değildir ve bu dosya ikisini asla tek alana indirmez.
 */

import { getServiceClient } from '@/lib/supabase/service';

/**
 * Bir para birimindeki gelir tablosu.
 *
 * Alanların hiçbiri diğerinin yerine geçmez:
 *   gmv          — yönlendirdiğimiz satışların cirosu. BİZİM GELİRİMİZ DEĞİL.
 *   pending      — ağın onay bekleyen komisyonu (iade süresi dolmadı)
 *   approved     — onaylanmış, ama henüz elimize geçmemiş
 *   rejected     — iptal/iade edilmiş
 *   declared     — ağın hesap özetinde beyan ettiği tutar
 *   received     — HESABA GEÇEN. Tek gerçek gelir.
 */
export interface RevenueRow {
  currency: string;
  gmvCents: number;
  pendingCents: number;
  approvedCents: number;
  rejectedCents: number;
  declaredCents: number;
  receivedCents: number;
  conversionsCount: number;
  payoutsCount: number;
  receivedPayouts: number;
}

/**
 * Gelir özeti.
 *
 * PARA BİRİMLERİ TOPLANMAZ. TRY ile EUR'yu toplamak, kur kaynağı ve zaman
 * damgası olmadan uydurma bir sayı üretir; direktifin 7. ve 10. maddeleri
 * bunu açıkça yasaklıyor. Bu yüzden dönen şey bir liste, tek bir sayı değil.
 *
 * Okunamazsa `null` döner ve arayüz "gelir verisi okunamadı" der — sıfır
 * göstermez. Sıfır, "hiç kazanmadık" demektir; okunamamak başka şey.
 */
export async function getRevenueSummary(days = 30): Promise<RevenueRow[] | null> {
  let supabase: ReturnType<typeof getServiceClient>;

  try {
    supabase = getServiceClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase.rpc('revenue_summary', { p_days: days });

  if (error) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'Gelir özeti okunamadı', error: error.message }),
    );
    return null;
  }

  return (data ?? []).map((row: Record<string, unknown>): RevenueRow => ({
    currency: String(row.currency ?? '').trim(),
    gmvCents: Number(row.gmv_cents ?? 0),
    pendingCents: Number(row.pending_cents ?? 0),
    approvedCents: Number(row.approved_cents ?? 0),
    rejectedCents: Number(row.rejected_cents ?? 0),
    declaredCents: Number(row.declared_cents ?? 0),
    receivedCents: Number(row.received_cents ?? 0),
    conversionsCount: Number(row.conversions_count ?? 0),
    payoutsCount: Number(row.payouts_count ?? 0),
    receivedPayouts: Number(row.received_payouts ?? 0),
  }));
}

export interface PayoutRow {
  id: string;
  merchantName: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  expectedCents: number;
  declaredCents: number | null;
  receivedCents: number | null;
  status: 'beklemede' | 'beyan_edildi' | 'tahsil_edildi' | 'itirazli';
  paymentProvider: string | null;
  paymentReference: string | null;
  paymentDate: string | null;
  reconciledAt: string | null;
}

/** Tahsilat defterinin son kayıtları. Yalnızca sunucu tarafından okunur. */
export async function getPayouts(limit = 50): Promise<PayoutRow[] | null> {
  let supabase: ReturnType<typeof getServiceClient>;

  try {
    supabase = getServiceClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase
    .from('payouts')
    .select(
      `id, period_start, period_end, currency, expected_cents, declared_cents,
       received_cents, status, payment_provider, payment_reference, payment_date,
       reconciled_at, merchant:merchants!merchant_id ( display_name )`,
    )
    .order('period_end', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'Tahsilat defteri okunamadı', error: error.message }),
    );
    return null;
  }

  return (data ?? []).map((row: Record<string, unknown>): PayoutRow => {
    const ham = row.merchant;
    const merchant = (Array.isArray(ham) ? ham[0] : ham) as Record<string, unknown> | null;

    return {
      id: String(row.id),
      merchantName: merchant?.display_name ? String(merchant.display_name) : 'Bilinmeyen mağaza',
      periodStart: String(row.period_start),
      periodEnd: String(row.period_end),
      currency: String(row.currency),
      expectedCents: Number(row.expected_cents ?? 0),
      declaredCents: row.declared_cents === null ? null : Number(row.declared_cents),
      receivedCents: row.received_cents === null ? null : Number(row.received_cents),
      status: row.status as PayoutRow['status'],
      paymentProvider: row.payment_provider ? String(row.payment_provider) : null,
      paymentReference: row.payment_reference ? String(row.payment_reference) : null,
      paymentDate: row.payment_date ? String(row.payment_date) : null,
      reconciledAt: row.reconciled_at ? String(row.reconciled_at) : null,
    };
  });
}
