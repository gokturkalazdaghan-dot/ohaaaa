/**
 * GET /api/oneriler?q=... — yazarken tamamlama.
 *
 * Arama kutusu her tuş vuruşunda buraya sorabilir; bu yüzden uç nokta ucuz
 * ve kısa süreli önbelleklenebilir olmalı.
 */

import { getSearchSuggestions } from '@/data/catalog';

/**
 * 60 saniyelik kenar önbelleği.
 *
 * Aynı önekler (ör. "kula", "iph") çok sayıda ziyaretçi tarafından yazılır;
 * her biri için veritabanına gitmek gereksiz. 60 saniye, yeni bir ürünün
 * önerilerde görünmesi için kabul edilebilir bir gecikme.
 */
const CACHE_HEADER = 'public, s-maxage=60, stale-while-revalidate=300';

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get('q') ?? '';

  // Sorgu uzunluğu sınırlanır: uzun bir metin öneri değil, arama sorgusudur
  // ve trigram taramasını gereksiz pahalı hale getirir.
  if (query.length > 80) {
    return Response.json({ data: [] }, { headers: { 'cache-control': CACHE_HEADER } });
  }

  try {
    const data = await getSearchSuggestions(query);
    return Response.json({ data }, { headers: { 'cache-control': CACHE_HEADER } });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Öneri uç noktası başarısız',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    // Öneriler ikincildir: hata yerine boş liste döner, kutu çalışmaya devam eder.
    return Response.json({ data: [] });
  }
}
