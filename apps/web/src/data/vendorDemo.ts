/**
 * Taşeron paneli için demo veri üreteci.
 *
 * Sayılar sabit bir tohum (seed) ile üretilir: panel her yenilemede AYNI
 * grafiği göstermelidir. Rastgele veri, "grafik çalışıyor mu yoksa gürültü
 * mü üretiyor" sorusunu cevapsız bırakır.
 */

import type { VendorDashboardStats } from '@ohaaaa/shared';

/** Belirlenimci (deterministic) sözde-rastgele üreteç — mulberry32. */
function seededRandom(seed: number): () => number {
  let state = seed;

  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDemoStats(windowDays = 30): VendorDashboardStats {
  const random = seededRandom(20260829);
  const dailyRevenue: VendorDashboardStats['dailyRevenue'] = [];

  let revenueCents = 0;
  let orderCount = 0;

  for (let dayOffset = windowDays - 1; dayOffset >= 0; dayOffset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - dayOffset);

    // Hafta sonu yükselişi — gerçek e-ticaret trafiğinin belirgin deseni.
    const weekday = date.getDay();
    const weekendLift = weekday === 0 || weekday === 6 ? 1.35 : 1;

    // Yukarı trend: panelin anlattığı hikâye ile grafiğin gösterdiği yön
    // aynı olmalı. Rastgelelik bandı (±%25) trendi (+%60) bastıramayacak
    // kadar dar tutulur, aksi halde "büyüyor" denen işletme düşüş gösterir.
    const trend = 1 + ((windowDays - dayOffset) / windowDays) * 0.6;

    const orders = Math.round((10 + random() * 5) * weekendLift * trend);
    const dayRevenue = Math.round(orders * (140_000 + random() * 70_000) * trend);

    dailyRevenue.push({
      day: date.toISOString().slice(0, 10),
      revenueCents: dayRevenue,
      orderCount: orders,
    });

    revenueCents += dayRevenue;
    orderCount += orders;
  }

  const commissionCents = Math.floor(revenueCents * 0.07);

  return {
    vendorId: 'vendor-teknomarkt',
    windowDays,
    revenueCents,
    commissionCents,
    payoutCents: revenueCents - commissionCents,
    orderCount,
    awaitingCount: 12,
    shippedCount: 47,
    deliveredCount: orderCount - 59,
    avgOrderCents: Math.round(revenueCents / Math.max(orderCount, 1)),
    activeProducts: 5,
    outOfStockProducts: 1,
    dailyRevenue,
  };
}

export interface DemoVendorOrder {
  id: string;
  orderNumber: string;
  customerCity: string;
  status: 'awaiting_vendor' | 'accepted' | 'preparing' | 'shipped' | 'delivered';
  itemCount: number;
  itemsSubtotalCents: number;
  commissionCents: number;
  payoutCents: number;
  createdAt: string;
  items: Array<{ title: string; quantity: number; unitPriceCents: number }>;
}

export function buildDemoOrders(): DemoVendorOrder[] {
  const rows: Array<[string, string, DemoVendorOrder['status'], number, number, string[]]> = [
    ['OHA-20260829-7F3K2Q', 'İstanbul', 'awaiting_vendor', 1, 1_189_900, ['Sony WH-1000XM5 Kablosuz Kulaklık']],
    ['OHA-20260829-A91BX4', 'Ankara', 'accepted', 2, 3_389_800, ['Apple iPhone 15 128GB', 'Sony WH-1000XM5 Kablosuz Kulaklık']],
    ['OHA-20260828-C22MK8', 'İzmir', 'preparing', 1, 2_199_900, ['Lenovo IdeaPad Slim 3 Ryzen 7']],
    ['OHA-20260828-D40PL1', 'Bursa', 'shipped', 3, 2_474_700, ['Philips Airfryer XXL', 'Sony WH-1000XM5', 'Dyson V12 Detect Slim']],
    ['OHA-20260827-E17RT9', 'Antalya', 'delivered', 1, 5_499_900, ['Apple iPhone 15 128GB Siyah']],
    ['OHA-20260827-F88ZZ3', 'Konya', 'delivered', 2, 1_649_800, ['Philips Airfryer XXL', 'Sony WH-1000XM5']],
  ];

  return rows.map(([orderNumber, city, status, itemCount, subtotal, titles], index) => {
    const commission = Math.floor(subtotal * 0.07);
    const created = new Date();
    created.setHours(created.getHours() - index * 9);

    return {
      id: `vo-${index + 1}`,
      orderNumber,
      customerCity: city,
      status,
      itemCount,
      itemsSubtotalCents: subtotal,
      commissionCents: commission,
      payoutCents: subtotal - commission,
      createdAt: created.toISOString(),
      items: titles.map((title) => ({
        title,
        quantity: 1,
        unitPriceCents: Math.round(subtotal / titles.length),
      })),
    };
  });
}
