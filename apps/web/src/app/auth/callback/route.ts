/**
 * GET /auth/callback — e-posta doğrulama ve parola sıfırlama dönüşü.
 *
 * Supabase, doğrulama bağlantısına tıklandığında kullanıcıyı buraya tek
 * kullanımlık bir kodla gönderir. Kod burada oturuma çevrilir.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/tasoron/panel';

  // Açık yönlendirme koruması — bkz. auth/actions.ts
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/tasoron/panel';

  if (!code) {
    return NextResponse.redirect(`${origin}/giris?hata=eksik_kod`);
  }

  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.redirect(`${origin}/giris?hata=yapilandirma`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Kod tek kullanımlıktır ve süresi dolabilir; kullanıcıya tekrar
    // denemesini söylemek, ham hata mesajı göstermekten yararlıdır.
    return NextResponse.redirect(`${origin}/giris?hata=gecersiz_kod`);
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
