import 'server-only';

/**
 * AI ayarının ortam değişkenlerinden okunması.
 *
 * BU DOSYA `server-only`. Ortam değişkeni ADLARI burada geçiyor ve burada
 * kalmalı: `packages/shared` istemci paketine de giriyor, oraya bir sır adı
 * yazmak `verify-secrets.mjs` denetimini kendi elimizle tetiklemek olurdu.
 * Saf çözümleme orada, adlar burada.
 *
 * GERİYE DÖNÜK: `ANTHROPIC_API_KEY` tek başına yeter ve bugünkü davranışın
 * aynısını verir. Yeni değişkenlerin hiçbiri zorunlu değil.
 */

import { cozumleAiAyari, type AiAyari } from '@ohaaaa/shared';

export function aiAyari(): AiAyari | null {
  return cozumleAiAyari({
    saglayici: process.env.AI_SAGLAYICI,
    apiKey: process.env.AI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.AI_BASE_URL,
    /*
     * Model adları için ESKİ değişkenler korunuyor: bugün bir ortamda
     * `SEARCH_INTENT_MODEL` tanımlıysa çalışmaya devam etmeli. Yeni ad
     * önceliklidir ki tek bir yerden yönetilebilsin.
     */
    aramaModeli: process.env.AI_ARAMA_MODELI || process.env.SEARCH_INTENT_MODEL,
    gorselModeli: process.env.AI_GORSEL_MODELI || process.env.VISUAL_SEARCH_MODEL,
    jsonModu: process.env.AI_JSON_MODU,
  });
}
