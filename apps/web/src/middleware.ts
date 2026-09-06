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

/*
 * DERIN ICE AKTARIM (deep import) — BARREL DEGIL.
 *
 * Onceki hal `from '@ohaaaa/shared'` idi. O barrel (`src/index.ts`) paketin
 * TAMAMINI yeniden disa aktariyor; icinde `dataengine/delta.ts` de var ve o
 * dosya `node:crypto` cagiriyor. Middleware Edge runtime'da calistigi icin
 * derleme her seferinde su uyariyi veriyordu:
 *
 *   A Node.js module is loaded ('node:crypto') which is not supported in
 *   the Edge Runtime.
 *
 * `createHash` middleware yolunda HIC cagrilmiyor -- yani calisan bir hata
 * degildi. Ama uyariyi bastirmak ya da gormezden gelmek, gercekten Edge'de
 * calisamayacak bir sey eklendiginde onu da sessizlestirirdi.
 *
 * `safeInternalPath` `src/types.ts` icinde ve o dosyanin tek ice aktarimi
 * `import type` -- yani derlemede tamamen siliniyor. Derin ice aktarim
 * boylece calisma zamaninda HICBIR bagimlilik getirmiyor. Runtime,
 * davranis ve guvenlik degismedi; yalnizca paket sinirlari daraldi.
 */
import { safeInternalPath } from '@ohaaaa/shared/types';

import { isAffiliateOnly } from '@/lib/env';

/**
 * İçerik Güvenlik Politikası (CSP).
 *
 * XSS'e karşı SON savunma hattı. React zaten kaçırma yapar, ama bir açık
 * bulunursa CSP saldırganın script çalıştırmasını engeller.
 *
 * NONCE KULLANIYORUZ, 'unsafe-inline' DEĞİL.
 * 'unsafe-inline' yazmak CSP'yi script açısından işlevsiz kılar — saldırgan
 * enjekte ettiği script'i de çalıştırır. Her istekte üretilen rastgele bir
 * nonce, yalnızca BİZİM koyduğumuz script'lerin çalışmasına izin verir.
 * Next.js, istekte CSP başlığını görürse kendi script'lerine bu nonce'u
 * kendiliğinden ekler.
 *
 * style-src'de 'unsafe-inline' KALIYOR: Next/font ve Tailwind çalışma anında
 * satır içi stil üretir. Stil enjeksiyonu script enjeksiyonu kadar tehlikeli
 * değildir (kod çalıştırmaz); yine de ideal değil, biliniyor.
 */
function buildCsp(nonce: string, supabaseUrl: string): string {
  const directives = [
    "default-src 'self'",
    // strict-dynamic: nonce'lu script'in yüklediği script'ler de güvenilir
    // sayılır. Next'in parça yükleyicisi böyle çalışır.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    // Ürün görselleri satıcıların kendi CDN'lerinden gelir; hangi alan adı
    // olacağı önceden bilinmez.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${supabaseUrl ? ` ${supabaseUrl} ${supabaseUrl.replace('https://', 'wss://')}` : ''}`,
    // Siteyi iframe'e alarak tıklama hırsızlığı (clickjacking) yapılmasını
    // engeller. X-Frame-Options'ın modern karşılığı.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    // <base> etiketi enjekte edilip tüm göreli adresler saldırgana
    // yönlendirilemesin.
    "base-uri 'self'",
    // Form verisi yalnızca kendi sunucumuza gidebilir.
    "form-action 'self'",
    'upgrade-insecure-requests',
  ];
  return directives.join('; ');
}

/** Her istek için rastgele nonce. */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** CSP ve nonce'u isteğe/yanıta işler. */
function applyCsp(request: NextRequest, response: NextResponse, nonce: string): void {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  response.headers.set('content-security-policy', buildCsp(nonce, supabaseUrl));
}

/*
 * Oturum gerektiren yollar. Alt yolları da kapsar.
 *
 * `/hesap` yazıyordu ama öyle bir sayfa hiç yoktu -- sarkan bir koruma.
 * Buna karşılık gerçekten kişiye özel olan iki sayfa korumasızdı:
 * `/siparislerim` ve `/degerlendirmelerim`. Oturum açmamış biri
 * `/degerlendirmelerim` adresine gittiğinde sorgu RLS altında boş dönüyor
 * ve ekran "değerlendirilecek sipariş yok" diyordu. Yanlış teşhis: sorun
 * siparişin olmaması değil, oturumun olmamasıydı.
 */
const PROTECTED_PREFIXES = [
  '/tasoron/panel',
  '/yonetim',
  '/siparislerim',
  '/degerlendirmelerim',
  '/adreslerim',
];

