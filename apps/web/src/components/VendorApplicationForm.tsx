'use client';

import Link from 'next/link';
import { useState } from 'react';

import { vendorApplicationSchema } from '@ohaaaa/shared';

import { AlertIcon, CheckIcon } from './Icons';

/**
 * Taşeron başvuru formu.
 *
 * Doğrulama, backend'in kullandığı ŞEMANIN AYNISIYLA yapılır
 * (@ohaaaa/shared → vendorApplicationSchema). Böylece istemcide geçen bir
 * girdi sunucuda reddedilmez; kural tek yerde yaşar.
 */
export function VendorApplicationForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');

  /** Mağaza adından otomatik slug türetir (kullanıcı elle değiştirmediyse). */
  function onDisplayNameChange(value: string) {
    setDisplayName(value);

    if (!slugTouched) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[ğüşıöç]/g, (char) => ({ ğ: 'g', ü: 'u', ş: 's', ı: 'i', ö: 'o', ç: 'c' })[char] ?? char)
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48),
      );
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const formData = new FormData(event.currentTarget);
    const candidate = Object.fromEntries(formData.entries());

    const parsed = vendorApplicationSchema.safeParse(candidate);

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && !fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    // Canlı kurulumda burada supabase.from('vendors').insert(...) çağrılır;
    // RLS politikası kaydın 'pending' durumunda açılmasını zorunlu kılar.
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="card-glow mt-10 p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-success/12 text-success">
          <CheckIcon className="h-8 w-8" />
        </span>
        <h2 className="mt-5 text-xl font-black">Başvurunuz alındı</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Vergi numarası doğrulaması tamamlandığında e-posta ile bilgilendirileceksiniz.
          Bu sırada paneli örnek verilerle inceleyebilirsiniz.
        </p>
        <Link
          href="/tasoron/panel"
          className="mt-6 inline-block rounded-xl bg-gradient-to-r from-brand to-electric px-5 py-2.5 text-sm font-semibold text-white"
        >
          Paneli incele
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card mt-8 space-y-5 p-6" noValidate>
      <Field
        label="Mağaza adı"
        name="display_name"
        value={displayName}
        onChange={(event) => onDisplayNameChange(event.target.value)}
        error={errors.display_name}
        hint="Müşterilerin göreceği isim."
      />

      <Field
        label="Mağaza adresi"
        name="slug"
        value={slug}
        onChange={(event) => {
          setSlugTouched(true);
          setSlug(event.target.value);
        }}
        error={errors.slug}
        prefix="ohaaaa.com/magaza/"
      />

      <Field label="Ticari unvan" name="legal_name" error={errors.legal_name} hint="Fatura üzerindeki resmi unvan." />

      <Field
        label="Vergi / TC kimlik numarası"
        name="tax_id"
        error={errors.tax_id}
        inputMode="numeric"
        hint="Doğrulama için kullanılır, müşterilere gösterilmez."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Destek e-postası" name="support_email" type="email" error={errors.support_email} />
        <Field label="Destek telefonu" name="support_phone" error={errors.support_phone} />
      </div>

      <Field
        label="Web siteniz (isteğe bağlı)"
        name="website_url"
        error={errors.website_url}
        placeholder="https://"
      />

      <Field
        label="Mağaza tanıtımı"
        name="description"
        error={errors.description}
        multiline
        hint="Ürün gamınızı ve tedarik gücünüzü kısaca anlatın (en az 20 karakter)."
      />

      <button
        type="submit"
        className="w-full rounded-xl bg-gradient-to-r from-brand to-electric px-5 py-3 font-semibold text-white transition-transform hover:scale-[1.01]"
      >
        Başvuruyu gönder
      </button>

      <p className="text-center text-[11px] text-subtle">
        Göndererek satıcı sözleşmesini ve komisyon koşullarını kabul etmiş olursunuz.
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  hint,
  prefix,
  multiline = false,
  type = 'text',
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  prefix?: string;
  multiline?: boolean;
  type?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const base = `w-full bg-bg text-sm outline-none transition-colors placeholder:text-subtle ${
    prefix ? 'rounded-r-xl px-3 py-2.5' : 'rounded-xl px-3.5 py-2.5'
  }`;

  return (
    <div>
      <label htmlFor={name} className="text-xs font-medium text-muted">
        {label}
      </label>

      <div
        className={`mt-1.5 flex overflow-hidden rounded-xl border transition-colors focus-within:border-brand ${
          error ? 'border-danger' : 'border-line'
        }`}
      >
        {prefix && (
          <span className="shrink-0 bg-surface-2 px-3 py-2.5 font-mono text-xs text-subtle">
            {prefix}
          </span>
        )}

        {multiline ? (
          <textarea id={name} name={name} rows={4} className={base} />
        ) : (
          <input id={name} name={name} type={type} className={base} {...rest} />
        )}
      </div>

      {error ? (
        <p className="mt-1 text-[11px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
