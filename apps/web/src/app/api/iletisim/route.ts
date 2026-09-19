/**
 * POST /api/iletisim — iletişim formu.
 *
 * İstemci doğrulaması bir KOLAYLIKTIR, güvenlik önlemi değildir: form
 * doğrudan curl ile de çağrılabilir. Bu yüzden aynı şema burada tekrar
 * uygulanır.
 *
 * HIZ SINIRI VERİTABANINDA, BELLEKTE DEĞİL.
 *
 * Burada bellekte IP başına bir `Map` vardı ve yorumu koşulu yazıyordu:
 * "tek örnekli kurulumda yeterlidir". Üretim Vercel sunucusuz -- o koşul
 * hiçbir zaman sağlanmadı: her soğuk başlangıç sayacı sıfırlar ve
 * eşzamanlı örnekler birbirini görmez. Yani uygulanmayan ama uygulanıyor
 * görünen bir sınırdı; bu hiç sınır olmamasından daha kötüdür, çünkü
 * bakan kişiyi yanıltır.
 *
 * Artık `tuketButce` kullanılıyor: sayaç `consume_rate_budget` ile
 * veritabanında ve bütün örnekler aynı sayacı görüyor.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { tuketButce } from '@/lib/rateBudget';

export const dynamic = 'force-dynamic';

const contactSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  subject: z.enum(['duzeltme', 'satici', 'destek', 'kvkk', 'diger']),
  message: z.string().min(20).max(4000),
});

export async function POST(request: NextRequest) {
  const butce = await tuketButce('iletisim', new Headers(request.headers));

  if (!butce.izin) {
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
