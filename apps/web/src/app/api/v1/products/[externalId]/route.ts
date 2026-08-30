/**
 * /api/v1/products/{external_id} — tek ürün üzerinde işlemler.
 *
 * `external_id` taşeronun KENDİ kimliğidir; sorgular daima `vendor_id` ile
 * kapsandığı için iki taşeron aynı external_id'yi kullanabilir ve birbirinin
 * kaydına erişemez.
 */

import { productPatchSchema } from '@ohaaaa/shared';

import { ApiError, authenticate, errorResponse, logRequest } from '@/lib/api/vendorAuth';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ externalId: string }> };

/** PATCH — tek ürün kısmi güncelleme (fiyat/stok değişimi için tipik yol). */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const startedAt = performance.now();

  try {
    const { vendor, supabase, rateHeaders } = await authenticate(request, 'products:write');
    const { externalId } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('validation_failed', 'Gövde geçerli JSON değil.');
    }

    const parsed = productPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('validation_failed', 'Gövde doğrulanamadı.', parsed.error.issues);
    }

    const { data, error } = await supabase
      .from('products')
      .update(parsed.data)
      .eq('vendor_id', vendor.vendorId)
      .eq('external_id', externalId)
      .select('id, external_id, title, price_cents, stock, status')
      .maybeSingle();

    if (error) throw new Error(`Ürün güncellenemedi: ${error.message}`);
    if (!data) throw new ApiError('not_found', `Ürün bulunamadı: ${externalId}`);

    const response = Response.json({ data }, { headers: rateHeaders });

    await logRequest({
      supabase,
      apiKeyId: vendor.apiKeyId,
      vendorId: vendor.vendorId,
      request,
      path: '/api/v1/products/{external_id}',
      statusCode: 200,
      startedAt,
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE — ürün fiziksel olarak SİLİNMEZ, arşivlenir.
 *
 * Geçmiş siparişlerin kalem anlık görüntüleri korunur ve taşeron yanlışlıkla
 * sildiğinde geri alınabilir. Fiyat geçmişi de kopmaz.
 */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const startedAt = performance.now();

  try {
    const { vendor, supabase, rateHeaders } = await authenticate(request, 'products:write');
    const { externalId } = await context.params;

    const { data, error } = await supabase
      .from('products')
      .update({ status: 'archived' })
      .eq('vendor_id', vendor.vendorId)
      .eq('external_id', externalId)
      .select('id, external_id, status')
      .maybeSingle();

    if (error) throw new Error(`Ürün arşivlenemedi: ${error.message}`);
    if (!data) throw new ApiError('not_found', `Ürün bulunamadı: ${externalId}`);

    const response = Response.json({ data }, { headers: rateHeaders });

    await logRequest({
      supabase,
      apiKeyId: vendor.apiKeyId,
      vendorId: vendor.vendorId,
      request,
      path: '/api/v1/products/{external_id}',
      statusCode: 200,
      startedAt,
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
