/**
 * PATCH /api/v1/orders/{id} — alt siparişin durumu ve kargo bilgisi.
 *
 * GERİYE DÖNÜK GEÇİŞ YOK. "Kargolandı"dan "hazırlanıyor"a dönmek, alıcıya
 * gönderilmiş bir bildirimi geri almak demektir. Yanlışlık olduğunda doğru
 * yol iptal etmek ya da yeni kayıt açmaktır, geçmişi değiştirmek değil.
 *
 * İzinli geçiş tablosu `@ohaaaa/shared` içinde: aynı kural Express API'sinde
 * de uygulanır. İki kopya olsaydı biri diğerinin yasakladığı geçişe izin
 * verir ve hangisinin doğru olduğu belirsizleşirdi.
 */

import {
  allowedVendorOrderTransitions,
  canTransitionVendorOrder,
  vendorOrderPatchSchema,
} from '@ohaaaa/shared';

import { ApiError, authenticate, errorResponse, logRequest } from '@/lib/api/vendorAuth';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const startedAt = performance.now();

  try {
    const { vendor, supabase, rateHeaders } = await authenticate(request, 'orders:write');
    const { id: vendorOrderId } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('validation_failed', 'Gövde geçerli JSON değil.');
    }

    const parsed = vendorOrderPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('validation_failed', 'Gövde doğrulanamadı.', parsed.error.issues);
    }

    const patch = parsed.data;

    // Mevcut durum ÖNCE okunur: geçişin geçerliliği ancak nereden gelindiği
    // bilinerek söylenebilir.
    const { data: current, error: readError } = await supabase
      .from('vendor_orders')
      .select('id, status')
      .eq('id', vendorOrderId)
      .eq('vendor_id', vendor.vendorId)
      .maybeSingle();

    if (readError) throw new Error(`Sipariş okunamadı: ${readError.message}`);
    if (!current) throw new ApiError('not_found', `Sipariş bulunamadı: ${vendorOrderId}`);

    const updates: Record<string, unknown> = {};
    if (patch.carrier !== undefined) updates.carrier = patch.carrier;
    if (patch.tracking_number !== undefined) updates.tracking_number = patch.tracking_number;

    if (patch.status) {
      const from = String(current.status);

      if (!canTransitionVendorOrder(from, patch.status)) {
        throw new ApiError(
          'validation_failed',
          `'${from}' durumundan '${patch.status}' durumuna geçilemez.`,
          // Hangi geçişlerin mümkün olduğu da söylenir: taşeron entegrasyonu
          // hatayı görüp ne yapacağını bilebilsin.
          { current_status: from, allowed_transitions: allowedVendorOrderTransitions(from) },
        );
      }

      updates.status = patch.status;

      // Zaman damgaları SUNUCUDA konur: istemciden gelen bir tarihe güvenmek,
      // kargo süresi ölçümlerini taşeronun keyfine bırakmak olurdu.
      if (patch.status === 'shipped') updates.shipped_at = new Date().toISOString();
      if (patch.status === 'delivered') updates.delivered_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('vendor_orders')
      .update(updates)
      .eq('id', vendorOrderId)
      .eq('vendor_id', vendor.vendorId)
      .select('id, status, carrier, tracking_number, shipped_at, delivered_at')
      .maybeSingle();

    if (error) {
      /*
       * Kargo takip denetimi veritabaninda calisiyor (tetikleyici) ve is
       * kurali ihlallerini OHAAAA_ onekiyle firlatiyor. Bunlar sunucu
       * hatasi DEGIL, istegin duzeltilebilir hatasidir: 500 dondurmek
       * saticiya "bizde bir sorun var, bekle" der ve entegrasyon yeniden
       * dener; oysa yapmasi gereken numarayi duzeltmek.
       */
      if (error.message.includes('OHAAAA_TRACKING_REQUIRED')) {
        throw new ApiError(
          'validation_failed',
          'Siparişi kargolandı olarak işaretlemek için carrier ve tracking_number zorunludur.',
        );
      }
      if (error.message.includes('OHAAAA_TRACKING_INVALID')) {
        throw new ApiError(
          'validation_failed',
          'Takip numarası, seçtiğiniz kargo firmasının biçimine uymuyor. ' +
            'Geçerli firma kodları /api/v1/carriers ile listelenir.',
        );
      }
      throw new Error(`Sipariş güncellenemedi: ${error.message}`);
    }
    if (!data) throw new ApiError('not_found', `Sipariş bulunamadı: ${vendorOrderId}`);

    const response = Response.json({ data }, { headers: rateHeaders });

    await logRequest({
      supabase,
      apiKeyId: vendor.apiKeyId,
      vendorId: vendor.vendorId,
      request,
      path: '/api/v1/orders/{id}',
      statusCode: 200,
      startedAt,
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
