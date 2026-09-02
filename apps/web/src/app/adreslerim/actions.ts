'use server';

/**
 * Adres defteri işlemleri.
 *
 * Yazma KULLANICININ OTURUMUYLA yapılır, service_role ile değil. "Kendi
 * adresine dokunabilir" kuralı `addresses_own_all` politikasında yaşıyor;
 * servis anahtarı RLS'i atladığı için buradaki bir mantık hatası, doğrudan
 * başkasının adresini okumak ya da değiştirmek anlamına gelirdi.
 *
 * `user_id`'yi de biz koymuyoruz -- oturumdan gelen `auth.uid()` ile
 * eşleşmeyen bir satır politikanın `with check` tarafından reddedilir. Yani
 * istemciden gelen bir kimlik değeri hiçbir şekilde işe yaramaz.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

/*
 * Şema DIŞA AKTARILMAZ. 'use server' dosyaları yalnızca async fonksiyon
 * verebilir; bir nesne dışa aktarmak derlemeyi düşürüyor. (Düşürdü de:
 * "A 'use server' file can only export async functions, found object".)
 */
const addressSchema = z.object({
  label: z.string().trim().max(40).optional().or(z.literal('')),
  full_name: z.string().trim().min(3, 'Ad soyad giriniz').max(120),
  phone: z.string().trim().min(10, 'Telefon numarası giriniz').max(30),
  city: z.string().trim().min(2, 'İl giriniz').max(60),
  district: z.string().trim().min(2, 'İlçe giriniz').max(60),
  address_line: z.string().trim().min(10, 'Açık adres giriniz').max(500),
  postal_code: z.string().trim().max(10).optional().or(z.literal('')),
});

export interface AddressResult {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

async function currentUserId(): Promise<{ id: string | null; supabase: Awaited<ReturnType<typeof createClient>> }> {
  const supabase = await createClient();
  if (!supabase) return { id: null, supabase };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { id: user?.id ?? null, supabase };
}

export async function createAddress(
  _prev: AddressResult,
  formData: FormData,
): Promise<AddressResult> {
  const { id, supabase } = await currentUserId();
  if (!supabase || !id) return { error: 'Adres kaydetmek için giriş yapmalısınız.' };

  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const input = parsed.data;

  // İlk adres kendiliğinden varsayılan olur: tek adresi olan birinden
  // "varsayılanı seç" diye ayrıca bir hamle beklemek anlamsız.
  const { count } = await supabase
    .from('addresses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', id);

  const { error } = await supabase.from('addresses').insert({
    user_id: id,
    label: input.label || null,
    full_name: input.full_name,
    phone: input.phone,
    city: input.city,
    district: input.district,
    address_line: input.address_line,
    postal_code: input.postal_code || null,
    is_default: (count ?? 0) === 0,
  });

  if (error) return { error: 'Adres kaydedilemedi.' };

  revalidatePath('/adreslerim');
  revalidatePath('/odeme');
  return { ok: true };
}

export async function deleteAddress(formData: FormData): Promise<void> {
  const { id, supabase } = await currentUserId();
  if (!supabase || !id) return;

  const addressId = String(formData.get('address_id') ?? '');
  if (!addressId) return;

  // `eq('id')` tek başına yeterli değilmiş gibi görünebilir ama silme yetkisi
  // de politikadan gelir: başkasının kimliği verilse bile hiçbir satır
  // eşleşmez.
  await supabase.from('addresses').delete().eq('id', addressId);

  revalidatePath('/adreslerim');
  revalidatePath('/odeme');
}

export async function makeDefaultAddress(formData: FormData): Promise<void> {
  const { id, supabase } = await currentUserId();
  if (!supabase || !id) return;

  const addressId = String(formData.get('address_id') ?? '');
  if (!addressId) return;

  // Eski varsayılanı burada bırakmıyoruz: bunu veritabanı tetikleyicisi
  // yapıyor. İki yerde yapılsaydı, biri unutulduğunda kullanıcının iki
  // varsayılan adresi olurdu.
  await supabase.from('addresses').update({ is_default: true }).eq('id', addressId);

  revalidatePath('/adreslerim');
  revalidatePath('/odeme');
}
