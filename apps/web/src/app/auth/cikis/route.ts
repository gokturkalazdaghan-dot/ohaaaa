/**
 * POST /auth/cikis — oturumu kapat.
 *
 * GET DEĞİL, POST: bir GET bağlantısı, kullanıcıyı `<img src="/auth/cikis">`
 * içeren bir sayfayla istem dışı çıkış yaptırmaya açar (CSRF). Çıkış zararsız
 * görünse de kullanıcıyı rahatsız eden bir saldırı yüzeyidir.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();

  return NextResponse.redirect(new URL('/', request.nextUrl.origin), {
    // 303: POST sonrası GET ile yönlendir.
    status: 303,
  });
}
