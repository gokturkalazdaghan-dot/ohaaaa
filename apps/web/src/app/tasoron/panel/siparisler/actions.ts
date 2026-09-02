'use server';

/**
 * Satıcının sipariş işlemleri.
 *
 * NEDEN VAR
 * Panelde sipariş listesi vardı ama işlem yoktu: "Siparişi onayla" düğmesi
 * hiçbir şeye bağlı değildi ve kargo bilgisi girilecek bir alan hiç yoktu.
 * Tek fiili yol `PATCH /api/v1/orders/{id}` idi — yani satıcının bir API
 * anahtarı üretip istek yazması gerekiyordu. Geliştiricisi olmayan bir
 * mağaza, gelen siparişi GÖRÜYOR ama yerine getiremiyordu.
 *
 * YAZMA OTURUMLA YAPILIR
 * service_role kullanılmaz. Satıcının yalnızca kendi siparişine
 * dokunabilmesi `vendor_orders_vendor_update` politikasında yaşıyor ve o
 * politika tutarları da kilitliyor. Oturumla yazınca sahiplik denetimini
 * veritabanı yapar; buradaki bir mantık hatası başkasının siparişini
 * değiştirmeye yetmez.
 *
 * GEÇİŞ TABLOSU TEK YERDE
 * İzinli durum geçişleri `@ohaaaa/shared` içindeki tablodan okunur — API
 * rotasının kullandığı tablonun aynısı. İkinci bir kopya yazsaydım, panelin
 * izin verdiği bir geçişi API'nin reddettiği (ya da tersi) bir durum
 * kaçınılmazdı.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { canTransitionVendorOrder } from '@ohaaaa/shared';

import { createClient } from '@/lib/supabase/server';

const schema = z.object({
  vendor_order_id: z.string().uuid(),
  status: z.enum(['accepted', 'preparing', 'shipped', 'delivered']),
  carrier: z.string().trim().max(32).optional().or(z.literal('')),
  tracking_number: z.string().trim().max(64).optional().or(z.literal('')),
});

export interface OrderActionResult {
  ok?: boolean;
  error?: string;
}

export async function updateOrderStatus(
  _prev: OrderActionResult,
  formData: FormData,
): Promise<OrderActionResult> {
  const supabase = await createClient();
  // Örnek veri modunda yazma yapılmaz: gösterilen siparişler gerçek değil.
  if (!supabase) return { error: 'Bu işlem yalnızca onaylı mağaza hesabında yapılabilir.' };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Form doğrulanamadı.' };

  const input = parsed.data;

  // Mevcut durum ÖNCE okunur: bir geçişin geçerli olup olmadığı ancak
  // nereden gelindiği bilinerek söylenebilir. Okuma da RLS altında yapılır,
  // yani başkasının siparişi zaten "bulunamadı" döner.
  const { data: current, error: readError } = await supabase
    .from('vendor_orders')
    .select('id, status')
    .eq('id', input.vendor_order_id)
    .maybeSingle();

  if (readError) return { error: 'Sipariş okunamadı.' };
  if (!current) return { error: 'Sipariş bulunamadı.' };

  const from = String(current.status);
  if (!canTransitionVendorOrder(from, input.status)) {
    return { error: `Bu sipariş "${from}" durumundan buraya geçemez.` };
  }

  const updates: Record<string, unknown> = { status: input.status };

  if (input.status === 'shipped') {
    if (!input.carrier || !input.tracking_number) {
      return { error: 'Kargo firması ve takip numarası zorunludur.' };
    }
    updates.carrier = input.carrier;
    updates.tracking_number = input.tracking_number;
    // Zaman damgası SUNUCUDA konur: kargo süresi ölçümü, ölçülen tarafın
    // gönderdiği bir tarihe dayanamaz.
    updates.shipped_at = new Date().toISOString();
  }
  if (input.status === 'delivered') updates.delivered_at = new Date().toISOString();

  const { error } = await supabase
    .from('vendor_orders')
    .update(updates)
    .eq('id', input.vendor_order_id);

  if (error) {
    /*
     * Takip numarası denetimi veritabanındaki tetikleyicide. Bunlar sunucu
     * hatası değil, satıcının düzeltebileceği hatalardır; "bir şeyler ters
     * gitti" demek satıcıyı neyi düzelteceğini bilmeden bırakırdı.
     */
    if (error.message.includes('OHAAAA_TRACKING_REQUIRED')) {
      return { error: 'Kargo firması ve takip numarası zorunludur.' };
    }
    if (error.message.includes('OHAAAA_TRACKING_INVALID')) {
      return {
        error:
          'Takip numarası seçtiğiniz firmanın biçimine uymuyor. ' +
          'Numarayı kargo fişinden kontrol edin.',
      };
    }
    return { error: 'Sipariş güncellenemedi.' };
  }

  revalidatePath('/tasoron/panel/siparisler');
  revalidatePath('/tasoron/panel');
  return { ok: true };
}
