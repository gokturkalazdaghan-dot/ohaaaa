'use client';

import { useState } from 'react';
import { z } from 'zod';

import { CheckIcon } from './Icons';

/**
 * İletişim formu.
 *
 * Doğrulama istemcide yapılır ama gönderim sunucuda tekrar doğrulanmalıdır
 * (bkz. /api/iletisim). İstemci doğrulaması bir kolaylıktır, bir güvenlik
 * önlemi değildir.
 *
 * Spam koruması olarak görünmez bir alan (honeypot) kullanılır: CAPTCHA
 * eklemek her kullanıcıya bedel yüklerken, botların çoğunu bu basit yöntem
 * zaten eler.
 */
const contactSchema = z.object({
  name: z.string().min(2, 'Adınızı girin').max(120),
  email: z.string().email('Geçerli bir e-posta girin'),
  subject: z.enum(['duzeltme', 'satici', 'destek', 'kvkk', 'diger']),
  message: z.string().min(20, 'En az 20 karakter yazın').max(4000),
});

const SUBJECTS = [
  { value: 'duzeltme', label: 'Yanlış fiyat / ürün bildirimi' },
  { value: 'satici', label: 'Satıcı başvurusu' },
  { value: 'destek', label: 'Sipariş ve teslimat' },
  { value: 'kvkk', label: 'Kişisel veri talebi' },
  { value: 'diger', label: 'Diğer' },
] as const;

export function ContactForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const formData = new FormData(event.currentTarget);

    // Honeypot: gerçek kullanıcı bu alanı göremez, bot doldurur.
    if (formData.get('website')) {
      setStatus('sent'); // Bota başarı göster, hiçbir şey gönderme.
      return;
    }

    const parsed = contactSchema.safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
      subject: formData.get('subject'),
      message: formData.get('message'),
    });

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

    setStatus('sending');

    try {
      const response = await fetch('/api/iletisim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      setStatus(response.ok ? 'sent' : 'error');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <div className="card flex items-start gap-3 p-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
          <CheckIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="font-semibold text-fg">Mesajınız alındı</p>
          <p className="mt-1 text-sm text-muted">
            Konusuna göre 1–2 iş günü içinde dönüş yapacağız.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Adınız" name="name" error={errors.name} autoComplete="name" />
        <Field
          label="E-posta"
          name="email"
          type="email"
          error={errors.email}
          autoComplete="email"
        />
      </div>

      <div>
        <label htmlFor="subject" className="text-xs font-medium text-muted">
          Konu
        </label>
        <select
          id="subject"
          name="subject"
          defaultValue="duzeltme"
          className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-brand"
        >
          {SUBJECTS.map((subject) => (
            <option key={subject.value} value={subject.value}>
              {subject.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="message" className="text-xs font-medium text-muted">
          Mesajınız
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          placeholder="Yanlış fiyat bildiriyorsanız ürün bağlantısını eklemeyi unutmayın."
          className={`mt-1.5 w-full rounded-xl border bg-bg px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-subtle focus:border-brand ${
            errors.message ? 'border-danger' : 'border-line'
          }`}
        />
        {errors.message && (
          <p className="mt-1 text-[11px] text-danger" role="alert">
            {errors.message}
          </p>
        )}
      </div>

      {/* Honeypot — ekran okuyuculardan ve gözden gizli, DOM'da mevcut. */}
      <div aria-hidden="true" className="absolute left-[-9999px]">
        <label htmlFor="website">Bu alanı boş bırakın</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {status === 'error' && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          Mesaj gönderilemedi. Doğrudan{' '}
          <a href="mailto:destek@ohaaaa.com" className="underline">
            destek@ohaaaa.com
          </a>{' '}
          adresine yazabilirsiniz.
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-xl bg-gradient-to-r from-brand to-electric px-5 py-3 font-semibold text-white transition-transform hover:scale-[1.01] disabled:opacity-60"
      >
        {status === 'sending' ? 'Gönderiliyor…' : 'Gönder'}
      </button>

      <p className="text-center text-[11px] text-subtle">
        Gönderdiğiniz bilgiler yalnızca talebinizi yanıtlamak için kullanılır.
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  type = 'text',
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
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
        className={`mt-1.5 w-full rounded-xl border bg-bg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-brand ${
          error ? 'border-danger' : 'border-line'
        }`}
        {...rest}
      />
      {error && (
        <p className="mt-1 text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
