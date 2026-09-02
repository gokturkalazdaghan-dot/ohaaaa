'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { Field } from '@/components/Field';

import { createAddress, type AddressResult } from './actions';

export function AddressForm() {
  const [state, formAction] = useActionState<AddressResult, FormData>(createAddress, {});
  const formRef = useRef<HTMLFormElement>(null);

  /*
   * Kaydedilen form TEMİZLENİR. Aksi hâlde dolu duran alanlar "kaydedilmedi
   * mi?" izlenimi verir ve kullanıcı aynı adresi ikinci kez ekler.
   */
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} className="card p-5">
      <h2 className="font-semibold text-fg">Yeni adres ekle</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label="Adres adı (isteğe bağlı)"
          name="label"
          placeholder="Ev, İş…"
          error={state.fieldErrors?.label}
        />
        <Field
          label="Ad Soyad"
          name="full_name"
          required
          autoComplete="name"
          error={state.fieldErrors?.full_name}
        />
        <Field
          label="Telefon"
          name="phone"
          required
          autoComplete="tel"
          placeholder="05XX XXX XX XX"
          error={state.fieldErrors?.phone}
        />
        <Field
          label="İl"
          name="city"
          required
          autoComplete="address-level1"
          error={state.fieldErrors?.city}
        />
        <Field
          label="İlçe"
          name="district"
          required
          autoComplete="address-level2"
          error={state.fieldErrors?.district}
        />
        <Field
          label="Posta kodu (isteğe bağlı)"
          name="postal_code"
          autoComplete="postal-code"
          error={state.fieldErrors?.postal_code}
        />
        <Field
          label="Açık adres"
          name="address_line"
          required
          multiline
          autoComplete="street-address"
          wrapperClassName="sm:col-span-2"
          error={state.fieldErrors?.address_line}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <SaveButton />
        <p aria-live="polite" className="text-sm">
          {state.error && <span className="text-danger">{state.error}</span>}
          {state.ok && <span className="text-success">Adres kaydedildi.</span>}
        </p>
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl press bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? 'Kaydediliyor…' : 'Adresi kaydet'}
    </button>
  );
}
