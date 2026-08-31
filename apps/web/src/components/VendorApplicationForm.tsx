'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { AlertIcon, CheckIcon } from './Icons';
import { submitApplication, type ApplicationResult } from '@/app/tasoron/basvuru/actions';

/**
 * Taşeron başvuru formu.
 *
 * Doğrulama, backend'in kullandığı ŞEMANIN AYNISIYLA yapılır
 * (@ohaaaa/shared → vendorApplicationSchema). Böylece istemcide geçen bir
 * girdi sunucuda reddedilmez; kural tek yerde yaşar.
 */
export function VendorApplicationForm() {
  const [state, formAction] = useActionState<ApplicationResult, FormData>(
    submitApplication,
    {},
  );

  const [slugTouched, setSlugTouched] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');

  const errors = state.fieldErrors ?? {};

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

  /*
   * Doğrulama artık SUNUCUDA yapılıyor (aynı zod şemasıyla). İstemci
   * doğrulaması bir kolaylıktır, güvenlik önlemi değildir — form curl ile
   * de gönderilebilir. Tek kaynakta tutmak, ikisinin ayrışmasını önler.
   */

  if (state.needsAuth) {
    return (
      <div className="card mt-8 p-6 text-center">
        <h2 className="text-lg font-bold">Önce hesap oluşturun</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Başvurunuzu size bağlayabilmemiz ve panelinize erişebilmeniz için bir
          hesaba ihtiyacımız var. Kayıt 30 saniye sürer.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link
            href="/kayit"
            className="rounded-xl press bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white"
          >
            Hesap oluştur
          </Link>
          <Link
            href="/giris?devam=/tasoron/basvuru"
            className="rounded-xl border border-line px-5 py-2.5 text-sm font-medium transition-colors hover:border-brand/50"
          >
            Giriş yap
          </Link>
        </div>
      </div>
    );
  }

  if (state.ok) {
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
          className="mt-6 inline-block rounded-xl press bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white"
        >
          Paneli incele
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="card mt-8 space-y-5 p-6" noValidate>
      <Field
        label="Mağaza adı"
        name="display_name"
        required
        value={displayName}
        onChange={(event) => onDisplayNameChange(event.target.value)}
        error={errors.display_name}
        hint="Müşterilerin göreceği isim."
      />

      <Field
        label="Mağaza adresi"
        name="slug"
        required
        value={slug}
        onChange={(event) => {
          setSlugTouched(true);
          setSlug(event.target.value);
        }}
        error={errors.slug}
        prefix="ohaaaa.com/magaza/"
      />

      <Field
        label="Ticari unvan"
        name="legal_name"
        required
        error={errors.legal_name}
        hint="Fatura üzerindeki resmi unvan."
      />

      <Field
        label="Vergi / TC kimlik numarası"
        name="tax_id"
        required
        error={errors.tax_id}
        inputMode="numeric"
        hint="Doğrulama için kullanılır, müşterilere gösterilmez."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Destek e-postası"
          name="support_email"
          type="email"
          required
          error={errors.support_email}
        />
        {/* Şemada isteğe bağlı; etiketi de öyle demeli. Web sitesi alanı
            zaten "(isteğe bağlı)" diyordu, telefon atlanmıştı. */}
        <Field
          label="Destek telefonu (isteğe bağlı)"
          name="support_phone"
          error={errors.support_phone}
        />
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
        required
        error={errors.description}
        multiline
        hint="Ürün gamınızı ve tedarik gücünüzü kısaca anlatın (en az 20 karakter)."
      />

      {state.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </p>
      )}

      <SubmitButton />

      <p className="text-center text-2xs text-subtle">
        Göndererek satıcı sözleşmesini ve komisyon koşullarını kabul etmiş olursunuz.
      </p>
    </form>
  );
}

/** `useFormStatus` yalnızca formun ALTINDAKİ bir bileşenden okunabilir. */
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl press bg-brand-cta px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Gönderiliyor…' : 'Başvuruyu gönder'}
    </button>
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
  required = false,
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  prefix?: string;
  multiline?: boolean;
  type?: string;
  required?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const base = `w-full bg-bg text-sm outline-none transition-colors placeholder:text-subtle ${
    prefix ? 'rounded-r-xl px-3 py-2.5' : 'rounded-xl px-3.5 py-2.5'
  }`;

  /*
   * HATA VE İPUCU METNİ ALANA BAĞLANIR.
   *
   * Önceden bağlanmıyordu. Sonuçları:
   *   • Hata yalnızca KIRMIZI KENARLIKLA anlatılıyordu. Rengi ayırt
   *     edemeyen bir kullanıcı için alan sağlamdan farksızdı (WCAG 1.4.1
   *     ve 3.3.1).
   *   • `role="alert"` metni belirdiği anda BİR KEZ okunur. Kullanıcı
   *     sonradan alana geri sekerse hatayı bir daha duymaz.
   *   • İpucu metni ("Fatura üzerindeki resmi unvan") ekran okuyucuya HİÇ
   *     ulaşmıyordu; gözle görülüp kulakla duyulmayan bir yardım metniydi.
   *
   * `aria-describedby` ikisini de alana bağlar, `aria-invalid` durumu
   * renkten bağımsız olarak bildirir.
   */
  const errorId = `${name}-hata`;
  const hintId = `${name}-ipucu`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  /*
   * Zorunluluk, sunucudaki zod şemasıyla aynı olmalı. İşaretlenmediğinde
   * kullanıcı boş formu gönderip sunucudan dönmesini bekliyordu; ekran
   * okuyucu kullanıcısı ise hangi alanın zorunlu olduğunu gönderene kadar
   * hiç öğrenemiyordu.
   */
  const shared = {
    id: name,
    name,
    required,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy,
    className: base,
  };

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
          /* `...rest` buraya da geçiriliyor. Önceden yalnızca `<input>`
             dalına geçiyordu; çok satırlı bir alana verilen HİÇBİR öznitelik
             (değer, olay, uzunluk sınırı) uygulanmıyor, sessizce
             yutuluyordu. */
          <textarea
            {...shared}
            rows={4}
            {...(rest as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        ) : (
          <input {...shared} type={type} {...rest} />
        )}
      </div>

      {error ? (
        <p id={errorId} className="mt-1 text-2xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-2xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
