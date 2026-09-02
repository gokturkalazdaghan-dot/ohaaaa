'use client';

import { useState, useTransition } from 'react';

import { reviewVendorDocument, signedDocumentUrl } from '@/app/tasoron/panel/belgeler/actions';

export function DocumentReview({
  documentId,
  storagePath,
}: {
  documentId: string;
  storagePath: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /*
   * Belge bağlantısı ÖNCEDEN üretilmez, tıklanınca üretilir.
   *
   * İmzalı adres 60 saniye yaşıyor; sayfayla birlikte üretilseydi liste açık
   * dururken süresi dolar ve her tıklama boş bir sayfa açardı. Ayrıca
   * çizilen ama hiç tıklanmayan her satır için boşuna imza üretilirdi.
   */
  function openDocument() {
    setError(null);
    startTransition(async () => {
      const url = await signedDocumentUrl(storagePath).catch(() => null);
      if (!url) {
        setError('Belge açılamadı.');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={openDocument}
        disabled={pending}
        className="rounded-xl border border-line px-3.5 py-1.5 text-xs font-medium transition-colors hover:border-brand/50 disabled:opacity-60"
      >
        {pending ? 'Açılıyor…' : 'Belgeyi aç'}
      </button>

      <form action={reviewVendorDocument} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="document_id" value={documentId} />

        <div>
          <label
            htmlFor={`not-${documentId}`}
            className="block text-2xs font-semibold uppercase tracking-wide text-subtle"
          >
            İnceleme notu
          </label>
          <input
            id={`not-${documentId}`}
            name="review_note"
            maxLength={1000}
            placeholder="Reddediyorsanız gerekçe yazın"
            className="mt-1 w-64 rounded-xl border border-line bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-brand"
          />
        </div>

        <button
          type="submit"
          name="status"
          value="approved"
          className="rounded-xl press bg-brand-cta px-4 py-2 text-xs font-semibold text-white"
        >
          Onayla
        </button>
        <button
          type="submit"
          name="status"
          value="rejected"
          className="rounded-xl border border-line px-4 py-2 text-xs font-medium text-muted transition-colors hover:border-danger/50 hover:text-danger"
        >
          Reddet
        </button>
      </form>

      <p aria-live="polite" className="text-xs text-danger">
        {error}
      </p>
    </div>
  );
}
