'use server';

/**
 * Yönetici eylemleri.
 *
 * Yetki İKİ KEZ kontrol edilir: middleware yolu kapatır, buradaki kontrol
 * ise eylemin kendisini korur. Sunucu eylemleri dışarıdan doğrudan
 * çağrılabilir; middleware'e güvenip burada kontrol atlamak, yönetici
 * yetkisini herkese açık bir uç noktaya çevirir.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getSessionUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface AdminActionResult {
  ok?: boolean;
  error?: string;
}

const decisionSchema = z.object({
  vendorId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  commissionRate: z.coerce.number().min(0).max(0.5).optional(),
  reason: z.string().max(500).optional(),
});

export async function decideApplication(
  _prev: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await getSessionUser();

  if (!user || user.role !== 'admin') {
    return { error: 'Bu işlem için yönetici yetkisi gerekli.' };
  }

  const parsed = decisionSchema.safeParse({
    vendorId: formData.get('vendorId'),
    decision: formData.get('decision'),
    commissionRate: formData.get('commissionRate') || undefined,
    reason: formData.get('reason') || undefined,
  });

  if (!parsed.success) {
    return { error: 'Geçersiz istek.' };
  }

  const supabase = await createClient();
  if (!supabase) return { error: 'Veritabanı yapılandırılmamış (demo modu).' };

  const { vendorId, decision, commissionRate, reason } = parsed.data;

  /*
   * Komisyon oranı yalnızca ONAY anında belirlenir ve `vendors_admin_all`
   * politikası sayesinde yalnızca admin yazabilir. Taşeronun kendi oranını
   * değiştiremediği, 20_rls_test.sql'de kanıtlanmıştır.
   */
  const update =
    decision === 'approve'
      ? {
          status: 'approved' as const,
          approved_at: new Date().toISOString(),
          rejection_reason: null,
          ...(commissionRate !== undefined ? { commission_rate: commissionRate } : {}),
        }
      : {
          status: 'rejected' as const,
          rejection_reason: reason ?? null,
        };

  const { error } = await supabase.from('vendors').update(update).eq('id', vendorId);

  if (error) {
    return { error: 'İşlem kaydedilemedi.' };
  }

  revalidatePath('/yonetim/basvurular');
  revalidatePath('/yonetim');
  return { ok: true };
}