/*
 * PROTECTED_PREFIXES icindeki PAZAR YERI yollari.
 *
 * ÖLÇÜLDÜ (üretim, www.ohaaaa.com):
 *   /odeme         -> 404   (dogru)
 *   /siparislerim  -> 200, x-matched-path: /giris   (YANLIS)
 *
 * Sebep sira: bu middleware kimlik kontrolunu sayfanin ICINDEKI
 * `requireMarketplaceMode()` kapisindan ONCE yapiyordu. Oturumu olmayan
 * ziyaretci giris sayfasina yonlendiriliyor ve boylece yuzeyin VAR OLDUGUNU
 * ogreniyordu -- `commerceGuard.ts`'in acikca reddettigi davranis:
 *
 *   "403 'burada bir sey var ama giremezsin' der ve pazar yeri yuzeyinin
 *    VARLIGINI dogrular. Ortaklik kipinde o yuzey kavramsal olarak YOK;
 *    dogru cevap 'boyle bir sayfa yok'."
 *
 * Bir erisim asimi DEGILDI (giris yapan da 404 goruyordu); ortaklik agi
 * denetcisine ve arama motoruna pazar yeri yuzeyini dogrulayan bir BILGI
 * SIZINTISIYDI.
 *
 * COZUM YENI BIR 404 MEKANIZMASI DEGIL: ortaklik kipinde bu yollarda oturum
 * yonlendirmesi ATLANIR ve istek sayfaya ulasir; sayfadaki mevcut kapi zaten
 * dogru 404'u uretir. Tek kapi, tek davranis.
 *
 * `/yonetim` BILEREK DISARIDA: yonetim paneli bir pazar yeri yuzeyi degil,
 * her iki kipte de calisan operator araci. Oraya oturumsuz erisim serbest
 * birakilamaz.
 */
const MARKETPLACE_PREFIXES = [
  '/tasoron/panel',
  '/siparislerim',
  '/degerlendirmelerim',
  '/adreslerim',
];

/** Yalnızca admin rolünün girebileceği yollar. */
const ADMIN_PREFIXES = ['/yonetim'];

/** Oturum açıkken anlamsız olan yollar. */
const GUEST_ONLY = ['/giris', '/kayit'];

/** Nonce'u istek başlığına koyar; Next kendi script'lerine bunu uygular. */
function withNonce(request: NextRequest, nonce: string): Headers {
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  return headers;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * Taşeron API'si (/api/v1/*) bu katmanı ATLAR.
   *
   * O uç noktalar çerezle değil `x-api-key` ile kimlik doğrular. Buradan
   * geçirmek her istekte Supabase'e fazladan bir jeton doğrulama turu
   * eklerdi — 500 ürünlük bir beslemede bu, saf gecikme ve boşa kota.
   * CSP başlığı da JSON yanıtı için anlamsız.
   *
   * Atlamak güvenliği zayıflatmaz: bu yollarda oturum çerezi hiç
   * okunmaz, yetkilendirmenin tamamı route handler'ın içindedir.
   */
  if (pathname.startsWith('/api/v1/')) {
    return NextResponse.next();
  }

  const nonce = makeNonce();

  // Supabase yapılandırılmamışsa (demo modu) auth akışı yoktur; panel
  // örnek verilerle gezilebilir kalmalı.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key || url.includes('xxxxxxxxxxxx')) {
    const passthrough = NextResponse.next({
      request: { headers: withNonce(request, nonce) },
    });
    applyCsp(request, passthrough, nonce);
    return passthrough;
  }

  // Yanıt nesnesi ÖNCE oluşturulur: Supabase yenilenmiş çerezleri buraya yazar.
  let response = NextResponse.next({ request: { headers: withNonce(request, nonce) } });

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

        response = NextResponse.next({ request: { headers: withNonce(request, nonce) } });

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

  /*
   * Ortaklik kipinde pazar yeri yollari oturum kapisina HIC gelmez: istek
   * sayfaya birakilir ve `requireMarketplaceMode()` 404 uretir. Gerekcesi
   * MARKETPLACE_PREFIXES tanimindaki notta.
   */
  const isHiddenMarketplacePath =
    isAffiliateOnly && MARKETPLACE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  const needsAuth =
    !isHiddenMarketplacePath &&
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

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

    /*
     * İki hata birden vardı.
     *
     * Birincisi: hedef koşulsuz `/tasoron/panel` idi. Varsayılan rol
     * `customer`; yani sıradan bir alıcı, giriş sayfasına uğradığında
     * satıcı paneline atılıyordu.
     *
     * İkincisi: `search` silindiği için `devam` parametresi de siliniyordu.
     * Yukarıda (bkz. korumalı yol yönlendirmesi) kullanıcının gitmek
     * istediği adres tam da bu parametreye yazılıyor -- burada silinince
     * "girişten sonra kaldığın yere dön" hiç çalışmıyordu.
     *
     * Hedef yalnızca UYGULAMA İÇİ bir yol olabilir: `devam` adres
     * çubuğundan gelir ve "https://baska-site" yazan biri, kullanıcıyı bizim
     * giriş akışımızın sonunda oraya göndertebilirdi (açık yönlendirme).
     * Denetim `@ohaaaa/shared` içinde ve testli -- burada satır içi bir
     * düzenli ifade olsaydı, ne doğruladığı ancak gözle okunarak
     * anlaşılabilirdi.
     */
    const safeNext = safeInternalPath(request.nextUrl.searchParams.get('devam'));

    redirectUrl.pathname = safeNext ?? '/';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  applyCsp(request, response, nonce);
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
