/**
 * GET /api/v1/orders — taşeronun kendisine düşen alt siparişleri.
 *
 * Taşeron, müşterinin TÜM siparişini değil yalnızca kendi payına düşen
 * `vendor_order` kaydını ve o kayda bağlı kalemleri görür. Bu, split-cart
 * modelinin gizlilik tarafıdır: rakip taşeronun aynı sepette ne sattığı
 * görünmez.
 *
 * Sorgu doğrulanmış `vendor.vendorId` ile kapsanır — service_role istemcisi
 * RLS'i bypass ettiği için yetkilendirme bu satırın sorumluluğundadır.
 */

import { orderListQuerySchema } from '@ohaaaa/shared';

import { ApiError, authenticate, errorResponse, logRequest } from '@/lib/api/vendorAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const startedAt = performance.now();

  try {
    const { vendor, supabase, rateHeaders } = await authenticate(request, 'orders:read');

    const url = new URL(request.url);
    const parsed = orderListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw new ApiError('validation_failed', 'Sorgu parametreleri geçersiz.', parsed.error.issues);
    }

    const { limit, offset, status, since } = parsed.data;

    let query = supabase
      .from('vendor_orders')
      .select(
        `id, order_id, status, items_subtotal_cents, shipping_cents,
         commission_cents, payout_cents, commission_rate, carrier,
         tracking_number, created_at,
         order:orders ( order_number, status, shipping_address, created_at ),
         items:order_items ( id, title_snapshot, sku_snapshot, unit_price_cents,
                             quantity, line_total_cents, product_id )`,
        { count: 'exact' },
      )
      .eq('vendor_id', vendor.vendorId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (since) query = query.gte('created_at', since);

    const { data, error, count } = await query;
    if (error) throw new Error(`Siparişler okunamadı: ${error.message}`);

    const response = Response.json(
      { data: data ?? [], meta: { total: count ?? 0, limit, offset } },
      { headers: rateHeaders },
    );

    await logRequest({
      supabase,
      apiKeyId: vendor.apiKeyId,
      vendorId: vendor.vendorId,
      request,
      path: '/api/v1/orders',
      statusCode: 200,
      startedAt,
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
