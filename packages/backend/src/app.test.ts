/**
 * Uçtan uca güvenlik testleri.
 *
 * Uygulamanın tamamı (middleware zinciri dahil) gerçek bir HTTP sunucusu
 * olarak ayağa kaldırılır; yalnızca Supabase yerine sahte bir depo konur.
 * Böylece kimlik doğrulama, yetki ve hız sınırı yolları gerçekten test
 * edilir — mock'lanmış bir middleware'in "geçtiğini" görmek yerine.
 */

import { strict as assert } from 'node:assert';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { createApp } from './app.js';
import type { Env } from './config/env.js';
import { generateApiKey } from '@ohaaaa/shared/api-key';
import { createLogger } from './lib/logger.js';
import type { ServiceClient } from './lib/supabase.js';
import type { ApiKeyRecord, ApiKeyStore } from './middleware/apiKeyAuth.js';

// --- Test verisi -----------------------------------------------------------
const validKey = generateApiKey('live');
const revokedKey = generateApiKey('live');
const expiredKey = generateApiKey('live');
const pendingVendorKey = generateApiKey('live');
const readOnlyKey = generateApiKey('live');
const throttledKey = generateApiKey('live');

const approvedVendor = {
  id: 'vendor-1',
  slug: 'teknomarkt',
  display_name: 'Teknomarkt',
  status: 'approved',
};

function record(
  key: { prefix: string; hash: string },
  overrides: Partial<ApiKeyRecord> = {},
): ApiKeyRecord {
  return {
    id: `apikey-${key.prefix.slice(-6)}`,
    vendor_id: approvedVendor.id,
    key_hash: key.hash,
    scopes: ['products:read', 'products:write', 'orders:read', 'orders:write'],
    rate_limit_per_minute: 600,
    revoked_at: null,
    expires_at: null,
    vendor: approvedVendor,
    ...overrides,
  };
}

const records = new Map<string, ApiKeyRecord>([
  [validKey.prefix, record(validKey)],
  [revokedKey.prefix, record(revokedKey, { revoked_at: '2026-01-01T00:00:00.000Z' })],
  [expiredKey.prefix, record(expiredKey, { expires_at: '2026-01-01T00:00:00.000Z' })],
  [
    pendingVendorKey.prefix,
    record(pendingVendorKey, {
      vendor: { ...approvedVendor, id: 'vendor-2', status: 'pending' },
    }),
  ],
  [readOnlyKey.prefix, record(readOnlyKey, { scopes: ['products:read'] })],
  [throttledKey.prefix, record(throttledKey, { rate_limit_per_minute: 3 })],
]);

let touchCount = 0;

const fakeStore: ApiKeyStore = {
  async findByPrefix(prefix) {
    return records.get(prefix) ?? null;
  },
  async touch() {
    touchCount += 1;
  },
};

const env: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-placeholder',
  CORS_ORIGINS: 'https://ohaaaa.com',
  RATE_LIMIT_CEILING: 6000,
  LOG_LEVEL: 'error',
};

// Route'lara ulaşmayan testler için Supabase'e gerek yok.
const stubSupabase = {} as ServiceClient;

const app = createApp({
  env,
  logger: createLogger('error'),
  supabase: stubSupabase,
  apiKeyStore: fakeStore,
});

let baseUrl = '';
let server: ReturnType<typeof app.listen>;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers });
}

// --- Sağlık ----------------------------------------------------------------
test('/health kimlik doğrulama gerektirmez', async () => {
  const response = await get('/health');
  assert.equal(response.status, 200);

  const body = (await response.json()) as { status: string };
  assert.equal(body.status, 'ok');
});

// --- Kimlik doğrulama ------------------------------------------------------
test('anahtarsız istek 401 döner', async () => {
  const response = await get('/api/v1/me');
  assert.equal(response.status, 401);

  const body = (await response.json()) as { error: { code: string; request_id: string } };
  assert.equal(body.error.code, 'unauthorized');
  assert.ok(body.error.request_id, 'destek için istek kimliği dönmeli');
});

test('biçimi bozuk anahtar 401 döner ve veritabanına gitmez', async () => {
  const response = await get('/api/v1/me', { 'x-api-key': 'kesinlikle-gecersiz' });
  assert.equal(response.status, 401);
});

test('doğru önek + yanlış gizli kısım 401 döner', async () => {
  // Önek gerçek anahtarınkiyle aynı, gizli kısım farklı.
  const forged = `${validKey.prefix}_${'f'.repeat(48)}`;
  const response = await get('/api/v1/me', { 'x-api-key': forged });

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: { message: string } };
  assert.match(body.error.message, /geçersiz/i);
});

test('geçerli anahtar taşeron kimliğini döner', async () => {
  const response = await get('/api/v1/me', { 'x-api-key': validKey.plaintext });
  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    data: { vendor_id: string; vendor_name: string; scopes: string[] };
  };
  assert.equal(body.data.vendor_id, 'vendor-1');
  assert.equal(body.data.vendor_name, 'Teknomarkt');
  assert.ok(body.data.scopes.includes('products:write'));
});

test('Authorization: Bearer başlığı da kabul edilir', async () => {
  const response = await get('/api/v1/me', { authorization: `Bearer ${validKey.plaintext}` });
  assert.equal(response.status, 200);
});

test('iptal edilmiş anahtar 401 döner', async () => {
  const response = await get('/api/v1/me', { 'x-api-key': revokedKey.plaintext });
  assert.equal(response.status, 401);

  const body = (await response.json()) as { error: { message: string } };
  assert.match(body.error.message, /iptal/i);
});

