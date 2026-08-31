import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthForm } from '@/components/AuthForm';
import { Logo } from '@/components/Logo';

export const metadata: Metadata = {
  title: 'Kayıt ol',
  description: 'Ohaaaa hesabı oluşturun.',
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="mb-8 flex justify-center">
        <Logo />
      </div>

      <h1 className="text-center text-2xl font-black tracking-tight">Hesap oluştur</h1>
      <p className="mt-2 text-center text-sm text-muted">
        Satıcı başvurusu yapmak ve panelinizi yönetmek için.
      </p>

      <div className="mt-8">
        <AuthForm mode="signup" />
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Zaten hesabınız var mı?{' '}
        <Link href="/giris" className="font-medium text-brand-soft hover:underline">
          Giriş yapın
        </Link>
      </p>

      <p className="mt-4 text-center text-2xs leading-relaxed text-subtle">
        Kayıt olarak <Link href="/kosullar" className="underline underline-offset-2">
          kullanım şartlarını
        </Link>{' '}
        ve{' '}
        <Link href="/gizlilik" className="underline underline-offset-2">
          gizlilik politikasını
        </Link>{' '}
        kabul etmiş olursunuz.
      </p>
    </div>
  );
}
