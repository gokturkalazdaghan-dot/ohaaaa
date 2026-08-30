/**
 * Taşeron API'si — kimlik doğrulama, yetki ve hız sınırı.
 *
 * Bu katman `packages/backend`'deki Express middleware'inin karşılığıdır.
 * O uygulama HİÇBİR ZAMAN dağıtılmamıştı: taşeron API dokümantasyonu
 * canlıda `http://localhost:4000` adresini gösteriyordu, yani hiçbir satıcı
 * ürün gönderemiyordu. Uç noktalar siteyle aynı dağıtıma taşındı;
 * ayrı bir servis, ayrı bir alan adı ve CORS derdi ortadan kalktı.
 *
 * Akış:
 *   1. `x-api-key` başlığını oku (yoksa `Authorization: Bearer ohk_...`)
 *   2. Anahtarın BİÇİMİNİ doğrula → bozuksa veritabanına hiç gitme
 *   3. Öneki indeksli aramayla bul → tek satır
 *   4. SHA-256 özetini SABİT ZAMANDA karşılaştır
 *   5. İptal / süre / taşeron durumu
 *   6. Hız sınırı (veritabanı sayacı)
 */

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ApiScope } from '@ohaaaa/shared';
import { extractPrefix, hashApiKey, safeCompareHash } from '@ohaaaa/shared/api-key';

import { getServiceClient } from '@/lib/supabase/service';

/** Var olmayan anahtarlarda karşılaştırma yapmak için kullanılan kukla özet. */
const DUMMY_HASH = hashApiKey('ohaaaa-nonexistent-key-placeholder');

export interface AuthenticatedVendor {
  apiKeyId: string;
  vendorId: string;
  vendorSlug: string;
  vendorName: string;
  scopes: ApiScope[];
  rateLimitPerMinute: number;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'rate_limited'
  | 'payload_too_large'
  | 'internal_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  rate_limited: 429,
  payload_too_large: 413,
  internal_error: 500,
};

/**
 * Tek biçimli API hatası.
 *
 * `code` sözleşmenin parçasıdır: taşeronlar entegrasyonlarını ona göre kurar,
 * bu yüzden geriye dönük uyumluluk gözetilmeden değiştirilmemelidir.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly headers: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message: string,
    details?: unknown,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    this.headers = headers;
  }
}

/** Hata gövdesini tek biçimde döndürür. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status: error.status, headers: error.headers },
    );
  }

  // Beklenmeyen hatanın içeriği DIŞARI VERİLMEZ: yığın izi ve veritabanı
  // mesajları şema hakkında bilgi sızdırır. Sunucu günlüğüne tam hâliyle
  // yazılır, istemciye yalnızca genel bir mesaj gider.
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Taşeron API isteği başarısız',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );

  return Response.json(
    { error: { code: 'internal_error', message: 'Beklenmeyen bir hata oluştu.' } },
    { status: 500 },
  );
}

/** İstekten API anahtarını okur. */
function readKey(request: Request): string | null {
  const header = request.headers.get('x-api-key');
  if (header) return header.trim();

  const authorization = request.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return null;
}

interface ApiKeyRow {
  id: string;
  vendor_id: string;
  key_hash: string;
  scopes: string[];
  rate_limit_per_minute: number;
  revoked_at: string | null;
  expires_at: string | null;
  vendor: { id: string; slug: string; display_name: string; status: string } | null;
}

/**
 * İsteği doğrular ve taşeron kimliğini döndürür.
 *
 * Başarısızlıkta `ApiError` fırlatır — çağıran `errorResponse` ile sarar.
 */
