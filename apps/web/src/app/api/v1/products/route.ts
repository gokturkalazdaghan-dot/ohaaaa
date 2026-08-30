/**
 * /api/v1/products — taşeron ürün besleme uç noktaları.
 *
 * Tüm sorgular doğrulanmış `vendor.vendorId` ile kapsanır. İstemciden gelen
 * hiçbir vendor_id değerine güvenilmez: service_role istemcisi RLS'i bypass
 * ettiği için yetkilendirme bu satırların sorumluluğundadır.
 */

import { syncProducts } from '@ohaaaa/shared/product-sync';
import { productFeedRequestSchema, productListQuerySchema } from '@ohaaaa/shared';

import { ApiError, authenticate, errorResponse, logRequest } from '@/lib/api/vendorAuth';

export const dynamic = 'force-dynamic';

/**
 * Gövde boyutu sınırı.
 *
 * 500 ürünlük bir besleme yaklaşık 1 MB tutar. 4 MB, en büyük meşru
 * beslemenin bile rahatça altında kaldığı, ama bir saldırganın belleği
 * doldurmasına izin vermeyen bir tavan.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Gövdeyi boyut sınırıyla okur ve JSON'a çevirir. */
async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    throw new ApiError('payload_too_large', 'İstek gövdesi 4 MB sınırını aşıyor.');
  }

  const text = await request.text();

  // content-length uydurulmuş ya da eksik olabilir; asıl kontrol burada.
  if (text.length > MAX_BODY_BYTES) {
    throw new ApiError('payload_too_large', 'İstek gövdesi 4 MB sınırını aşıyor.');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError('validation_failed', 'Gövde geçerli JSON değil.');
  }
}

/**
 * POST /api/v1/products
 * Toplu ürün beslemesi (upsert). İdempotenttir: aynı `external_id` ile
 * tekrar gönderim mükerrer kayıt oluşturmaz, mevcut kaydı günceller.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();

  try {
    const { vendor, supabase, rateHeaders } = await authenticate(request, 'products:write');

    const parsed = productFeedRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new ApiError('validation_failed', 'Gövde doğrulanamadı.', parsed.error.issues);
    }

    const result = await syncProducts(
      supabase,
      vendor.vendorId,
      parsed.data.products,
      parsed.data.archive_missing,
    );

    // 207 değil 200: kısmi hatalar gövdede raporlanır, HTTP semantiği basit
    // tutulur — taşeron entegrasyonlarının çoğu yalnızca 2xx/4xx ayrımı yapar.
    const response = Response.json(
      {
        data: {
          received: result.received,
          created: result.created,
          updated: result.updated,
          archived: result.archived,
          failed: result.failed,
        },
      },
      { headers: rateHeaders },
    );

    await logRequest({
      supabase,
      apiKeyId: vendor.apiKeyId,
      vendorId: vendor.vendorId,
      request,
      path: '/api/v1/products',
      statusCode: 200,
      startedAt,
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET /api/v1/products — taşeronun kendi kataloğu. */
export async function GET(request: Request): Promise<Response> {
  const startedAt = performance.now();

  try {
    const { vendor, supabase, rateHeaders } = await authenticate(request, 'products:read');

    const url = new URL(request.url);
    const parsed = productListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw new ApiError('validation_failed', 'Sorgu parametreleri geçersiz.', parsed.error.issues);
    }

    const { limit, offset, status, q } = parsed.data;

    let query = supabase
      .from('products')
      .select(
        `id, external_id, sku, title, brand, price_cents, compare_at_price_cents,
         currency, stock, status, condition, shipping_fee_cents,
         estimated_delivery_days, image_urls, group_id, updated_at`,
        { count: 'exact' },
      )
      .eq('vendor_id', vendor.vendorId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (q) query = query.ilike('title', `%${q}%`);

    const { data, error, count } = await query;
    if (error) throw new Error(`Ürünler okunamadı: ${error.message}`);

    const response = Response.json(
      { data: data ?? [], meta: { total: count ?? 0, limit, offset } },
      { headers: rateHeaders },
    );

    await logRequest({
      supabase,
      apiKeyId: vendor.apiKeyId,
      vendorId: vendor.vendorId,
      request,
      path: '/api/v1/products',
      statusCode: 200,
      startedAt,
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
