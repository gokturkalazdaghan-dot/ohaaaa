/**
 * Sunucu giriş noktası.
 *
 * Zarif kapanış (graceful shutdown) uygulanır: SIGTERM alındığında yeni
 * bağlantı kabul edilmez, devam eden istekler tamamlanır ve bekleyen
 * telemetri veritabanına yazılır. Konteyner ortamlarında (Railway, Fly,
 * Cloud Run) bu olmadan her dağıtımda istek düşer.
 */

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { getServiceClient } from './lib/supabase.js';
import { createSupabaseApiKeyStore } from './stores/supabaseApiKeyStore.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const supabase = getServiceClient(env);
const apiKeyStore = createSupabaseApiKeyStore(supabase);

const app = createApp({ env, logger, supabase, apiKeyStore });

const server = app.listen(env.PORT, () => {
  logger.info('Ohaaaa taşeron API hazır', {
    port: env.PORT,
    env: env.NODE_ENV,
    docs: '/api/v1/me ile entegrasyonunuzu doğrulayın',
  });
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('Kapanış başlatıldı', { signal });

  // Yeni bağlantı alma, devam edenleri bitir.
  server.close(async () => {
    try {
      apiKeyStore.stop();
      await apiKeyStore.flush();
      logger.info('Kapanış tamamlandı');
      process.exit(0);
    } catch (error) {
      logger.error('Kapanış sırasında hata', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  });

  // Askıda kalan bağlantılar süreci sonsuza dek tutmasın.
  setTimeout(() => {
    logger.warn('Zarif kapanış zaman aşımına uğradı, süreç sonlandırılıyor');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('İşlenmeyen promise reddi', { reason: String(reason) });
});
