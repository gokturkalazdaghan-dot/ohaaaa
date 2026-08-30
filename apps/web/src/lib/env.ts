/**
 * İstemci ve sunucu tarafı ortam okuma.
 *
 * TASARIM KARARI: Supabase yapılandırılmamışsa uygulama ÇÖKMEZ; yerleşik
 * demo veri kümesine düşer. Böylece depoyu klonlayan biri tek komutla
 * (`npm run dev`) dolu bir pazar yeri görür — kurulum, keşiften sonra gelir.
 * Yapılandırma durumu arayüzde açıkça gösterilir ki demo veri, canlı veri
 * sanılmasın.
 */

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function isSupabaseConfigured(): boolean {
  return (
    supabaseUrl.startsWith('https://') &&
    supabaseAnonKey.length > 20 &&
    !supabaseUrl.includes('xxxxxxxxxxxx')
  );
}

/**
 * Sitenin kanonik adresi.
 *
 * NEDEN SESSİZ VARSAYILAN YOK?
 * Bu değer sitemap.xml, robots.txt, canonical etiketleri ve tüm JSON-LD
 * kimliklerine gömülür. Üretimde yanlışlıkla "localhost" kalırsa site
 * çalışmaya devam eder ama Google hiçbir sayfayı indeksleyemez — ve bu,
 * haftalarca fark edilmeyen bir hatadır.
 *
 * Bu yüzden üretim derlemesinde eksik veya yerel bir adres HATA verir.
 * Derleme kırılır; sessiz bir SEO felaketi yerine 10 saniyelik bir
 * yapılandırma düzeltmesi olur.
 *
 * Not: Kontrol yalnızca sunucuda/derleme sırasında çalışır. İstemci
 * paketinde fırlatmak, doğru yapılandırılmış bir sitede bile riskli olurdu;
 * zaten değer eksikse derleme çoktan kırılmış olur.
 */
function resolveSiteUrl(): string {
  /*
   * Öncelik sırası:
   *   1. NEXT_PUBLIC_SITE_URL   — açıkça ayarlanmış, tercih edilen
   *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel'in üretim alan adı
   *
   * 2. seçenek ilk dağıtımın ÇALIŞMASI içindir: ortam değişkenini
   * ayarlamadan deploy eden biri, derleme hatası yerine doğru adresle
   * yayınlanmış bir site alır. Bu değişken yalnızca sunucuda vardır ve
   * siteUrl yalnızca sunucuda kullanılır (metadata, sitemap, robots, JSON-LD).
   *
   * Yine de 1. seçeneği açıkça ayarlamak önerilir: alan adını Vercel'e
   * bağlamadan önceki dağıtımlarda 2. seçenek geçici bir adres verir.
   */
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();

  const configured =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (vercelProductionUrl ? `https://${vercelProductionUrl}` : undefined) ||
    (process.env.NODE_ENV === 'production' ? 'https://ohaaaa.com' : undefined);

  // Sondaki eğik çizgi, `${siteUrl}/urun/x` birleştirmelerinde çift eğik
  // çizgi üretir ve iki farklı URL gibi indekslenir.
  const normalized = configured?.replace(/\/+$/, '') ?? '';

  const isProduction = process.env.NODE_ENV === 'production';
  const isServer = typeof window === 'undefined';
  const looksLocal =
    normalized === '' ||
    normalized.includes('localhost') ||
    normalized.includes('127.0.0.1');

  if (isProduction && isServer && looksLocal) {
    throw new Error(
      [
        'Sitenin kanonik adresi belirlenemedi.',
        '',
        `  Bulunan değer : ${configured ?? '(tanımsız)'}`,
        '  Olması gereken: https://ohaaaa.com',
        '',
        'Vercel dışında dağıtıyorsanız NEXT_PUBLIC_SITE_URL ayarlayın.',
        'Vercel kullanıyorsanız alan adını projeye bağlayın; o zaman',
        'VERCEL_PROJECT_PRODUCTION_URL kendiliğinden dolar.',
        '',
        'Bu değer sitemap.xml, robots.txt, canonical etiketleri ve yapılandırılmış',
        'veriye gömülür. Yanlış kalırsa site çalışır ama arama motorları hiçbir',
        'sayfayı indeksleyemez.',
        '',
        'Next.js NEXT_PUBLIC_* değişkenlerini DERLEME ZAMANINDA gömer:',
        'değişkeni ayarlayıp yeniden derleyin (çalışma anında ayarlamak yetmez).',
      ].join('\n'),
    );
  }

  return normalized || 'http://localhost:3000';
}

export const siteUrl = resolveSiteUrl();

/** Taşeron API'sinin adresi (panelde örnek kod bloklarında gösterilir). */
export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '') ??
  'http://localhost:4000';

// --- SEO ve ölçümleme ------------------------------------------------------
/** Google Analytics ölçüm kimliği (G-XXXXXXX). Boşsa betik hiç yüklenmez. */
export const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '';

/**
 * Google Search Console doğrulama kodu (madde 19).
 * DNS veya HTML dosyası yöntemi de kullanılabilir; meta etiketi en hızlısıdır.
 */
export const searchConsoleVerification =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ?? '';

// --- Yayın durumu ----------------------------------------------------------
/**
 * Sitenin yayın aşaması.
 *
 *   prelaunch : Site erişilebilir ama arama motorlarına KAPALI.
 *   live      : Tam yayın.
 *
 * NEDEN VAR?
 * Yasal metinler henüz kurulmamış bir işletmeyi adres gösteriyorsa ve
 * Google bu hâliyle indekslerse, sonradan düzeltilse bile o sürüm önbellekte
 * ve arşivlerde kalır. Ayrıca 6563 sayılı Kanun, e-ticaret hizmet
 * sağlayıcısının kimlik bilgilerini yayımlamasını zorunlu kılar — kayıtlı
 * bir işletme yokken bu bilgi verilemez.
 *
 * VARSAYILAN 'prelaunch'tır — bilinçli olarak GÜVENLİ tarafta hata yapar.
 * Değişkeni ayarlamayı unutursanız site indekslenmez; bunu her sayfadaki
 * şeritten hemen görürsünüz. Tersi (unutunca canlıya çıkmak) sessizce
 * gerçekleşir ve geri alınamaz.
 */
export type LaunchState = 'prelaunch' | 'live';

export const launchState: LaunchState =
  process.env.NEXT_PUBLIC_LAUNCH_STATE === 'live' ? 'live' : 'prelaunch';

export const isPrelaunch = launchState === 'prelaunch';