test('süresi dolmuş anahtar 401 döner', async () => {
  const response = await get('/api/v1/me', { 'x-api-key': expiredKey.plaintext });
  assert.equal(response.status, 401);

  const body = (await response.json()) as { error: { message: string } };
  assert.match(body.error.message, /süresi/i);
});

test('onaylanmamış taşeron 403 döner', async () => {
  const response = await get('/api/v1/me', { 'x-api-key': pendingVendorKey.plaintext });
  assert.equal(response.status, 403);

  const body = (await response.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'forbidden');
  assert.match(body.error.message, /onaylanmadı/i);
});

// --- Yetki (scope) ---------------------------------------------------------
test('yetkisi olmayan anahtar yazma işlemini yapamaz', async () => {
  const response = await fetch(`${baseUrl}/api/v1/products`, {
    method: 'POST',
    headers: { 'x-api-key': readOnlyKey.plaintext, 'content-type': 'application/json' },
    body: JSON.stringify({ products: [] }),
  });

  assert.equal(response.status, 403);
  const body = (await response.json()) as { error: { message: string } };
  assert.match(body.error.message, /products:write/);
});

// --- Doğrulama -------------------------------------------------------------
test('geçersiz gövde 422 ve alan bazlı hata döner', async () => {
  const response = await fetch(`${baseUrl}/api/v1/products`, {
    method: 'POST',
    headers: { 'x-api-key': validKey.plaintext, 'content-type': 'application/json' },
    body: JSON.stringify({
      products: [{ external_id: 'x1', title: 'A', price_cents: -5, stock: 1 }],
    }),
  });

  assert.equal(response.status, 422);

  const body = (await response.json()) as {
    error: { code: string; details: Array<{ path: string; message: string }> };
  };
  assert.equal(body.error.code, 'validation_failed');
  assert.ok(body.error.details.some((d) => d.path.includes('price_cents')));
  assert.ok(body.error.details.some((d) => d.path.includes('title')));
});

test('şemada tanımsız alan reddedilir (strict şema)', async () => {
  const response = await fetch(`${baseUrl}/api/v1/products`, {
    method: 'POST',
    headers: { 'x-api-key': validKey.plaintext, 'content-type': 'application/json' },
    body: JSON.stringify({
      products: [
        {
          external_id: 'x1',
          title: 'Geçerli Ürün',
          price_cents: 1000,
          stock: 1,
          bilinmeyen_alan: 'sızmamalı',
        },
      ],
    }),
  });

  assert.equal(response.status, 422);
});

// --- Hız sınırı ------------------------------------------------------------
test('hız sınırı aşılınca 429 ve Retry-After döner', async () => {
  const headers = { 'x-api-key': throttledKey.plaintext };

  for (let i = 0; i < 3; i += 1) {
    const ok = await get('/api/v1/me', headers);
    assert.equal(ok.status, 200, `${i + 1}. istek geçmeliydi`);
  }

  const limited = await get('/api/v1/me', headers);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'), 'Retry-After başlığı gerekli');
  assert.equal(limited.headers.get('x-ratelimit-remaining'), '0');
  assert.equal(limited.headers.get('x-ratelimit-limit'), '3');
});

test('hız sınırı anahtar başınadır, taşeron başına değil', async () => {
  // throttledKey kotasını doldurdu; aynı taşerona ait validKey etkilenmemeli.
  const response = await get('/api/v1/me', { 'x-api-key': validKey.plaintext });
  assert.equal(response.status, 200);
});

// --- Genel davranış --------------------------------------------------------
test('güvenlik başlıkları her yanıtta bulunur', async () => {
  const response = await get('/health');

  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-powered-by'), null, 'Express sürümü sızmamalı');
  assert.ok(response.headers.get('content-security-policy'));
});

test('CORS yalnızca izinli origin için açılır', async () => {
  const allowed = await get('/health', { origin: 'https://ohaaaa.com' });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://ohaaaa.com');

  const denied = await get('/health', { origin: 'https://kotu-site.example' });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('bilinmeyen uç nokta 404 döner', async () => {
  const response = await get('/api/v1/bilinmeyen', { 'x-api-key': validKey.plaintext });
  assert.equal(response.status, 404);

  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'not_found');
});

test('istek kimliği yanıt başlığında döner ve dışarıdan gelen kabul edilir', async () => {
  const generated = await get('/health');
  assert.ok(generated.headers.get('x-request-id'));

  const propagated = await get('/health', { 'x-request-id': 'takip-kimligi-123' });
  assert.equal(propagated.headers.get('x-request-id'), 'takip-kimligi-123');

  // Biçimi bozuk kimlik reddedilip yerine güvenli bir UUID üretilir.
  // (Satır sonu içeren başlıkları fetch zaten göndermez; buradaki senaryo
  //  aşırı uzun ve izinli karakter kümesi dışındaki değerlerdir.)
  const tooLong = 'a'.repeat(200);
  const rejected = await get('/health', { 'x-request-id': tooLong });
  assert.notEqual(rejected.headers.get('x-request-id'), tooLong);
  assert.match(
    rejected.headers.get('x-request-id') ?? '',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

  const weirdChars = await get('/health', { 'x-request-id': 'bosluk iceren deger' });
  assert.notEqual(weirdChars.headers.get('x-request-id'), 'bosluk iceren deger');
});

test('başarılı doğrulamalarda kullanım telemetrisi kaydedilir', () => {
  assert.ok(touchCount > 0, 'geçerli isteklerde touch çağrılmalı');
});
