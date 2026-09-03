import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { formatMoney } from '@ohaaaa/shared';

import { AlertIcon, ChartIcon, ShieldIcon, StoreIcon } from '@/components/Icons';
import { getSessionUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

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
  title: 'Yönetim',
  robots: { index: false, follow: false },
};

interface DashboardData {
  clicks: number;
  epcCents: number;
  conversions: {
    count: number;
    approved: number;
    pending: number;
    rejected: number;
    grossCents: number;
    commissionCents: number;
  };
  catalog: { affiliateOffers: number; activeOffers: number; staleOffers: number };
  topMerchants: Array<{ display_name: string; conversions: number; commission_cents: number }>;
}

export default async function AdminOverviewPage() {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') redirect('/');

  const supabase = await createClient();
  if (!supabase) redirect('/');

  const [{ data: dashboard }, { count: pendingCount }] = await Promise.all([
    supabase.rpc('affiliate_dashboard', { p_days: 30 }),
    supabase
      .from('vendors')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ]);

  const raw = (dashboard ?? {}) as Record<string, unknown>;
  const conversions = (raw.conversions ?? {}) as Record<string, unknown>;
  const catalog = (raw.catalog ?? {}) as Record<string, unknown>;

  const data: DashboardData = {
    clicks: Number(raw.clicks ?? 0),
    epcCents: Number(raw.epc_cents ?? 0),
    conversions: {
      count: Number(conversions.count ?? 0),
      approved: Number(conversions.approved ?? 0),
      pending: Number(conversions.pending ?? 0),
      rejected: Number(conversions.rejected ?? 0),
      grossCents: Number(conversions.gross_cents ?? 0),
      commissionCents: Number(conversions.commission_cents ?? 0),
    },
    catalog: {
      affiliateOffers: Number(catalog.affiliate_offers ?? 0),
      activeOffers: Number(catalog.active_offers ?? 0),
      staleOffers: Number(catalog.stale_offers ?? 0),
    },
    topMerchants:
      (raw.top_merchants as DashboardData['topMerchants'] | null) ?? [],
  };

  const conversionRate =
    data.clicks > 0 ? ((data.conversions.count / data.clicks) * 100).toFixed(2) : '0.00';

  return (
    <div className="space-y-6">
      {(pendingCount ?? 0) > 0 && (
        <a
          href="/yonetim/basvurular"
          className="flex items-center gap-3 rounded-xl border border-warning/25 bg-warning/8 p-4 text-sm text-warning transition-colors hover:border-warning/45"
        >
          <AlertIcon className="h-5 w-5 shrink-0" />
          <span>
            <strong className="font-semibold">{pendingCount} başvuru</strong> onay
            bekliyor.
          </span>
        </a>
      )}

      {/*
        Belge sayfası buradan bağlanır. Bağlanmasaydı sayfa yazılmış ama
        ulaşılamaz olurdu -- yönetici adresi ezberlemek zorunda kalırdı.
      */}
      <a
        href="/yonetim/belgeler"
        className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-sm transition-colors hover:border-brand/40"
      >
        <ShieldIcon className="h-5 w-5 shrink-0 text-brand" />
        <span className="text-fg">
          <strong className="font-semibold">Satıcı belgeleri</strong> — vergi levhası
          ve imza sirkülerini inceleyin.
        </span>
      </a>

      {/*
        Tahsilat sayfası.

        Bu panodaki "komisyon" rakamı AĞIN BEYANIDIR; hesaba geçen para
        değildir. İkisi aynı sayfada aynı büyüklükte durursa okuyucu ikisini
        aynı sanar. Tahsilat ayrı bir sayfada ve buradan bağlanıyor.
      */}
      <a
        href="/yonetim/tahsilat"
        className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-sm transition-colors hover:border-brand/40"
      >
        <ChartIcon className="h-5 w-5 shrink-0 text-brand" />
        <span className="text-fg">
          <strong className="font-semibold">Tahsilat</strong> — hesaba gerçekten geçen
          tutar. Aşağıdaki komisyon rakamı ağın beyanıdır, tahsilat değildir.
        </span>
      </a>

      <section className="card-glow p-6">
        <p className="text-xs text-muted">Son 30 günün onaylı komisyonu</p>
        <p className="tabular mt-1 text-4xl font-black tracking-tight text-success">
          {formatMoney(data.conversions.commissionCents)}
        </p>
        <p className="mt-1 text-xs text-subtle">
          {formatMoney(data.conversions.grossCents)} ciro üzerinden
        </p>

        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Metric label="Yönlendirme" value={data.clicks.toLocaleString('tr-TR')} />
          <Metric label="Dönüşüm oranı" value={`%${conversionRate}`} />
          <Metric
            label="Tıklama başına kazanç"
            value={formatMoney(data.epcCents)}
            hint="EPC"
          />
          <Metric
            label="Onay bekleyen"
            value={String(data.conversions.pending)}
            tone={data.conversions.pending > 0 ? 'warning' : undefined}
          />
        </dl>
      </section>

      {/*
        En pahalı sessiz hata: tıklama gelip dönüşüm gelmemesi. Postback
        yapılandırması bozuksa satış gerçekleşir, komisyon tahakkuk eder ama
        biz göremeyiz. Bu yüzden panelde en görünür uyarı budur.
      */}
      {data.clicks > 200 && data.conversions.count === 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="leading-relaxed">
            <strong className="font-semibold">Dönüşüm bildirimi gelmiyor.</strong>{' '}
            {data.clicks.toLocaleString('tr-TR')} yönlendirme yapıldı ama hiç dönüşüm
            kaydedilmedi. Ortaklık ağının postback yapılandırmasını kontrol edin —
            satışlar gerçekleşiyor olabilir ama kaydedilmiyor.
          </p>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<StoreIcon className="h-5 w-5" />}
          label="Ortak mağaza teklifi"
          value={data.catalog.affiliateOffers}
          tone="info"
        />
        <StatCard
          icon={<ChartIcon className="h-5 w-5" />}
          label="Yayındaki teklif"
          value={data.catalog.activeOffers}
          tone="success"
        />
        <StatCard
          icon={<AlertIcon className="h-5 w-5" />}
          label="48 saattir güncellenmeyen"
          value={data.catalog.staleOffers}
          tone={data.catalog.staleOffers > 0 ? 'warning' : 'success'}
          hint={data.catalog.staleOffers > 0 ? 'Feed yayını durmuş olabilir' : undefined}
        />
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">Mağazalara göre komisyon</h2>

        {data.topMerchants.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Henüz onaylı dönüşüm yok. Ortaklık hesapları bağlandıktan sonra burası
            dolacak.
          </p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="pb-2 font-medium">Mağaza</th>
                <th scope="col" className="pb-2 text-right font-medium">Dönüşüm</th>
                <th scope="col" className="pb-2 text-right font-medium">Komisyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.topMerchants.map((merchant) => (
                <tr key={merchant.display_name}>
                  <td className="py-2">{merchant.display_name}</td>
                  <td className="tabular py-2 text-right">{merchant.conversions}</td>
                  <td className="tabular py-2 text-right font-semibold text-success">
                    {formatMoney(merchant.commission_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'warning';
}) {
  return (
    <div>
      <dd
        className={`tabular text-xl font-bold ${
          tone === 'warning' ? 'text-warning' : 'text-fg'
        }`}
      >
        {value}
      </dd>
      <dt className="text-2xs text-muted">
        {label}
        {hint && <span className="ml-1 text-subtle">({hint})</span>}
      </dt>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'info' | 'success' | 'warning';
  hint?: string;
}) {
  const toneClasses = {
    info: 'text-electric bg-electric/12',
    success: 'text-success bg-success/12',
    warning: 'text-warning bg-warning/12',
  }[tone];

  return (
    <article className="card flex items-center gap-4 p-5">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${toneClasses}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="tabular text-2xl font-black leading-none">
          {value.toLocaleString('tr-TR')}
        </p>
        <p className="mt-1 text-sm font-medium">{label}</p>
        {hint && <p className="text-2xs text-subtle">{hint}</p>}
      </div>
    </article>
  );
}
