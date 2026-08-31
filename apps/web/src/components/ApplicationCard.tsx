'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { AlertIcon } from './Icons';
import { decideApplication, type AdminActionResult } from '@/app/yonetim/actions';
import type { VendorApplication } from '@/app/yonetim/basvurular/page';

const STATUS_META = {
  pending: { label: 'Bekliyor', className: 'bg-warning/12 text-warning' },
  approved: { label: 'Onaylı', className: 'bg-success/12 text-success' },
  rejected: { label: 'Reddedildi', className: 'bg-danger/12 text-danger' },
  suspended: { label: 'Askıda', className: 'bg-danger/12 text-danger' },
} as const;

/**
 * Başvuru kartı.
 *
 * Komisyon oranı ONAY ANINDA belirlenir ve bir daha bu ekrandan
 * değiştirilmez — sipariş anındaki oran `vendor_orders.commission_rate`
 * alanına kopyalanır, dolayısıyla sonradan yapılan değişiklik geçmiş
 * siparişleri etkilemez.
 */
export function ApplicationCard({
  application,
  readOnly = false,
}: {
  application: VendorApplication;
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState<AdminActionResult, FormData>(
    decideApplication,
    {},
  );

  const status = STATUS_META[application.status];

  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{application.displayName}</h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${status.className}`}
            >
              {status.label}
            </span>
          </div>

          <p className="mt-1 font-mono text-xs text-muted">
            ohaaaa.com/magaza/{application.slug}
          </p>

          <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <Row label="Ticari unvan" value={application.legalName} />
            <Row label="Vergi / TC no" value={application.taxId} />
            <Row label="Destek e-posta" value={application.supportEmail} />
            <Row label="Telefon" value={application.supportPhone} />
            <Row label="Hesap" value={application.ownerEmail} />
            <Row label="Web sitesi" value={application.websiteUrl} />
          </dl>

          {application.description && (
            <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">
              {application.description}
            </p>
          )}
        </div>

        <p className="shrink-0 text-right text-[11px] text-subtle">
          {new Date(application.createdAt).toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
          {application.status === 'approved' && (
            <>
              <br />
              <span className="tabular">
                Komisyon %{(application.commissionRate * 100).toFixed(1)}
              </span>
            </>
          )}
        </p>
      </div>

      {!readOnly && (
        <form action={formAction} className="mt-4 border-t border-line pt-4">
          <input type="hidden" name="vendorId" value={application.id} />

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor={`rate-${application.id}`}
                className="text-[11px] font-medium text-muted"
              >
                Komisyon oranı
              </label>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  id={`rate-${application.id}`}
                  name="commissionRate"
                  type="number"
                  step="0.005"
                  min="0"
                  max="0.5"
                  defaultValue={application.commissionRate}
                  className="w-24 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                />
                <span className="text-xs text-subtle">
                  = %{(application.commissionRate * 100).toFixed(1)}
                </span>
              </div>
            </div>

            <div className="flex-1 min-w-48">
              <label
                htmlFor={`reason-${application.id}`}
                className="text-[11px] font-medium text-muted"
              >
                Ret gerekçesi (reddediyorsanız)
              </label>
              <input
                id={`reason-${application.id}`}
                name="reason"
                type="text"
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </div>

            <div className="flex gap-2">
              <DecisionButton value="approve" label="Onayla" tone="approve" />
              <DecisionButton value="reject" label="Reddet" tone="reject" />
            </div>
          </div>

          {state.error && (
            <p
              role="alert"
              className="mt-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger"
            >
              <AlertIcon className="h-4 w-4 shrink-0" />
              {state.error}
            </p>
          )}
        </form>
      )}
    </article>
  );
}

function DecisionButton({
  value,
  label,
  tone,
}: {
  value: 'approve' | 'reject';
  label: string;
  tone: 'approve' | 'reject';
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="decision"
      value={value}
      disabled={pending}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-transform disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === 'approve'
          ? 'press bg-brand-cta text-white'
          : 'border border-line text-muted hover:border-danger/40 hover:text-danger'
      }`}
    >
      {pending ? '…' : label}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div className="flex gap-2">
      <dt className="text-subtle">{label}:</dt>
      <dd className="min-w-0 truncate text-muted">{value}</dd>
    </div>
  );
}
