'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { ReviewableItem } from '@/data/catalog';
import { submitReview, type ReviewResult } from '@/app/degerlendirmelerim/actions';

import { Field } from './Field';
import { StarInput } from './StarInput';
import { AlertIcon, CheckIcon } from './Icons';

export function ReviewForm({ item }: { item: ReviewableItem }) {
  const [state, formAction] = useActionState<ReviewResult, FormData>(submitReview, {});

  if (state.ok) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
        <CheckIcon className="h-4 w-4 shrink-0" />
        Değerlendirmeniz yayınlandı. Teşekkürler.
      </p>
    );
  }

  if (state.needsAuth) {
    return (
      <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
        Değerlendirme yazmak için giriş yapmanız gerekiyor.
      </p>
    );
  }

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="mt-4 space-y-4" noValidate>
      <input type="hidden" name="order_item_id" value={item.orderItemId} />
      <input type="hidden" name="group_id" value={item.groupId} />
      <input type="hidden" name="vendor_id" value={item.vendorId} />

      {/* İki puan YAN YANA: ikisinin ayrı sorular olduğu, birlikte
          görüldüğünde anlaşılır. Alt alta olsaydı ikinci soru kolayca
          gözden kaçar ve aynı puan iki kez verilirdi. */}
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <StarInput name="product_rating" label="Ürün nasıldı?" required />
        <StarInput name="vendor_rating" label={`${item.vendorName} nasıldı?`} required />
      </div>

      <Field
        label="Başlık (isteğe bağlı)"
        name="title"
        inputId={`title-${item.orderItemId}`}
        error={errors.title}
        maxLength={120}
      />
      <Field
        label="Deneyiminiz (isteğe bağlı)"
        name="body"
        inputId={`body-${item.orderItemId}`}
        multiline
        rows={4}
        error={errors.body}
        hint="Ürünün beklediğiniz gibi olup olmadığını ve teslimat deneyiminizi yazın."
      />

      {state.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="press rounded-xl bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? 'Gönderiliyor…' : 'Değerlendirmeyi gönder'}
    </button>
  );
}
