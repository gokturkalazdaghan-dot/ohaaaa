import 'server-only';

/**
 * Oturum yardımcıları (sunucu tarafı).
 *
 * Her sayfa kendi `getUser()` + profil sorgusunu yazmak yerine buradan okur;
 * böylece "rol kontrolünü unuttum" hatası tek yerde çözülür.
 */

import { createClient } from '@/lib/supabase/server';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  role: 'customer' | 'vendor' | 'admin';
}

export interface OwnedVendor {
  id: string;
  slug: string;
  displayName: string;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  commissionRate: number;
}

/** Oturumdaki kullanıcı ve profili. Oturum yoksa null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  // getSession() DEĞİL: o, çerezi doğrulamadan okur ve sahte çerezle
  // kandırılabilir. getUser() jetonu sunucuya doğrulatır.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('email, full_name, role')
    .eq('id', user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: profile?.email ? String(profile.email) : (user.email ?? ''),
    fullName: profile?.full_name ? String(profile.full_name) : null,
    role: (profile?.role as SessionUser['role']) ?? 'customer',
  };
}

/** Kullanıcının sahibi olduğu taşeron kaydı. RLS zaten başkasınınkini döndürmez. */
export async function getOwnedVendor(userId: string): Promise<OwnedVendor | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from('vendors')
    .select('id, slug, display_name, status, commission_rate')
    .eq('owner_id', userId)
    .maybeSingle();

  if (!data) return null;

  return {
    id: String(data.id),
    slug: String(data.slug),
    displayName: String(data.display_name),
    status: data.status as OwnedVendor['status'],
    commissionRate: Number(data.commission_rate),
  };
}
