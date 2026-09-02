'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { uploadVendorDocument, type DocumentResult } from './actions';

const TURLER = [
  { value: 'vergi_levhasi', label: 'Vergi levhası' },
  { value: 'imza_sirkuleri', label: 'İmza sirküleri' },
  { value: 'kimlik', label: 'Kimlik belgesi' },
  { value: 'diger', label: 'Diğer' },
];

export function DocumentUpload({ vendorId }: { vendorId: string }) {
  const [state, formAction] = useActionState<DocumentResult, FormData>(
    uploadVendorDocument,
    {},
  );

  return (
    <form
      action={formAction}
      // Dosya alanı olan bir form multipart olmak ZORUNDA; aksi hâlde sunucuya
      // dosyanın yalnızca adı gider.
      encType="multipart/form-data"
      // Başarıdan sonra alanlar yeniden kurulur: seçili dosya adı ekranda
      // kalırsa kullanıcı aynı belgeyi ikinci kez yükler.
      key={state.ok ? 'gonderildi' : 'yeni'}
      className="card p-5"
    >
      <h2 className="font-semibold text-fg">Belge yükle</h2>
      <p className="mt-1.5 text-sm text-muted">
        PDF, JPEG veya PNG · en fazla 8 MB. Belgeleriniz yalnızca siz ve
        Ohaaaa yöneticisi tarafından görülebilir.
      </p>

      <input type="hidden" name="vendor_id" value={vendorId} />

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="doc_type" className="text-xs font-medium text-muted">
            Belge türü
          </label>
          <select
            id="doc_type"
            name="doc_type"
            required
            defaultValue="vergi_levhasi"
            className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-fg outline-none transition-colors focus:border-brand"
          >
            {TURLER.map((tur) => (
              <option key={tur.value} value={tur.value}>
                {tur.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="file" className="text-xs font-medium text-muted">
            Dosya
          </label>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept="application/pdf,image/jpeg,image/png"
            aria-describedby={state.error ? 'belge-hata' : undefined}
            aria-invalid={state.error ? true : undefined}
            className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3.5 py-2 text-sm text-fg file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-fg"
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <UploadButton />
        <p aria-live="polite" className="text-sm">
          {state.error && (
            <span id="belge-hata" className="text-danger">
              {state.error}
            </span>
          )}
          {state.ok && (
            <span className="text-success">Belge yüklendi, incelenmeyi bekliyor.</span>
          )}
        </p>
      </div>
    </form>
  );
}

function UploadButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl press bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? 'Yükleniyor…' : 'Belgeyi yükle'}
    </button>
  );
}