export async function authenticate(
  request: Request,
  requiredScope: ApiScope,
): Promise<{ vendor: AuthenticatedVendor; supabase: SupabaseClient; rateHeaders: Record<string, string> }> {
  const presented = readKey(request);

  if (!presented) {
    throw new ApiError(
      'unauthorized',
      "API anahtarı bulunamadı. İsteğinize 'x-api-key' başlığını ekleyin.",
    );
  }

  const prefix = extractPrefix(presented);
  if (!prefix) {
    // Biçim bozuksa veritabanına gitmeye gerek yok — ucuz erken çıkış.
    throw new ApiError('unauthorized', 'API anahtarının biçimi geçersiz.');
  }

  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('api_keys')
    .select(
      `id, vendor_id, key_hash, scopes, rate_limit_per_minute, revoked_at, expires_at,
       vendor:vendors!vendor_id ( id, slug, display_name, status )`,
    )
    .eq('key_prefix', prefix)
    .maybeSingle();

  if (error) throw new Error(`Anahtar okunamadı: ${error.message}`);

  const raw = data as unknown as (Omit<ApiKeyRow, 'vendor'> & { vendor: unknown }) | null;
  const vendorRow = Array.isArray(raw?.vendor) ? raw?.vendor[0] : raw?.vendor;
  const record = raw
    ? ({ ...raw, vendor: (vendorRow as ApiKeyRow['vendor']) ?? null } as ApiKeyRow)
    : null;

  // Kayıt yoksa bile karşılaştırma yapılır: "anahtar yok" ile "anahtar yanlış"
  // yanıt süreleri ayrışmasın, aksi hâlde geçerli önekler zamanlamayla bulunur.
  const expectedHash = record?.key_hash ?? DUMMY_HASH;
  const matches = safeCompareHash(hashApiKey(presented), expectedHash);

  if (!record || !matches) {
    throw new ApiError('unauthorized', 'API anahtarı geçersiz.');
  }

  if (record.revoked_at !== null) {
    throw new ApiError('unauthorized', 'Bu API anahtarı iptal edilmiş.');
  }

  if (record.expires_at !== null && new Date(record.expires_at).getTime() <= Date.now()) {
    throw new ApiError('unauthorized', 'Bu API anahtarının süresi dolmuş.');
  }

  if (!record.vendor || record.vendor.status !== 'approved') {
    throw new ApiError(
      'forbidden',
      'Mağaza hesabınız henüz onaylanmamış ya da askıya alınmış.',
    );
  }

  const scopes = (record.scopes ?? []) as ApiScope[];
  if (!scopes.includes(requiredScope)) {
    throw new ApiError('forbidden', `Bu işlem için '${requiredScope}' yetkisi gerekiyor.`, {
      required: requiredScope,
      granted: scopes,
    });
  }

  const rateHeaders = await enforceRateLimit(supabase, record.id, record.rate_limit_per_minute);

  return {
    vendor: {
      apiKeyId: record.id,
      vendorId: record.vendor_id,
      vendorSlug: record.vendor.slug,
      vendorName: record.vendor.display_name,
      scopes,
      rateLimitPerMinute: record.rate_limit_per_minute,
    },
    supabase,
    rateHeaders,
  };
}

/**
 * Hız sınırı.
 *
 * Sayaç VERİTABANINDA tutulur, süreç belleğinde değil. Sunucusuz ortamda her
 * istek ayrı bir örnekte çalışabilir; bellekteki bir sayaç orada sıfırdan
 * başlar ve sınır görünürde var olup gerçekte uygulanmaz.
 */
async function enforceRateLimit(
  supabase: SupabaseClient,
  apiKeyId: string,
  limit: number,
): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_api_key_id: apiKeyId,
    p_limit: limit,
  });

  if (error) {
    // Sayaç okunamıyorsa isteği DÜŞÜRMÜYORUZ: hız sınırı bir koruma
    // önlemidir, servisin kendisi değil. Sayaç arızası yüzünden tüm
    // taşeron entegrasyonlarını durdurmak, korumanın verdiği faydadan
    // büyük bir zarar olurdu. Olay günlüğe yazılır.
    console.error(
      JSON.stringify({ level: 'error', msg: 'Hız sınırı sayacı okunamadı', error: error.message }),
    );
    return {};
  }

  const result = (data ?? {}) as {
    allowed?: boolean;
    limit?: number;
    remaining?: number;
    reset_at?: string;
  };

  const resetAt = result.reset_at ? new Date(result.reset_at) : new Date(Date.now() + 60_000);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));

  const headers: Record<string, string> = {
    'x-ratelimit-limit': String(result.limit ?? limit),
    'x-ratelimit-remaining': String(result.remaining ?? 0),
    'x-ratelimit-reset': String(Math.floor(resetAt.getTime() / 1000)),
  };

  if (result.allowed === false) {
    throw new ApiError(
      'rate_limited',
      `Dakikada ${limit} istek sınırını aştınız. ${retryAfterSeconds} saniye sonra tekrar deneyin.`,
      undefined,
      { ...headers, 'retry-after': String(retryAfterSeconds) },
    );
  }

  return headers;
}

/**
 * İstek kaydını yazar.
 *
 * Hataları YUTULUR: günlük yazamamak, taşerona başarılı bir isteği başarısız
 * göstermek için sebep değildir.
 */
export async function logRequest(input: {
  supabase: SupabaseClient;
  apiKeyId: string;
  vendorId: string;
  request: Request;
  path: string;
  statusCode: number;
  startedAt: number;
}): Promise<void> {
  try {
    await input.supabase.rpc('log_api_request', {
      p_api_key_id: input.apiKeyId,
      p_vendor_id: input.vendorId,
      p_method: input.request.method,
      p_path: input.path,
      p_status_code: input.statusCode,
      p_duration_ms: Math.round(performance.now() - input.startedAt),
      p_ip: clientIp(input.request),
      p_user_agent: input.request.headers.get('user-agent'),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'warn',
        msg: 'API istek kaydı yazılamadı',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * İstemci IP'si.
 *
 * `x-forwarded-for` bir listedir ve YALNIZCA ilk giriş istemciye aittir;
 * gerisi aradaki vekil sunuculardır. Ayrıca başlık istemci tarafından
 * uydurulabilir — bu yüzden değer güvenlik kararlarında değil, yalnızca
 * kayıt ve teşhiste kullanılır.
 */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip');
}
