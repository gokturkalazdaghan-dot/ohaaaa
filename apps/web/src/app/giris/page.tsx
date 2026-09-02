import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { AuthForm } from '@/components/AuthForm';
import { Logo } from '@/components/Logo';

export const metadata: Metadata = {
  title: 'Giriş yap',
  description: 'Ohaaaa hesabınıza giriş yapın.',
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ devam?: string }>;
}) {
  const { devam } = await searchParams;

  /*
   * Alt başlık NEREDEN GELİNDİĞİNE göre yazılır.
   *
   * Sayfa "Satıcı panelinize erişmek için hesabınıza girin" diyordu ve bu,
   * giriş yapanların çoğu için yanlıştı: siparişini görmeye gelen bir alıcı,
   * yanlış kapıya geldiğini sanıp geri dönebilir. `devam`, kullanıcının
   * gitmek istediği yeri zaten taşıyor -- söylenecek doğru cümle orada.
   */
  const altyazi =
    devam?.startsWith('/tasoron') || devam?.startsWith('/yonetim')
      ? 'Satıcı panelinize erişmek için hesabınıza girin.'
      : devam === '/siparislerim'
        ? 'Siparişlerinizi görmek için hesabınıza girin.'
        : devam === '/adreslerim'
          ? 'Adres defterinize erişmek için hesabınıza girin.'
          : devam === '/degerlendirmelerim'
            ? 'Değerlendirme yazmak için hesabınıza girin.'
            : 'Hesabınıza girin.';

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="mb-8 flex justify-center">
        <Logo />
      </div>

      <h1 className="text-center text-2xl font-black tracking-tight">Giriş yap</h1>
      <p className="mt-2 text-center text-sm text-muted">{altyazi}</p>

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
