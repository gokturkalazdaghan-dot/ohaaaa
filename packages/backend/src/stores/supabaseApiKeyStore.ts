/**
 * ApiKeyStore'un Supabase uygulaması.
 *
 * `touch` çağrıları toplu (batched) yapılır: her istekte tek satırlık bir
 * UPDATE atmak, yüksek hacimli beslemelerde veritabanına isteğin kendisi
 * kadar yük bindirir. Bunun yerine sayaçlar bellekte biriktirilip periyodik
 * olarak tek seferde yazılır.
 */

import type { ApiKeyRecord, ApiKeyStore } from '../middleware/apiKeyAuth.js';
import type { ServiceClient } from '../lib/supabase.js';

const FLUSH_INTERVAL_MS = 15_000;

interface PendingTouch {
  count: number;
  lastUsedAt: string;
  ip: string | null;
}

export function createSupabaseApiKeyStore(
  supabase: ServiceClient,
  options: { flushIntervalMs?: number } = {},
): ApiKeyStore & { flush(): Promise<void>; stop(): void } {
  const pending = new Map<string, PendingTouch>();

  async function findByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
    const { data, error } = await supabase
      .from('api_keys')
      .select(
        `id, vendor_id, key_hash, scopes, rate_limit_per_minute, revoked_at, expires_at,
         vendor:vendors!inner ( id, slug, display_name, status )`,
      )
      .eq('key_prefix', prefix)
      .maybeSingle();

    if (error) throw new Error(`API anahtarı sorgulanamadı: ${error.message}`);
    if (!data) return null;

    // PostgREST tekil ilişkiyi ortama göre dizi ya da nesne döndürebilir.
    const rawVendor = (data as Record<string, unknown>).vendor;
    const vendor = (Array.isArray(rawVendor) ? rawVendor[0] : rawVendor) as
      | Record<string, unknown>
      | null
      | undefined;

    return {
      id: String(data.id),
      vendor_id: String(data.vendor_id),
      key_hash: String(data.key_hash),
      scopes: (data.scopes as string[] | null) ?? [],
      rate_limit_per_minute: Number(data.rate_limit_per_minute),
      revoked_at: data.revoked_at ? String(data.revoked_at) : null,
      expires_at: data.expires_at ? String(data.expires_at) : null,
      vendor: vendor
        ? {
            id: String(vendor.id),
            slug: String(vendor.slug),
            display_name: String(vendor.display_name),
            status: String(vendor.status),
          }
        : null,
    };
  }

  async function touch(apiKeyId: string, ip: string | null): Promise<void> {
    const existing = pending.get(apiKeyId);

    pending.set(apiKeyId, {
      count: (existing?.count ?? 0) + 1,
      lastUsedAt: new Date().toISOString(),
      ip,
    });
  }

  async function flush(): Promise<void> {
    if (pending.size === 0) return;

    const batch = [...pending.entries()];
    pending.clear();

    await Promise.all(
      batch.map(async ([apiKeyId, touchData]) => {
        const { error } = await supabase.rpc('touch_api_key', {
          p_api_key_id: apiKeyId,
          p_count: touchData.count,
          p_last_used_at: touchData.lastUsedAt,
          p_ip: touchData.ip,
        });

        // Kullanım telemetrisi kaybı, isteği düşürmeyi haklı çıkarmaz.
        if (error) {
          console.error(
            JSON.stringify({
              level: 'warn',
              msg: 'API anahtarı kullanım sayacı yazılamadı',
              api_key_id: apiKeyId,
              error: error.message,
            }),
          );
        }
      }),
    );
  }

  const timer = setInterval(() => {
    void flush();
  }, options.flushIntervalMs ?? FLUSH_INTERVAL_MS);

  // Zamanlayıcı, süreç kapanışını engellememeli.
  timer.unref?.();

  return {
    findByPrefix,
    touch,
    flush,
    stop: () => clearInterval(timer),
  };
}
