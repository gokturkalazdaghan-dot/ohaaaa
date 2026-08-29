/**
 * Sunucu tarafı service_role istemcisi.
 *
 * RLS'i BYPASS EDER. Yalnızca yetkiyi kendisi doğrulayan kod yollarında
 * kullanılır: yönlendirme (mağaza sırlarını okur) ve dönüşüm postback'i
 * (imza doğruladıktan sonra yazar).
 *
 * `import 'server-only'` bu dosyanın yanlışlıkla istemci paketine
 * girmesini DERLEME ZAMANINDA engeller — service_role anahtarının
 * tarayıcıya sızması, bu projede yapılabilecek en ağır hatadır.
 */

import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanımlı olmalı (sunucu tarafı).',
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}
