import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ApplicationCard } from '@/components/ApplicationCard';
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
  title: 'Satıcı başvuruları',
  robots: { index: false, follow: false },
};

export interface VendorApplication {
  id: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  taxId: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  websiteUrl: string | null;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  commissionRate: number;
  createdAt: string;
  ownerEmail: string | null;
}

export default async function ApplicationsPage() {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') redirect('/');

  const supabase = await createClient();
  if (!supabase) redirect('/');

  const { data } = await supabase
    .from('vendors')
    .select(
      `id, slug, display_name, legal_name, tax_id, support_email, support_phone,
       website_url, description, status, commission_rate, created_at,
       owner:users ( email )`,
    )
    .order('created_at', { ascending: false })
    .limit(100);

  const applications: VendorApplication[] = (data ?? []).map(
    (row: Record<string, unknown>) => {
      const rawOwner = row.owner;
      const owner = (Array.isArray(rawOwner) ? rawOwner[0] : rawOwner) as
        | Record<string, unknown>
        | null;

      return {
        id: String(row.id),
        slug: String(row.slug),
        displayName: String(row.display_name),
        legalName: row.legal_name ? String(row.legal_name) : null,
        taxId: row.tax_id ? String(row.tax_id) : null,
        supportEmail: row.support_email ? String(row.support_email) : null,
        supportPhone: row.support_phone ? String(row.support_phone) : null,
        websiteUrl: row.website_url ? String(row.website_url) : null,
        description: row.description ? String(row.description) : null,
        status: row.status as VendorApplication['status'],
        commissionRate: Number(row.commission_rate),
        createdAt: String(row.created_at),
        ownerEmail: owner?.email ? String(owner.email) : null,
      };
    },
  );

  const pending = applications.filter((app) => app.status === 'pending');
  const decided = applications.filter((app) => app.status !== 'pending');

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-bold">
          Onay bekleyen{' '}
          <span className="text-sm font-normal text-muted">({pending.length})</span>
        </h2>

        {pending.length === 0 ? (
          <p className="mt-3 rounded-xl border border-line bg-surface p-5 text-sm text-muted">
            Bekleyen başvuru yok.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {pending.map((application) => (
              <ApplicationCard key={application.id} application={application} />
            ))}
          </div>
        )}
      </section>

      {decided.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">Karara bağlananlar</h2>
          <div className="mt-4 space-y-3">
            {decided.map((application) => (
              <ApplicationCard key={application.id} application={application} readOnly />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
