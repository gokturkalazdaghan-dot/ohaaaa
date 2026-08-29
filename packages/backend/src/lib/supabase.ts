/**
 * Supabase service_role istemcisi.
 *
 * service_role anahtarı RLS'i BYPASS EDER. Bu yüzden bu istemciyi kullanan
 * her sorgu, yetkilendirmeyi kendisi yapmak zorundadır — pratikte her
 * sorguya `vendor_id` koşulu eklemek demektir. `apiKeyAuth` middleware'i
 * req.vendor'ı doldurur; route'lar daima ondan gelen kimliği kullanır,
 * istemciden gelen vendor_id'ye asla güvenilmez.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Env } from '../config/env.js';

export type ServiceClient = SupabaseClient;

let client: ServiceClient | null = null;

export function getServiceClient(env: Env): ServiceClient {
  if (client) return client;

  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // Sunucu tarafında oturum yok: token yenileme ve kalıcılık kapatılır.
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: { 'x-application-name': 'ohaaaa-vendor-api' },
    },
  });

  return client;
}

/** Testlerde istemciyi sıfırlamak için. */
export function resetServiceClient(): void {
  client = null;
}
