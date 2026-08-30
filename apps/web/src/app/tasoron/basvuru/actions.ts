'use server';

/**
 * Taşeron başvurusu — sunucu eylemi.
 *
 * Kayıt kullanıcının KENDİ oturumuyla açılır (service_role ile değil).
 * Sebep: RLS politikası `vendors_owner_insert`, kaydın yalnızca
 * `owner_id = auth.uid()` ve `status = 'pending'` ile açılmasına izin verir.
 * service_role kullansaydık bu koruma devre dışı kalır ve bir hata durumunda
 * başvuru "onaylı" olarak açılabilirdi.
 */

import { revalidatePath } from 'next/cache';

import { vendorApplicationSchema } from '@ohaaaa/shared';

import { createClient } from '@/lib/supabase/server';

export interface ApplicationResult {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Oturum yoksa kullanıcı önce kayıt olmalı. */
  needsAuth?: boolean;
}

export async function submitApplication(
  _prev: ApplicationResult,
  formData: FormData,
): Promise<ApplicationResult> {
  const parsed = vendorApplicationSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors, error: 'Lütfen işaretli alanları düzeltin.' };
  }

  const supabase = await createClient();

  // Demo modu: form akışı denenebilsin diye başarı döndürülür, yazma yapılmaz.
  if (!supabase) return { ok: true };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { needsAuth: true };

  // Aynı kullanıcının ikinci başvurusu engellenir: bir kişi bir mağaza yönetir.
  const { data: existing } = await supabase
    .from('vendors')
    .select('id, status')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (existing) {
    return {
      error:
        existing.status === 'approved'
          ? 'Zaten onaylı bir mağazanız var. Panelden yönetebilirsiniz.'
          : 'Başvurunuz zaten alındı ve değerlendiriliyor.',
    };
  }

  const input = parsed.data;

  const { error } = await supabase.from('vendors').insert({
    owner_id: user.id,
    slug: input.slug.toLowerCase(),
    display_name: input.display_name,
    legal_name: input.legal_name,
    tax_id: input.tax_id,
    support_email: input.support_email,
    support_phone: input.support_phone || null,
    website_url: input.website_url || null,
    description: input.description,
    // status ve commission_rate BİLEREK gönderilmez: RLS politikası
    // 'pending' dışına izin vermez, komisyon oranı da varsayılanda kalır.
  });

  if (error) {
    // 23505 = benzersizlik ihlali. Tek olası çakışma slug'dır.
    if (error.code === '23505') {
      return {
        fieldErrors: { slug: 'Bu mağaza adresi alınmış. Başka bir tane deneyin.' },
        error: 'Mağaza adresi kullanılıyor.',
      };
    }

    return { error: 'Başvuru kaydedilemedi. Lütfen tekrar deneyin.' };
  }

  /*
   * Rolü burada güncellemiyoruz. `users_update_self` politikası rol
   * değişimine izin vermez (vermemeli de — aksi halde herkes kendini admin
   * yapardı). Yükseltmeyi `vendors_promote_owner` trigger'ı yapıyor:
   * "taşeron kaydı olan kullanıcı vendor'dur" bir veri değişmezidir,
   * uygulamanın isteğine bağlı bir alan değil.
   */
  revalidatePath('/tasoron/panel');
  return { ok: true };
}
