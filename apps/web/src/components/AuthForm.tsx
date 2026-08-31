'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { AlertIcon, CheckIcon } from './Icons';
import { signIn, signUp, type AuthResult } from '@/app/auth/actions';

/**
 * Giriş ve kayıt formu.
 *
 * `useActionState` ile sunucu eylemine bağlanır: JavaScript yüklenmeden önce
 * bile form gönderilebilir (aşamalı geliştirme). Yavaş bağlantıda ilk
 * saniyelerde form ölü kalmaz.
 */
export function AuthForm({ mode, next }: { mode: 'signin' | 'signup'; next?: string }) {
  const action = mode === 'signin' ? signIn : signUp;
  const [state, formAction] = useActionState<AuthResult, FormData>(action, {});

  if (state.pendingConfirmation) {
    return (
      <div className="card-glow p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success/12 text-success">
          <CheckIcon className="h-7 w-7" />
        </span>
        <h2 className="mt-4 text-lg font-bold">E-postanızı doğrulayın</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Adresinize bir doğrulama bağlantısı gönderdik. Bağlantıya tıkladıktan sonra
          giriş yapabilirsiniz.
        </p>
        <Link
          href="/giris"
          className="mt-5 inline-block rounded-xl border border-line px-4 py-2 text-sm font-medium transition-colors hover:border-brand/50"
        >
          Giriş sayfasına dön
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="card space-y-4 p-6">
      {next && <input type="hidden" name="next" value={next} />}

      {mode === 'signup' && (
        <Field label="Ad Soyad" name="fullName" autoComplete="name" required />
      )}

      <Field
        label="E-posta"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
      />

      <Field
        label="Parola"
        name="password"
        type="password"
        // Kayıtta yeni parola önerilsin, girişte kayıtlı parola doldurulsun.
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        required
        minLength={8}
        hint={mode === 'signup' ? 'En az 8 karakter' : undefined}
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

      <SubmitButton label={mode === 'signin' ? 'Giriş yap' : 'Hesap oluştur'} />
    </form>
  );
}

/**
 * Gönderim düğmesi ayrı bir bileşendir: `useFormStatus` yalnızca formun
 * ALTINDAKİ bir bileşenden okunabilir.
 */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl press bg-brand-cta px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'İşleniyor…' : label}
    </button>
  );
}

function Field({
  label,
  name,
  hint,
  type = 'text',
  ...rest
}: {
  label: string;
  name: string;
  hint?: string;
  type?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={name} className="text-xs font-medium text-muted">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-fg outline-none transition-colors focus:border-brand"
        {...rest}
      />
      {hint && <p className="mt-1 text-2xs text-subtle">{hint}</p>}
    </div>
  );
}
