/**
 * GET /api/urunler?slugler=a,b,c — birkaç ürünün GÜNCEL fiyatı.
 *
 * Favori listesi tarayıcıda tutulduğu için sunucu kimin neyi kaydettiğini
 * bilmez. Liste sayfası, elindeki adresleri buraya sorup güncel fiyatları
 * alır ve kaydedildiği andaki fiyatla karşılaştırır.
 */

import { getProductPrices } from '@/data/catalog';

/** Tek istekte sorulabilecek en fazla ürün. Favori listesi 100 ile sınırlı. */
const MAX_SLUGS = 100;

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('slugler') ?? '';

  const slugs = raw
    .split(',')
    .map((slug) => slug.trim())
    // Adres biçimi doğrulanır: URL'e herkes her şeyi yazabilir ve doğrulanmamış
    // bir değer sorguya gitmemeli.
    .filter((slug) => /^[a-z0-9-]{1,120}$/i.test(slug))
    .slice(0, MAX_SLUGS);

  if (slugs.length === 0) return Response.json({ data: [] });

  try {
    return Response.json(
      { data: await getProductPrices(slugs) },
      // Fiyatlar sık değişir; kısa önbellek yine de aynı listeyi iki kez
      // açan kullanıcıyı veritabanına iki kez göndermez.
      { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=120' } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Güncel fiyatlar okunamadı',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    // Boş liste: favori sayfası fiyatsız da olsa açılmalı.
    return Response.json({ data: [] });
  }
}
