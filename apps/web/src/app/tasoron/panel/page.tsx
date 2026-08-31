import type { Metadata } from 'next';

import { formatMoney } from '@ohaaaa/shared';

import { BoxIcon, TruckIcon, CheckIcon, AlertIcon } from '@/components/Icons';
import { DataSourceNotice } from '@/components/DataSourceNotice';
import { RevenueChart } from '@/components/RevenueChart';
import { getOwnedVendor, getSessionUser } from '@/lib/auth';
import { getVendorStats } from '@/data/vendorStats';

/*
 * Oturuma bağlı sayfalar ASLA önbelleğe alınmamalıdır. Next, `cookies()`
 * çağrısını görürse rotayı kendiliğinden dinamik yapar — ama demo modunda
 * Supabase istemcisi çerezlere hiç dokunmadan null döndüğü için bu sinyal
 * oluşmuyor ve sayfa statik üretiliyordu. Bir yöneticinin verisinin
 * önbellekten başkasına servis edilmesi ihtimali, açık bir bildirimle
 * kapatılacak kadar ciddidir.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Satıcı paneli',
  robots: { index: false, follow: false },
};

export default async function VendorDashboardPage() {
  const user = await getSessionUser();
  const vendor = user ? await getOwnedVendor(user.id) : null;

  const { stats, isLive } = await getVendorStats(vendor?.id ?? null, 30);

  const lastWeek = stats.dailyRevenue.slice(-7);
  const previousWeek = stats.dailyRevenue.slice(-14, -7);

  const lastWeekRevenue = lastWeek.reduce((sum, point) => sum + point.revenueCents, 0);
  const previousWeekRevenue = previousWeek.reduce((sum, point) => sum + point.revenueCents, 0);

  const weeklyChange =
    previousWeekRevenue > 0
      ? Math.round(((lastWeekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100)
      : null;

  return (
    <div className="space-y-6">
      <DataSourceNotice isLive={isLive} vendorStatus={vendor?.status ?? null} />

      {/* Ana metrik: tek bir kahraman sayı, grafikten önce gelir. */}
      <section className="card-glow p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs text-muted">Son 30 günün cirosu</p>
            <p className="tabular mt-1 text-4xl font-black tracking-tight">
              {formatMoney(stats.revenueCents)}
            </p>

            {weeklyChange !== null && (
              <p
                className={`mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold ${
                  weeklyChange >= 0
                    ? 'bg-success/12 text-success'
                    : 'bg-danger/12 text-danger'
                }`}
              >
                {weeklyChange >= 0 ? '▲' : '▼'} %{Math.abs(weeklyChange)}
                <span className="font-normal text-muted">önceki haftaya göre</span>
              </p>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-right sm:grid-cols-3">
            <Metric label="Hakedişiniz" value={formatMoney(stats.payoutCents)} tone="success" />
            <Metric label="Platform komisyonu" value={formatMoney(stats.commissionCents)} />
            <Metric label="Sipariş" value={stats.orderCount.toLocaleString('tr-TR')} />
            <Metric label="Ortalama sepet" value={formatMoney(stats.avgOrderCents)} />
            <Metric label="Aktif ürün" value={String(stats.activeProducts)} />
            <Metric
              label="Stoğu biten"
              value={String(stats.outOfStockProducts)}
              tone={stats.outOfStockProducts > 0 ? 'warning' : undefined}
            />
          </dl>
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold">Günlük ciro</h2>
          <div className="mt-4">
            <RevenueChart data={stats.dailyRevenue} />
          </div>
        </div>
      </section>

      {/* Sipariş durumu — durum renkleri daima etiket ve ikonla birlikte. */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatusCard
          icon={<AlertIcon className="h-5 w-5" />}
          label="Onay bekleyen"
          value={stats.awaitingCount}
          tone="warning"
          hint="24 saat içinde onaylanmalı"
        />
        <StatusCard
          icon={<TruckIcon className="h-5 w-5" />}
          label="Kargoda"
          value={stats.shippedCount}
          tone="info"
          hint="Takip numarası girilmiş"
        />
        <StatusCard
          icon={<CheckIcon className="h-5 w-5" />}
          label="Teslim edilen"
          value={stats.deliveredCount}
          tone="success"
          hint="Hakediş ödemeye hazır"
        />
      </section>

      <section className="card p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BoxIcon className="h-4 w-4 text-brand" />
          Sonraki adım
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Kataloğunuzu otomatik senkronize etmek için bir API anahtarı oluşturun ve
          ürünlerinizi <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">POST /api/v1/products</code>{' '}
          uç noktasına gönderin. Besleme idempotenttir: aynı sayfayı tekrar
          göndermek mükerrer kayıt oluşturmaz.
        </p>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning';
}) {
  return (
    <div>
      <dd
        className={`tabular text-lg font-bold ${
          tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-fg'
        }`}
      >
        {value}
      </dd>
      <dt className="text-2xs text-muted">{label}</dt>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'warning' | 'info' | 'success';
  hint: string;
}) {
  const toneClasses = {
    warning: 'text-warning bg-warning/12',
    info: 'text-electric bg-electric/12',
    success: 'text-success bg-success/12',
  }[tone];

  return (
    <article className="card flex items-center gap-4 p-5">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${toneClasses}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="tabular text-2xl font-black leading-none">{value}</p>
        <p className="mt-1 text-sm font-medium">{label}</p>
        <p className="text-2xs text-subtle">{hint}</p>
      </div>
    </article>
  );
}
