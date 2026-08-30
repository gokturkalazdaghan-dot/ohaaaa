/**
 * POST /api/iletisim — iletişim formu.
 *
 * İstemci doğrulaması bir KOLAYLIKTIR, güvenlik önlemi değildir: form
 * doğrudan curl ile de çağrılabilir. Bu yüzden aynı şema burada tekrar
 * uygulanır.
 *
 * Kaba bir hız sınırı vardır: bellekte, IP başına. Tek örnekli kurulumda
 * yeterlidir; ölçeklenince Redis'e taşınmalıdır (bkz. docs/architecture.md §6).
 */

import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const contactSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  subject: z.enum(['duzeltme', 'satici', 'destek', 'kvkk', 'diger']),
  message: z.string().min(20).max(4000),
});

/** IP özeti → son gönderim zamanları. */
const recentSubmissions = new Map<string, number[]>();

const WINDOW_MS = 60 * 60 * 1000; // 1 saat
const MAX_PER_WINDOW = 5;

export async function POST(request: NextRequest) {
  const ipHash = hashIp(request);

  if (!allowSubmission(ipHash)) {
    return NextResponse.json(
      {
        error: {
          code: 'rate_limited',
          message: 'Çok fazla mesaj gönderdiniz. Lütfen bir süre sonra tekrar deneyin.',
        },
      },
      { status: 429 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Geçersiz JSON.' } },
      { status: 400 },
    );
  }

  const parsed = contactSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Form doğrulanamadı.',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 422 },
    );
  }

  /*
   * Şu an mesaj yalnızca yapısal log'a yazılır. E-posta sağlayıcısı
   * bağlandığında (Resend, Postmark, SES…) burası tek satırlık bir
   * gönderim çağrısına dönüşür.
   *
   * Mesaj İÇERİĞİ log'a yazılmaz: kullanıcı oraya kişisel bilgi yazmış
   * olabilir ve log'lar genelde daha geniş bir ekip tarafından görülür.
   */
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'İletişim formu alındı',
      subject: parsed.data.subject,
      from: parsed.data.email,
      message_length: parsed.data.message.length,
      received_at: new Date().toISOString(),
    }),
  );

  return NextResponse.json({ data: { received: true } }, { status: 200 });
}

function allowSubmission(key: string): boolean {
  const now = Date.now();
  const timestamps = (recentSubmissions.get(key) ?? []).filter(
    (time) => now - time < WINDOW_MS,
  );

  if (timestamps.length >= MAX_PER_WINDOW) {
    recentSubmissions.set(key, timestamps);
    return false;
  }

  timestamps.push(now);
  recentSubmissions.set(key, timestamps);

  // Bellek sızıntısını önlemek için ara sıra temizle.
  if (recentSubmissions.size > 10_000) {
    for (const [candidate, times] of recentSubmissions) {
      if (times.every((time) => now - time >= WINDOW_MS)) {
        recentSubmissions.delete(candidate);
      }
    }
  }

  return true;
}

/** IP ham saklanmaz; yalnızca hız sınırı anahtarı olarak özetlenir. */
function hashIp(request: NextRequest): string {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}
