import Link from 'next/link';

import { SearchIcon } from '@/components/Icons';

/**
 * 404 sayfası.
 *
 * Ölü bir uca çıkmak yerine aramaya ve kategorilere yönlendirir: bir ürün
 * kaldırılmışsa kullanıcı büyük ihtimalle benzerini arıyordur.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-subtle">
        <SearchIcon className="h-7 w-7" />
      </span>

      <h1 className="mt-5 text-2xl font-black tracking-tight">Sayfa bulunamadı</h1>

      <p className="mt-3 leading-relaxed text-muted">
        Aradığınız ürün kaldırılmış ya da adres değişmiş olabilir. Arama yaparak
        benzerlerini bulabilirsiniz.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link
          href="/arama"
          className="rounded-xl bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
        >
          Ürün ara
        </Link>
        <Link
          href="/"
          className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-brand/45"
        >
          Ana sayfa
        </Link>
      </div>
    </div>
  );
}
