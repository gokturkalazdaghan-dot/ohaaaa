/**
 * `direct` — doğrudan mağaza anlaşması.
 *
 * Bu sağlayıcı YENİ DAVRANIŞ GETİRMEZ. `/api/postback/:merchant` içinde
 * hâlihazırda çalışan generic HMAC doğrulaması ve şeması buraya, sözleşmenin
 * arkasına taşındı. Amaç: registry'nin varsayılan yolu, bugün üretimde ne
 * yapıyorsak tam olarak onu yapsın.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import {
  ProviderError,
  type AffiliateProvider,
  type NormalizedConversion,
  type PostbackContext,
} from './types.js';

/**
 * Mevcut şema — alan adları ve kuralları route'taki hâliyle aynı.
 * Tutarlar kuruş beklenir; ağ ondalıklı gönderiyorsa `amount_is_major`.
 */
const directPostbackSchema = z.object({
  order_id: z.string().min(1).max(200),
  subid: z.string().max(200).nullish(),
  status: z.enum(['pending', 'approved', 'rejected', 'paid']),
  amount: z.number().nonnegative(),
  commission: z.number().nonnegative(),
  currency: z.string().length(3).default('TRY'),
  amount_is_major: z.boolean().default(false),
  occurred_at: z.string().datetime().nullish(),
});

/**
 * HMAC-SHA256, sabit zamanlı karşılaştırmayla.
 *
 * Düz `===` ilk farklı baytta döner; saldırgan yanıt süresini ölçerek geçerli
 * imzayı bayt bayt türetebilir.
 */
export function verifyHmacSha256(
  body: string,
  provided: string,
  secret: string,
): boolean {
  if (!provided) return false;

  // "sha256=" öneki bazı ağlarda bulunur.
  const cleaned = provided.startsWith('sha256=') ? provided.slice(7) : provided;

  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  const providedBuffer = Buffer.from(cleaned.toLowerCase(), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export const directProvider: AffiliateProvider = {
  network: 'direct',
  displayName: 'Doğrudan anlaşma',

  verifyPostback(context: PostbackContext): boolean {
    const signature =
      context.headers.get('x-signature') ??
      context.headers.get('x-hub-signature-256') ??
      '';

    return verifyHmacSha256(context.rawBody, signature, context.secret);
  },

  normalizePostback(payload: unknown): NormalizedConversion {
    const parsed = directPostbackSchema.safeParse(payload);

    if (!parsed.success) {
      throw new ProviderError(
        `Bildirim doğrulanamadı: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
        'invalid_payload',
      );
    }

    const input = parsed.data;

    // Ağ TL cinsinden gönderiyorsa kuruşa çevrilir. Yuvarlama en yakına
    // yapılır: burada tahmin değil, bildirilen gerçek tutar var.
    const toCents = (value: number) =>
      input.amount_is_major ? Math.round(value * 100) : Math.round(value);

    return {
      orderId: input.order_id,
      subid: input.subid ?? null,
      status: input.status,
      orderTotalCents: toCents(input.amount),
      commissionCents: toCents(input.commission),
      currency: input.currency.toUpperCase(),
      occurredAt: input.occurred_at ?? new Date().toISOString(),
    };
  },
};
