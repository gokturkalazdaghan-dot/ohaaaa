/**
 * POST /api/checkout — ödeme simülasyonu.
 *
 * GÜVENLİK: İstemcinin gönderdiği TUTARLAR HİÇ OKUNMAZ. Yalnızca
 * (product_id, quantity) çiftleri alınır; fiyat, kargo ve komisyon
 * veritabanındaki create_order() fonksiyonu tarafından yeniden hesaplanır.
 * Aksi halde tarayıcı konsolundan fiyat değiştirmek mümkün olurdu.
 *
 * Demo modunda (Supabase yok) gerçekçi bir sipariş özeti üretilir; para
 * hareketi hiçbir modda gerçekleşmez — bu bir simülasyondur.
 */

import { NextResponse } from 'next/server';

import { checkoutSchema, summarizeCart, type CartItem } from '@ohaaaa/shared';

import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Geçersiz JSON gövdesi.' } },
      { status: 400 },
    );
  }

  const parsed = checkoutSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Gönderilen bilgiler doğrulanamadı.',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 422 },
    );
  }

  const input = parsed.data;
  const supabase = await createClient();

  // ---- Demo modu -----------------------------------------------------------
  if (!supabase) {
    const { demoProductGroups } = await import('@/data/demo');

    const items: CartItem[] = [];

    for (const requested of input.items) {
      const group = demoProductGroups.find((candidate) =>
        candidate.offers.some((offer) => offer.id === requested.product_id),
      );
      const offer = group?.offers.find((candidate) => candidate.id === requested.product_id);

      if (!group || !offer) {
        return NextResponse.json(
          {
            error: {
              code: 'not_found',
              message: `Ürün bulunamadı: ${requested.product_id}`,
            },
          },
          { status: 404 },
        );
      }

      // Ortak mağaza teklifi sipariş edilemez — canlı modda create_order()
      // aynı kuralı uygular; demo modu ondan sapmamalıdır.
      if (offer.fulfillment === 'affiliate' || !offer.vendorId) {
        return NextResponse.json(
          {
            error: {
              code: 'validation_failed',
              message:
                `"${offer.title}" ortak mağazada satılıyor; ` +
                `sipariş yerine mağazaya yönlendirme yapılmalı.`,
            },
          },
          { status: 422 },
        );
      }

      items.push({
        productId: offer.id,
        groupSlug: group.slug,
        title: offer.title,
        imageUrl: null,
        // Fiyat istemciden DEĞİL, sunucudaki kaynaktan okunur.
        priceCents: offer.priceCents,
        quantity: Math.min(requested.quantity, offer.stock),
        vendorId: offer.vendorId,
        vendorName: offer.vendor?.displayName ?? 'Mağaza',
        vendorSlug: offer.vendor?.slug ?? '',
        shippingFeeCents: offer.shippingFeeCents,
        freeShippingThresholdCents: offer.freeShippingThresholdCents,
        estimatedDeliveryDays: offer.estimatedDeliveryDays,
        maxStock: offer.stock,
      });
    }

    const summary = summarizeCart(items);

    return NextResponse.json({
      data: {
        order_number: `OHA-DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        status: 'paid',
        demo: true,
        items_subtotal_cents: summary.itemsSubtotalCents,
        shipping_total_cents: summary.shippingTotalCents,
        grand_total_cents: summary.grandTotalCents,
        vendor_orders: summary.groups.map((group) => ({
          vendor_name: group.vendorName,
          items_subtotal_cents: group.itemsSubtotalCents,
          shipping_cents: group.shippingCents,
          total_cents: group.totalCents,
          estimated_delivery_days: group.estimatedDeliveryDays,
          item_count: group.items.reduce((sum, item) => sum + item.quantity, 0),
        })),
      },
    });
  }

  // ---- Canlı mod -----------------------------------------------------------
  const { data: order, error } = await supabase.rpc('create_order', {
    p_items: input.items,
    p_email: input.email,
    p_shipping_address: input.shipping_address,
    p_notes: input.notes ?? null,
  });

  if (error) {
    // create_order() iş kuralı ihlallerini OHAAAA_ önekiyle fırlatır;
    // bunlar kullanıcıya gösterilebilir, diğerleri gösterilemez.
    const isBusinessRule = error.message.includes('OHAAAA_');

    return NextResponse.json(
      {
        error: {
          code: isBusinessRule ? 'validation_failed' : 'internal_error',
          message: isBusinessRule
            ? error.message.replace(/^.*OHAAAA_[A-Z_]+:\s*/, '')
            : 'Sipariş oluşturulamadı. Lütfen tekrar deneyin.',
        },
      },
      { status: isBusinessRule ? 422 : 500 },
    );
  }

  const created = order as { id: string; order_number: string };

  // Ödeme sağlayıcısı entegrasyonu buraya girer (iyzico, PayTR, Stripe…).
  // Simülasyonda ödeme daima başarılıdır.
  const { error: paymentError } = await supabase.rpc('confirm_payment', {
    p_order_id: created.id,
    p_provider: 'simulated',
    p_reference: `SIM-${Date.now()}`,
  });

  if (paymentError) {
    return NextResponse.json(
      {
        error: {
          code: 'internal_error',
          message: 'Sipariş oluşturuldu ancak ödeme onaylanamadı.',
          order_number: created.order_number,
        },
      },
      { status: 500 },
    );
  }

  const { data: vendorOrders } = await supabase
    .from('vendor_orders')
    .select('items_subtotal_cents, shipping_cents, vendor:vendors ( display_name )')
    .eq('order_id', created.id);

  return NextResponse.json({
    data: {
      order_number: created.order_number,
      status: 'paid',
      demo: false,
      vendor_orders: (vendorOrders ?? []).map((row: Record<string, unknown>) => {
        const rawVendor = row.vendor;
        const vendor = (Array.isArray(rawVendor) ? rawVendor[0] : rawVendor) as
          | Record<string, unknown>
          | null;

        return {
          vendor_name: vendor?.display_name ? String(vendor.display_name) : 'Mağaza',
          items_subtotal_cents: Number(row.items_subtotal_cents),
          shipping_cents: Number(row.shipping_cents),
          total_cents: Number(row.items_subtotal_cents) + Number(row.shipping_cents),
        };
      }),
    },
  });
}
