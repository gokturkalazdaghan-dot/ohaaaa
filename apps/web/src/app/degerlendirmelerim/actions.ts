'use server';

/**
 * Değerlendirme gönderimi.
 *
 * Yazma, KULLANICININ OTURUMUYLA yapılır (service_role ile değil). Sebebi
 * kritik: "yalnızca satın almış kullanıcı" kuralı bir RLS politikasında
 * yaşıyor ve service_role RLS'i atlar. Sunucu anahtarı kullansaydık,
 * buradaki bir mantık hatası doğrudan sahte yorum yazılabilmesi demek
 * olurdu. Oturumla yazınca doğrulamayı veritabanı yapıyor ve bu kod yanlış
 * olsa bile kural tutuyor.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

const reviewSchema = z.object({
  order_item_id: z.string().uuid(),
  group_id: z.string().uuid(),
  vendor_id: z.string().uuid(),
  product_rating: z.coerce.number().int().min(1).max(5),
  vendor_rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().min(3).max(120).optional().or(z.literal('')),
  body: z.string().trim().min(10).max(4000).optional().or(z.literal('')),
});

export interface ReviewResult {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  needsAuth?: boolean;
}

export async function submitReview(
  _prev: ReviewResult,
  formData: FormData,
): Promise<ReviewResult> {
  const supabase = await createClient();
  if (!supabase) return { ok: true }; // demo modu: yazma yapılmaz

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { needsAuth: true };

  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const input = parsed.data;

  const { error } = await supabase.from('reviews').insert({
    order_item_id: input.order_item_id,
    user_id: user.id,
    group_id: input.group_id,
    vendor_id: input.vendor_id,
    product_rating: input.product_rating,
    vendor_rating: input.vendor_rating,
    title: input.title || null,
    body: input.body || null,
  });

  if (error) {
    /*
     * RLS reddi (42501) burada bir "hata" değil, KURALIN ÇALIŞMASIDIR:
     * kullanıcı o kalemi satın almamış ya da sipariş teslim edilmemiş.
     * Ham PostgREST mesajını göstermek hem anlaşılmaz hem de veritabanı
     * yapısını sızdırır.
     */
    if (error.code === '42501') {
      return {
        error:
          'Bu ürünü değerlendiremezsiniz. Değerlendirme yalnızca teslim ' +
          'edilmiş kendi siparişleriniz için açıktır.',
      };
    }
    if (error.code === '23505') {
      return { error: 'Bu siparişi zaten değerlendirmişsiniz.' };
    }

    console.error(
      JSON.stringify({ level: 'error', msg: 'Değerlendirme yazılamadı', error: error.message }),
    );
    return { error: 'Değerlendirmeniz kaydedilemedi. Lütfen tekrar deneyin.' };
  }

  revalidatePath('/degerlendirmelerim');
  return { ok: true };
}
