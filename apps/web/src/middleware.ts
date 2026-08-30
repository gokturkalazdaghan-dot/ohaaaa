/**
 * Oturum yenileme middleware'i.
 *
 * NEDEN ZORUNLU: Supabase erişim jetonu (access token) kısa ömürlüdür.
 * Server Component'ler çerez YAZAMAZ — yalnızca okuyabilir. Dolayısıyla
 * jetonu yenileyecek tek yer middleware'dir. Bu dosya olmadan kullanıcılar
 * bir saat sonra sessizce oturumdan düşer ve "neden çıkış yaptım?" diye
 * sorarlar.
 *
 * Ayrıca korumalı yolları burada kapatıyoruz: sayfanın içinde kontrol etmek,
 * korumasız bir sayfa eklendiğinde unutulmaya açıktır. Tek kapı daha güvenli.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Oturum gerektiren yollar. Alt yolları da kapsar. */
const PROTECTED_PREFIXES = ['/tasoron/panel', '/yonetim', '/hesap'];

/** Yalnızca admin rolünün girebileceği yollar. */
const ADMIN_PREFIXES = ['/yonetim'];

/** Oturum açıkken anlamsız olan yollar. */
const GUEST_ONLY = ['/giris', '/kayit'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Supabase yapılandırılmamışsa (demo modu) auth akışı yoktur; panel
  // örnek verilerle gezilebilir kalmalı.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key || url.includes('xxxxxxxxxxxx')) {
    return NextResponse.next();
  }

  // Yanıt nesnesi ÖNCE oluşturulur: Supabase yenilenmiş çerezleri buraya yazar.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Çerezler HEM isteğe (aşağı akıştaki Server Component'ler okusun)
        // HEM yanıta (tarayıcı saklasın) yazılmalıdır.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  /*
   * getUser() ÇAĞRILMAK ZORUNDA — getSession() değil.
   * getSession() çerezdeki jetonu doğrulamadan okur; sahte bir çerezle
   * kandırılabilir. getUser() jetonu Supabase'e doğrulatır ve aynı zamanda
   * süresi dolmuşsa yeniler.
   *
   * DAYANIKLILIK: Bu çağrı bir AĞ İSTEĞİDİR. Supabase erişilemezse hata
   * fırlatır ve middleware her isteği kapsadığı için TÜM SİTE 500 döner —
   * ürün sayfaları ve katalog dahil, oturumla hiç ilgisi olmayan her şey.
   *
   * Bu yüzden hata yutulur ve kullanıcı "oturumsuz" kabul edilir:
   * korumalı sayfalar giriş ekranına gider, herkese açık sayfalar
   * çalışmaya devam eder. Bir kesintide vitrinin ayakta kalması,
   * panelin erişilebilir olmasından daha önemlidir.
   */
  let user: { id: string } | null = null;

  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Oturum doğrulanamadı — site oturumsuz modda sunuluyor',
        path: pathname,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  const needsAuth = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (needsAuth && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/giris';
    // Girişten sonra kullanıcıyı gitmek istediği yere geri götür.
    redirectUrl.searchParams.set('devam', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && ADMIN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    // Rol okunamazsa yetki VERİLMEZ: belirsizlikte kapıyı kapalı tutmak,
    // yanlışlıkla açmaktan iyidir.
    let role: string | null = null;

    try {
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

      role = profile?.role ? String(profile.role) : null;
    } catch {
      role = null;
    }

    if (role !== 'admin') {
      // 403 sayfası yerine ana sayfaya yönlendiriyoruz: yönetim alanının
      // varlığını yetkisiz kişiye doğrulamanın bir faydası yok.
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/';
      return NextResponse.redirect(redirectUrl);
    }
  }

  if (user && GUEST_ONLY.some((prefix) => pathname.startsWith(prefix))) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/tasoron/panel';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  /*
   * Statik varlıklar ve görseller middleware'den geçmemeli: her istekte
   * Supabase'e jeton doğrulatmak gereksiz gecikme ve kota tüketimidir.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
};
