/**
 * GET /api/v1/me — anahtarın kime ait olduğunu ve neye yetkili olduğunu söyler.
 *
 * Entegrasyonun ilk adımı budur: taşeron anahtarını buraya sorarak
 * bağlantısını doğrular. Bu yüzden `products:read` yetkisi yeter.
 */

import { authenticate, errorResponse, logRequest } from '@/lib/api/vendorAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const startedAt = performance.now();

  try {
    const { vendor, supabase, rateHeaders } = await authenticate(request, 'products:read');

    const response = Response.json(
      {
        data: {
          vendor_id: vendor.vendorId,
          vendor_slug: vendor.vendorSlug,
          vendor_name: vendor.vendorName,
          scopes: vendor.scopes,
          rate_limit_per_minute: vendor.rateLimitPerMinute,
        },
      },
      { headers: rateHeaders },
    );

    await logRequest({
      supabase,
      apiKeyId: vendor.apiKeyId,
      vendorId: vendor.vendorId,
      request,
      path: '/api/v1/me',
      statusCode: 200,
      startedAt,
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
