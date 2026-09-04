import type { Metadata } from 'next';

import { getOwnedVendor, getSessionUser } from '@/lib/auth';
import { getVendorDocuments } from '@/data/vendorStats';

import { DocumentUpload } from './DocumentUpload';
import { requireMarketplaceMode } from '@/lib/commerceGuard';

export const metadata: Metadata = {
  title: 'Belgelerim',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const TUR_ADI: Record<string, string> = {
  vergi_levhasi: 'Vergi levhası',
  imza_sirkuleri: 'İmza sirküleri',
  kimlik: 'Kimlik belgesi',
  diger: 'Diğer',
};

const DURUM: Record<string, { label: string; className: string }> = {
  pending: { label: 'İnceleniyor', className: 'bg-warning/12 text-warning' },
  approved: { label: 'Onaylandı', className: 'bg-success/12 text-success' },
  rejected: { label: 'Reddedildi', className: 'bg-danger/12 text-danger' },
};

export default async function VendorDocumentsPage() {
  requireMarketplaceMode();

  const user = await getSessionUser();
  const vendor = user ? await getOwnedVendor(user.id) : null;

  if (!vendor) {
    return (
      <div className="card p-6">
        <p className="font-semibold text-fg">Mağaza hesabı bulunamadı</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Belge yükleme, onaylanmış bir mağaza hesabına bağlıdır.
        </p>
      </div>
    );
  }

  const documents = await getVendorDocuments(vendor.id);

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-bold">Belgelerim</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          Vergi levhanız ve imza sirkülerinizi buradan yüklersiniz. Bu belgeler
          mağazanızın kim olduğunu doğrular; alıcıya gösterilmez, yalnızca
          Ohaaaa yöneticisi inceler.
        </p>
      </header>

      <DocumentUpload vendorId={vendor.id} />

      {documents.length > 0 && (
        <ul className="space-y-3">
          {documents.map((doc) => {
            const durum = DURUM[doc.status];
            return (
              <li key={doc.id} className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">{TUR_ADI[doc.docType] ?? doc.docType}</p>
                  <p className="truncate text-xs text-muted">{doc.fileName}</p>
                  {/* Ret gerekçesi GÖSTERİLİR: neyin eksik olduğunu bilmeyen
                      satıcı aynı belgeyi yeniden yükler. */}
                  {doc.reviewNote && (
                    <p className="mt-1 text-xs text-muted">Not: {doc.reviewNote}</p>
                  )}
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-3xs font-bold uppercase ${durum?.className ?? 'bg-surface-2 text-muted'}`}
                >
                  {durum?.label ?? doc.status}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
