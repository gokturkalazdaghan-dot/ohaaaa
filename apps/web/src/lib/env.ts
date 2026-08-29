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

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
