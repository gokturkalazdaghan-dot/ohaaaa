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

  /*
   * GERÇEK VERİTABANINDA SAHTE ÖDEME ÇALIŞTIRILMAZ.
   *
   * Aşağıdaki akış `confirm_payment` çağırıp siparişi "ödendi" olarak
   * işaretliyor, ama tahsilat bir SİMÜLASYON: para hareketi yok. Katalog
   * boşken bunun bir bedeli yoktu. İlk gerçek satıcı ilk ürününü
   * yayınladığı anda ise şu olurdu: alıcı sipariş verir, sipariş "ödendi"
   * görünür, satıcıya "hazırla ve gönder" der — ve satıcı malı bedelsiz
   * göndermiş olur. Zararı platform değil, sözleşmeye göre iadeden de
   * sorumlu olan satıcı çeker.
   *
   * Bu yüzden gerçek Supabase projesine bağlı çalışırken ödeme sağlayıcısı
   * tanımlı değilse istek REDDEDİLİR. Kapıyı açık tutup "sonra hallederiz"
   * demek, hatanın parayla ölçülecek tek anını seçmek olurdu.
   *
   * Demo modu (Supabase yok) etkilenmez: orada zaten hiçbir şey kalıcı
   * değil ve gösterilen ürünler gerçek değil.
   *
   * Sağlayıcı bağlandığında `OHAAAA_PAYMENT_PROVIDER` ayarlanır ve bu blok
   * kendiliğinden devre dışı kalır. Sağlayıcısız bir ortamda uçtan uca
   * deneme yapmak gerekiyorsa `OHAAAA_ALLOW_SIMULATED_PAYMENT=1` açıkça
   * yazılır — kazayla değil, bilerek.
   */
  const paymentProvider = process.env.OHAAAA_PAYMENT_PROVIDER?.trim();
  const simulationAllowed = process.env.OHAAAA_ALLOW_SIMULATED_PAYMENT === '1';

  if (supabase && !paymentProvider && !simulationAllowed) {
    return NextResponse.json(
      {
        error: {
          code: 'payment_unavailable',
          message:
            'Ödeme altyapısı henüz bağlı değil, bu yüzden sipariş alamıyoruz. ' +
            'Sepetiniz duruyor; ödeme açıldığında buradan tamamlayabilirsiniz.',
        },
      },
      { status: 503 },
    );
  }

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

  /*
   * Ödeme sağlayıcısı entegrasyonu buraya girer (iyzico, PayTR, Stripe…).
   * Simülasyonda ödeme daima başarılıdır.
   *
   * BU ÇAĞRI SUNUCU ANAHTARIYLA YAPILIR, ziyaretçinin oturumuyla değil.
   *
   * `confirm_payment` bir sipariş kimliği alıp onu "ödendi" olarak
   * işaretler ve içinde SAHİPLİK KONTROLÜ YOKTUR. İstemciye açık kaldığı
   * sürece, bir sipariş kimliğini ele geçiren herkes o siparişi ödeme
   * yapmadan ödenmiş gösterebilir. Bugün ödeme bir simülasyon olduğu için
   * para kaybı yok; ama sipariş durumu tedarik akışını tetikler ve gerçek
   * tahsilat eklendiğinde bu doğrudan dolandırıcılık yoluna dönüşür.
   *
   * Sipariş OLUŞTURMA (`create_order`) ziyaretçinin oturumuyla kalmalı:
   * misafir alışverişi destekleniyor ve siparişin kime bağlanacağı oturumdan
   * geliyor. Ödemeyi onaylamak ise kimlik gerektirmez, yalnızca YETKİ
   * gerektirir — o yüzden sunucuya taşındı ve istemciden tamamen kaldırıldı.
   */
  const { getServiceClient } = await import('@/lib/supabase/service');
  const { error: paymentError } = await getServiceClient().rpc('confirm_payment', {
    p_order_id: created.id,
    p_provider: paymentProvider ?? 'simulated',
    p_reference: `${paymentProvider ? paymentProvider.toUpperCase() : 'SIM'}-${Date.now()}`,
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

  const vendorRows = (vendorOrders ?? []).map((row: Record<string, unknown>) => {
    const rawVendor = row.vendor;
    const vendor = (Array.isArray(rawVendor) ? rawVendor[0] : rawVendor) as
      | Record<string, unknown>
      | null;
    return {
      name: vendor?.display_name ? String(vendor.display_name) : 'Mağaza',
      subtotal: Number(row.items_subtotal_cents),
      shipping: Number(row.shipping_cents),
    };
  });

  /*
   * Sipariş onayı e-postası.
   *
   * `await` ediliyor ama sonucu AKIŞI DÜŞÜRMÜYOR: sipariş oluştu ve ödendi;
   * bildirim gitmediyse sipariş yine geçerlidir. Alıcıya "sipariş başarısız"
   * demek, olmuş bir şeyi olmamış göstermek olurdu.
   *
   * Beklemeden (fire-and-forget) göndermek de doğru değil: sunucusuz bir
   * ortamda yanıt döndükten sonra süreç sonlandırılabilir ve istek hiç
   * gitmeyebilir. Sekiz saniyelik zaman aşımı bu yüzden gönderim katmanında.
   */
  const { orderConfirmationMail, sendMail } = await import('@/lib/mail');
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.ohaaaa.com').replace(/\/+$/, '');
  const toplam = vendorRows.reduce((sum, v) => sum + v.subtotal + v.shipping, 0);

  await sendMail({
    to: input.email,
    ...orderConfirmationMail({
      orderNumber: created.order_number,
      totalText: `${(toplam / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`,
      vendorNames: vendorRows.map((v) => v.name),
      siteUrl,
    }),
  });

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
