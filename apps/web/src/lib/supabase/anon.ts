/**
 * Çerez kullanmayan sunucu-tarafı anon istemci.
 *
 * Katalog okumaları ve `generateStaticParams` bu istemciyi kullanır.
 * `next/headers` cookies() burada YOK — derleme sırasında statik sayfa
 * üretimi cookies() çağırınca Next build kırılıyor.
 */
import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from '../env';

export function createAnonClient() {
  if (!isSupabaseConfigured()) return null;

  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
