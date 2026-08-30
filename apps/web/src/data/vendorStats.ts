import 'server-only';

/**
 * Taşeron paneli veri erişimi.
 *
 * Katalogdaki yaklaşımın aynısı: tek arayüz, iki kaynak. Oturum ve onaylı bir
 * taşeron varsa gerçek veri; yoksa demo üreteci. Panel hangisinin geldiğini
 * bilmez ve arayüzde tek bir kod yolu kalır.
 */

import type { VendorDashboardStats } from '@ohaaaa/shared';

import { createClient } from '@/lib/supabase/server';
import { buildDemoStats, buildDemoOrders, type DemoVendorOrder } from '@/data/vendorDemo';

export async function getVendorStats(
  vendorId: string | null,
  days = 30,
): Promise<{ stats: VendorDashboardStats; isLive: boolean }> {
  const supabase = await createClient();

  if (!supabase || !vendorId) {
    return { stats: buildDemoStats(days), isLive: false };
  }

  const { data, error } = await supabase.rpc('vendor_dashboard_stats', {
    p_vendor_id: vendorId,
    p_days: days,
  });

  if (error || !data) {
    // Panelin boş açılması, örnek veriyle açılmasından daha kötüdür — ama
    // hatayı yutmuyoruz, sunucu günlüğüne düşüyor.
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Panel istatistikleri okunamadı',
        vendor_id: vendorId,
        error: error?.message,
      }),
    );
    return { stats: buildDemoStats(days), isLive: false };
  }

  const raw = data as Record<string, unknown>;

  return {
    isLive: true,
    stats: {
      vendorId,
      windowDays: Number(raw.window_days ?? days),
      revenueCents: Number(raw.revenue_cents ?? 0),
      commissionCents: Number(raw.commission_cents ?? 0),
      payoutCents: Number(raw.payout_cents ?? 0),
      orderCount: Number(raw.order_count ?? 0),
      awaitingCount: Number(raw.awaiting_count ?? 0),
      shippedCount: Number(raw.shipped_count ?? 0),
      deliveredCount: Number(raw.delivered_count ?? 0),
      avgOrderCents: Number(raw.avg_order_cents ?? 0),
      activeProducts: Number(raw.active_products ?? 0),
      outOfStockProducts: Number(raw.out_of_stock_products ?? 0),
      dailyRevenue: ((raw.daily_revenue as Array<Record<string, unknown>> | null) ?? []).map(
        (point) => ({
          day: String(point.day),
          revenueCents: Number(point.revenue_cents ?? 0),
          orderCount: Number(point.order_count ?? 0),
        }),
      ),
    },
  };
}

export async function getVendorOrders(
  vendorId: string | null,
  limit = 20,
): Promise<{ orders: DemoVendorOrder[]; isLive: boolean }> {
  const supabase = await createClient();

  if (!supabase || !vendorId) {
    return { orders: buildDemoOrders(), isLive: false };
  }

  const { data, error } = await supabase
    .from('vendor_orders')
    .select(
      `id, status, items_subtotal_cents, commission_cents, payout_cents, created_at,
       order:orders ( order_number, shipping_address ),
       items:order_items ( title_snapshot, quantity, unit_price_cents )`,
    )
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return { orders: buildDemoOrders(), isLive: false };
  }

  const orders: DemoVendorOrder[] = data.map((row: Record<string, unknown>) => {
    const rawOrder = row.order;
    const order = (Array.isArray(rawOrder) ? rawOrder[0] : rawOrder) as
      | Record<string, unknown>
      | null;

    const address = (order?.shipping_address ?? {}) as Record<string, unknown>;
    const items = (row.items as Array<Record<string, unknown>> | null) ?? [];

    return {
      id: String(row.id),
      orderNumber: order?.order_number ? String(order.order_number) : '—',
      customerCity: address.city ? String(address.city) : '—',
      status: row.status as DemoVendorOrder['status'],
      itemCount: items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
      itemsSubtotalCents: Number(row.items_subtotal_cents ?? 0),
      commissionCents: Number(row.commission_cents ?? 0),
      payoutCents: Number(row.payout_cents ?? 0),
      createdAt: String(row.created_at),
      items: items.map((item) => ({
        title: String(item.title_snapshot ?? ''),
        quantity: Number(item.quantity ?? 1),
        unitPriceCents: Number(item.unit_price_cents ?? 0),
      })),
    };
  });

  return { orders, isLive: true };
}
