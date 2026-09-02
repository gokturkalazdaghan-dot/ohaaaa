import type { Metadata } from 'next';

import { getVendorDocuments } from '@/data/vendorStats';

import { DocumentReview } from './DocumentReview';

export const metadata: Metadata = {
  title: 'Satıcı belgeleri',
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

export default async function AdminDocumentsPage() {
  const documents = await getVendorDocuments();

  /*
   * İncelenmeyi bekleyenler ÜSTTE. Karışık bir listede bekleyen belge,
   * onaylanmışların arasında kaybolur ve satıcı günlerce bekler.
   */
  const bekleyen = documents.filter((d) => d.status === 'pending');
  const digerleri = documents.filter((d) => d.status !== 'pending');

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-fg">Satıcı belgeleri</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
        Vergi levhası ve imza sirküleri, mağazanın beyan ettiği kimliği
        doğrular. Belgeyi açmak için üretilen bağlantı 60 saniye yaşar.
      </p>

      {documents.length === 0 ? (
        <p className="card mt-8 p-6 text-sm text-muted">Yüklenmiş belge yok.</p>
      ) : (
        <>
          <h2 className="mt-8 text-sm font-semibold text-fg">
            İnceleme bekleyen ({bekleyen.length})
          </h2>
          {bekleyen.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Bekleyen belge yok.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {bekleyen.map((doc) => (
                <li key={doc.id} className="card p-5">
                  <Header doc={doc} />
                  <DocumentReview documentId={doc.id} storagePath={doc.storagePath} />
                </li>
              ))}
            </ul>
          )}

          {digerleri.length > 0 && (
            <>
              <h2 className="mt-10 text-sm font-semibold text-fg">İncelenmiş</h2>
              <ul className="mt-3 space-y-3">
                {digerleri.map((doc) => (
                  <li key={doc.id} className="card p-5">
                    <Header doc={doc} />
                    {doc.reviewNote && (
                      <p className="mt-2 text-xs text-muted">Not: {doc.reviewNote}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Header({
  doc,
}: {
  doc: { vendorName: string; docType: string; fileName: string; status: string; createdAt: string };
}) {
  const durum = DURUM[doc.status];

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <p className="font-semibold text-fg">{doc.vendorName}</p>
        <p className="text-xs text-muted">
          {TUR_ADI[doc.docType] ?? doc.docType} · {doc.fileName} ·{' '}
          {new Date(doc.createdAt).toLocaleDateString('tr-TR')}
        </p>
      </div>
      <span
        className={`rounded-full px-2.5 py-0.5 text-3xs font-bold uppercase ${durum?.className ?? 'bg-surface-2 text-muted'}`}
      >
        {durum?.label ?? doc.status}
      </span>
    </div>
  );
}
