/**
 * POST /api/postback/:merchant — ortaklık ağından dönüşüm bildirimi.
 *
 * Bu uç nokta GELİRİN KAYDEDİLDİĞİ yerdir. İki şey kritiktir:
 *
 *   1. İMZA DOĞRULAMA. Doğrulanmamış bir postback uç noktası, herkesin
 *      "bana 50.000 TL komisyon yaz" diyebildiği bir formdur. Raporlar
 *      kirlenir, ağla yapılan mutabakat çöker.
 *
 *   2. İDEMPOTENTLİK. Ağlar aynı satışı defalarca bildirir (onay, iptal,
 *      düzeltme). Her bildirim yeni satır açsaydı ciro katlanırdı.
 *      `record_conversion` bunu (merchant_id, network_order_id) üzerinden
 *      çözer.
 *
 * İmza şeması: HMAC-SHA256(gövde, merchants.postback_secret), hex.
 * Ağ farklı bir şema kullanıyorsa `verifySignature` içinde ona uyarlanır —
 * ama doğrulamasız kabul YAPILMAZ.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/**
 * Ortak postback şeması.
 *
 * Ağların alan adları farklıdır; yeni bir ağ eklerken burada eşleme yapılır.
 * Tutarlar KURUŞ cinsinden beklenir; ağ ondalıklı gönderiyorsa
 * `amount_is_major: true` ile bildirilir.
 */
const postbackSchema = z.object({
  order_id: z.string().min(1).max(200),
  subid: z.string().max(200).nullish(),
  status: z.enum(['pending', 'approved', 'rejected', 'paid']),
  amount: z.number().nonnegative(),
  commission: z.number().nonnegative(),
  currency: z.string().length(3).default('TRY'),
  amount_is_major: z.boolean().default(false),
  occurred_at: z.string().datetime().nullish(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ merchant: string }> },
) {
  const { merchant: merchantSlug } = await context.params;

  // Ham gövde İMZA İÇİN gereklidir: JSON.parse edilip yeniden
  // serileştirilirse baytlar değişir ve imza tutmaz.
  const rawBody = await request.text();

  const supabase = getServiceClient();

  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('id, slug, status, postback_secret')
    .eq('slug', merchantSlug)
    .maybeSingle();

  if (merchantError) {
    return json({ error: { code: 'internal_error', message: 'Mağaza okunamadı.' } }, 500);
  }

  if (!merchant) {
    return json({ error: { code: 'not_found', message: 'Mağaza bulunamadı.' } }, 404);
  }

  // Sırrı tanımlanmamış bir mağaza için postback KABUL EDİLMEZ.
  // "Şimdilik doğrulamayı atlayalım" kararı, kalıcı bir açık hâline gelir.
  if (!merchant.postback_secret) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Postback sırrı tanımsız — bildirim reddedildi',
        merchant: merchantSlug,
      }),
    );

    return json(
      { error: { code: 'forbidden', message: 'Bu mağaza için doğrulama yapılandırılmamış.' } },
      403,
    );
  }

  const signature =
    request.headers.get('x-signature') ??
    request.headers.get('x-hub-signature-256') ??
    '';

  if (!verifySignature(rawBody, signature, String(merchant.postback_secret))) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Geçersiz postback imzası',
        merchant: merchantSlug,
      }),
    );

    return json({ error: { code: 'unauthorized', message: 'İmza doğrulanamadı.' } }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: { code: 'validation_failed', message: 'Geçersiz JSON.' } }, 400);
  }

  const parsed = postbackSchema.safeParse(payload);

  if (!parsed.success) {
    return json(
      {
        error: {
          code: 'validation_failed',
          message: 'Bildirim doğrulanamadı.',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      422,
    );
  }

  const input = parsed.data;

  // Ağ TL cinsinden gönderiyorsa kuruşa çevir. Yuvarlama aşağı değil, en
  // yakına yapılır: burada bir tahmin değil, bildirilen gerçek tutar var.
  const toCents = (value: number) =>
    input.amount_is_major ? Math.round(value * 100) : Math.round(value);

  const { data, error } = await supabase.rpc('record_conversion', {
    p_merchant_id: merchant.id,
    p_network_order_id: input.order_id,
    p_subid: input.subid ?? null,
    p_status: input.status,
    p_order_total_cents: toCents(input.amount),
    p_commission_cents: toCents(input.commission),
    p_currency: input.currency.toUpperCase(),
    p_occurred_at: input.occurred_at ?? new Date().toISOString(),
    p_raw: payload,
  });

  if (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Dönüşüm kaydedilemedi',
        merchant: merchantSlug,
        order_id: input.order_id,
        error: error.message,
      }),
    );

    // 5xx döndürmek önemlidir: ağlar başarısız postback'i tekrar dener.
    // 200 dönersek satış kalıcı olarak kaybolur.
    return json({ error: { code: 'internal_error', message: 'Kaydedilemedi.' } }, 500);
  }

  const conversion = data as { id: string; click_id: string | null } | null;

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'Dönüşüm kaydedildi',
      merchant: merchantSlug,
      order_id: input.order_id,
      status: input.status,
      attributed: Boolean(conversion?.click_id),
    }),
  );

  return json({ data: { received: true, attributed: Boolean(conversion?.click_id) } }, 200);
}

/**
 * HMAC-SHA256 imza doğrulaması, sabit zamanlı karşılaştırmayla.
 *
 * Düz `===` karşılaştırması ilk farklı baytta döner; saldırgan yanıt süresini
 * ölçerek geçerli imzayı bayt bayt türetebilir.
 */
function verifySignature(body: string, provided: string, secret: string): boolean {
  if (!provided) return false;

  // "sha256=" öneki bazı ağlarda bulunur.
  const cleaned = provided.startsWith('sha256=') ? provided.slice(7) : provided;

  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  const providedBuffer = Buffer.from(cleaned.toLowerCase(), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
