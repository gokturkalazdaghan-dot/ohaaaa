import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { AuthForm } from '@/components/AuthForm';
import { Logo } from '@/components/Logo';

export const metadata: Metadata = {
  title: 'Giriş yap',
  description: 'Ohaaaa satıcı paneline giriş yapın.',
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ devam?: string }>;
}) {
  const { devam } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="mb-8 flex justify-center">
        <Logo />
      </div>

      <h1 className="text-center text-2xl font-black tracking-tight">Giriş yap</h1>
      <p className="mt-2 text-center text-sm text-muted">
        Satıcı panelinize erişmek için hesabınıza girin.
      </p>

      <div className="mt-8">
        <Suspense fallback={<div className="h-72 rounded-2xl skeleton" />}>
          <AuthForm mode="signin" next={devam} />
        </Suspense>
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Hesabınız yok mu?{' '}
        <Link href="/kayit" className="font-medium text-brand-soft hover:underline">
          Kayıt olun
        </Link>
      </p>

      <p className="mt-2 text-center text-xs text-subtle">
        Satıcı olmak istiyorsanız önce{' '}
        <Link href="/tasoron/basvuru" className="underline underline-offset-2">
          başvuru formunu
        </Link>{' '}
        doldurun.
      </p>
    </div>
  );
}
