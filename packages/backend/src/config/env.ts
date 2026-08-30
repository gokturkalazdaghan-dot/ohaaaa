/**
 * Ortam değişkeni doğrulaması.
 *
 * Uygulama, eksik yapılandırmayla AYAĞA KALKMAMALIDIR. Yanlış yapılandırılmış
 * bir servisin çalışıyormuş gibi görünüp isteklerde sessizce hata vermesi,
 * açılışta net bir hatayla durmasından çok daha pahalıdır.
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  /** Supabase proje URL'i. */
  SUPABASE_URL: z.string().url('SUPABASE_URL geçerli bir adres olmalı'),

  /**
   * service_role anahtarı — RLS'i bypass eder.
   * SADECE sunucuda kullanılır; istemciye asla gönderilmez.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY eksik'),

  /** Virgülle ayrılmış izinli origin listesi. '*' geliştirme içindir. */
  CORS_ORIGINS: z.string().default('*'),

  /** Anahtar başına dakikalık istek tavanının üst sınırı. */
  RATE_LIMIT_CEILING: z.coerce.number().int().min(1).default(6000),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Ortam değişkenleri geçersiz — sunucu başlatılamıyor:\n${details}\n\n` +
        `.env.example dosyasını .env olarak kopyalayıp doldurun.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Testlerde yapılandırmayı sıfırlamak için. */
export function resetEnvCache(): void {
  cached = null;
}
