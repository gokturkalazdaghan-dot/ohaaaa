'use client';

/** Tarayıcı tarafı Supabase istemcisi — yalnızca anon anahtarı kullanır. */

import { createBrowserClient } from '@supabase/ssr';

import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from '../env';

export function createClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase yapılandırılmamış. .env.example dosyasını .env olarak kopyalayıp doldurun.',
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
