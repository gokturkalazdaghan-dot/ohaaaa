import type { Metadata } from 'next';

import { ApiKeyManager, type ApiKeyRow } from '@/components/ApiKeyManager';
import { getOwnedVendor, getSessionUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/*
 * Oturuma bağlı sayfalar ASLA önbelleğe alınmamalıdır. Next, `cookies()`
 * çağrısını görürse rotayı kendiliğinden dinamik yapar — ama demo modunda
 * Supabase istemcisi çerezlere hiç dokunmadan null döndüğü için bu sinyal
 * oluşmuyor ve sayfa statik üretiliyordu. Bir satıcının verisinin
 * önbellekten başkasına servis edilmesi ihtimali, açık bir bildirimle
 * kapatılacak kadar ciddidir.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'API anahtarları',
  robots: { index: false, follow: false },
};

/**
 * Satıcının GERÇEK anahtarları.
 *
 * Anahtar ÖZETİ (`key_hash`) okunmuyor ve okunamaz: sütun yetkisi istemci
 * rollerinden alındı (bkz. 20260903160000). Panel zaten yalnızca adı,
 * öneki, son dört haneyi ve kullanım bilgisini gösteriyor.
 *
 * RLS satırı kendiliğinden daraltıyor (`owns_vendor(vendor_id)`), ama yine
 * de `vendor_id` ile açıkça süzülüyor: satır güvenliğine ek olarak sorgunun
 * kendisi de niyetini söylemeli.
 */
async function anahtarlariOku(): Promise<ApiKeyRow[]> {
  const user = await getSessionUser();
  if (!user) return [];

  const vendor = await getOwnedVendor(user.id);
  if (!vendor) return [];

  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('api_keys')
    .select(
      `id, name, environment, key_prefix, last_four, scopes,
       created_at, expires_at, revoked_at, last_used_at, request_count`,
    )
    .eq('vendor_id', vendor.id)
    .order('created_at', { ascending: false });

  if (error) {
    /*
     * Okunamazsa BOŞ liste dönüyoruz ve bu bilinçli: uydurma anahtar
     * göstermektense hiç göstermemek doğru. Hata kayda düşer.
     */
    console.error(
      JSON.stringify({ level: 'error', msg: 'API anahtarları okunamadı', error: error.message }),
    );
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>): ApiKeyRow => ({
    id: String(row.id),
    name: String(row.name),
    environment: row.environment === 'test' ? 'test' : 'live',
    key_prefix: String(row.key_prefix),
    last_four: String(row.last_four),
    scopes: (row.scopes as string[] | null) ?? [],
    created_at: String(row.created_at),
    expires_at: row.expires_at ? String(row.expires_at) : null,
    revoked: row.revoked_at !== null,
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    requestCount: Number(row.request_count ?? 0),
  }));
}

export default async function ApiKeysPage() {
  const anahtarlar = await anahtarlariOku();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-bold">API anahtarları</h2>
        <p className="mt-1 text-sm text-muted">
          Kataloğunuzu otomatik senkronize etmek için anahtar oluşturun. Her anahtara
          yalnızca ihtiyaç duyduğu yetkileri verin.
        </p>
      </header>

      <ApiKeyManager initialKeys={anahtarlar} />
    </div>
  );
}
