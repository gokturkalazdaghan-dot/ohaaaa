'use server';

/**
 * Favori işlemleri.
 *
 * Yazma KULLANICININ OTURUMUYLA yapılır: "kendi favorisine dokunabilir"
 * kuralı `favorites_own_all` politikasında yaşıyor. `user_id`'yi de biz
 * koymuyoruz -- oturumdan gelen `auth.uid()` ile eşleşmeyen satır
 * politikanın `with check` tarafından reddedilir.
 *
 * İstemci ürünü SLUG ile tanır (adres çubuğunda o var); veritabanı ise ürün
 * grubunun kimliğiyle. Çeviri burada, sunucuda yapılır: istemciden gelen bir
 * grup kimliğine güvenmek, favoriyi başka bir ürüne yazdırmanın yolu olurdu.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

const toggleInput = z.object({
  slug: z.string().trim().min(1).max(200),
  saved_price_cents: z.coerce.number().int().min(0).optional(),
});

export interface FavoriteToggleResult {
  /** İşlem sonrası ürün favoride mi? Bilinemiyorsa null. */
  active?: boolean | null;
  error?: string;
}

async function groupIdForSlug(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  slug: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('product_groups')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  return data?.id ? String(data.id) : null;
}

export async function toggleFavoriteOnServer(
  input: z.input<typeof toggleInput>,
): Promise<FavoriteToggleResult> {
  const supabase = await createClient();
  if (!supabase) return { active: null };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Misafir: favori tarayıcıda tutulur, sunucuda yapılacak bir şey yok.
  if (!user) return { active: null };

  const parsed = toggleInput.safeParse(input);
  if (!parsed.success) return { error: 'Geçersiz istek.' };

  const groupId = await groupIdForSlug(supabase, parsed.data.slug);
  if (!groupId) return { error: 'Ürün bulunamadı.' };

  const { data: existing } = await supabase
    .from('favorites')
    .select('id')
    .eq('group_id', groupId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('favorites').delete().eq('id', existing.id);
    if (error) return { error: 'Favoriden çıkarılamadı.' };
    revalidatePath('/favoriler');
    return { active: false };
  }

  const { error } = await supabase.from('favorites').insert({
    user_id: user.id,
    group_id: groupId,
    saved_price_cents: parsed.data.saved_price_cents ?? null,
  });

  if (error) return { error: 'Favorilere eklenemedi.' };
  revalidatePath('/favoriler');
  return { active: true };
}

/**
 * Girişten sonra cihazdaki listeyi hesaba taşır.
 *
 * Misafirken işaretlenen ürünler giriş yapınca kaybolmamalı: kullanıcı
 * açısından aynı listedir. Var olan kayıtlar KORUNUR (`ignoreDuplicates`),
 * çünkü hesaptaki kayıt anındaki fiyat, cihazdakinden daha eski ve daha
 * doğru olabilir.
 */
export async function mergeLocalFavorites(
  items: Array<{ slug: string; saved_price_cents?: number | null }>,
): Promise<{ merged: number }> {
  const supabase = await createClient();
  if (!supabase) return { merged: 0 };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { merged: 0 };

  // Üst sınır: istemciden gelen listeye güvenilmez, uzunluğu da dahil.
  const safe = items.slice(0, 100);
  if (safe.length === 0) return { merged: 0 };

  const slugs = safe
    .map((item) => String(item.slug ?? '').trim())
    .filter((slug) => slug.length > 0 && slug.length <= 200);
  if (slugs.length === 0) return { merged: 0 };

  const { data: groups } = await supabase
    .from('product_groups')
    .select('id, slug')
    .in('slug', slugs);

  if (!groups || groups.length === 0) return { merged: 0 };

  const bySlug = new Map(groups.map((row) => [String(row.slug), String(row.id)]));

  const rows = safe
    .map((item) => {
      const groupId = bySlug.get(String(item.slug ?? '').trim());
      if (!groupId) return null;
      const price = Number(item.saved_price_cents);
      return {
        user_id: user.id,
        group_id: groupId,
        saved_price_cents: Number.isFinite(price) && price >= 0 ? Math.trunc(price) : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return { merged: 0 };

  const { error } = await supabase
    .from('favorites')
    .upsert(rows, { onConflict: 'user_id,group_id', ignoreDuplicates: true });

  if (error) return { merged: 0 };

  revalidatePath('/favoriler');
  return { merged: rows.length };
}

/**
 * Hesaptaki favori listesi.
 *
 * Misafirde `null` döner -- boş dizi DEĞİL. Aradaki fark önemli: boş dizi
 * "hesabında favori yok" demek, `null` ise "hesap yok, cihazdaki listeye
 * bak" demek. İkisini aynı değere indirseydik, misafirin tarayıcıdaki
 * favorileri giriş yapmadan da boş görünürdü.
 */
export async function listServerFavorites(): Promise<
  Array<{ slug: string; title: string; imageUrl: string | null; savedPriceCents: number | null; savedAt: number }> | null
> {
  const supabase = await createClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('favorites')
    .select('saved_price_cents, created_at, group:product_groups!group_id ( slug, title, image_url )')
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data
    .map((row: Record<string, unknown>) => {
      const raw = row.group;
      const group = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null;
      if (!group?.slug) return null;

      return {
        slug: String(group.slug),
        title: String(group.title ?? ''),
        imageUrl: group.image_url ? String(group.image_url) : null,
        savedPriceCents:
          row.saved_price_cents === null || row.saved_price_cents === undefined
            ? null
            : Number(row.saved_price_cents),
        savedAt: new Date(String(row.created_at)).getTime(),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}
