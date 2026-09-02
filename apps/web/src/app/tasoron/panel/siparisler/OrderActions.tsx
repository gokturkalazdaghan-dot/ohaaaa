'use client';

/**
 * Siparişin bir sonraki adımı.
 *
 * Her durumda YALNIZCA bir sonraki adım gösterilir. Bütün geçişleri aynı
 * anda göstermek, satıcıya "kargolandı"yı hazırlamadan işaretleme imkânı
 * verir ve alıcıya yanlış bildirim gider. Geçiş tablosu zaten sunucuda
 * uygulanıyor; arayüz onunla aynı şeyi söylemeli ki satıcı reddedilecek bir
 * düğmeye basmasın.
 */

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { nextVendorOrderStep } from '@ohaaaa/shared';

import type { CarrierOption } from '@/data/carriers';

import { updateOrderStatus, type OrderActionResult } from './actions';

export function OrderActions({
  vendorOrderId,
  status,
  carriers,
  carrier,
  trackingNumber,
}: {
  vendorOrderId: string;
  status: string;
  carriers: CarrierOption[];
  carrier: string | null;
  trackingNumber: string | null;
}) {
  const [state, formAction] = useActionState<OrderActionResult, FormData>(
    updateOrderStatus,
    {},
  );

  const step = nextVendorOrderStep(status);

  // Kargo bilgisi girildikten sonra da görünür kalır: satıcı hangi numarayı
  // verdiğini panelde görebilmeli, aramak için kargo firmasına gitmemeli.
  const tracking = trackingNumber ? (
    <p className="mt-3 text-xs text-muted">
      Takip: <span className="font-mono font-medium text-fg">{trackingNumber}</span>
      {carrier && <> · {carriers.find((c) => c.code === carrier)?.name ?? carrier}</>}
    </p>
  ) : null;

  if (!step) return tracking;

  const needsShipping = step.status === 'shipped';
  const errorId = `siparis-hata-${vendorOrderId}`;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="vendor_order_id" value={vendorOrderId} />
        <input type="hidden" name="status" value={step.status} />

        {needsShipping && (
          <>
            <div>
              <label
                htmlFor={`kargo-${vendorOrderId}`}
                className="block text-2xs font-semibold uppercase tracking-wide text-subtle"
              >
                Kargo firması
              </label>
              <select
                id={`kargo-${vendorOrderId}`}
                name="carrier"
                required
                defaultValue={carrier ?? ''}
                className="mt-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg"
              >
                <option value="" disabled>
                  Seçin
                </option>
                {carriers.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={`takip-${vendorOrderId}`}
                className="block text-2xs font-semibold uppercase tracking-wide text-subtle"
              >
                Takip numarası
              </label>
              <input
                id={`takip-${vendorOrderId}`}
                name="tracking_number"
                required
                inputMode="numeric"
                autoComplete="off"
                aria-describedby={state.error ? errorId : undefined}
                aria-invalid={state.error ? true : undefined}
                className="mt-1 w-48 rounded-xl border border-line bg-surface px-3 py-2 font-mono text-sm text-fg"
              />
            </div>
          </>
        )}

        <SubmitButton label={step.label} />
      </form>

      {/* Hata da başarı da SESLİ duyurulur: ekran okuyucu kullanan satıcı,
          formun ne yaptığını görsel bir renk değişiminden anlayamaz. */}
      <p aria-live="polite" className="mt-2 text-xs">
        {state.error && (
          <span id={errorId} className="text-danger">
            {state.error}
          </span>
        )}
        {state.ok && <span className="text-success">Kaydedildi.</span>}
      </p>

      {needsShipping && (
        <p className="mt-1 text-2xs text-subtle">
          Numara, seçtiğiniz firmanın biçimine uymalı. Uydurma ya da başka bir
          gönderiye ait numara, sözleşme gereği ihlal puanı doğurur.
        </p>
      )}

      {tracking}
    </div>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl press bg-brand-cta px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
    >
      {pending ? 'Kaydediliyor…' : label}
    </button>
  );
}
