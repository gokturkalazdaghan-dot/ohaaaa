/**
 * Sunucu tarafı Supabase istemcisi.
 *
 * Kullanıcının oturum çerezini taşır; böylece RLS politikaları oturumdaki
 * kullanıcı için değerlendirilir. Server Component'ler çerez yazamadığı
 * için `setAll` sessizce yutulur — token yenileme middleware'de yapılır.
 */

import { createServerClient } from '@supabase/ssr';

import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from '../env';

export async function createClient() {
  if (!isSupabaseConfigured()) return null;

  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: { getAll: () => [], setAll: () => {} },
    });
  }

  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component'ten çağrıldığında çerez yazılamaz; oturum
          // yenilemesi middleware'de yapıldığı için bu güvenli bir durumdur.
        }
      },
    },
  });
}
