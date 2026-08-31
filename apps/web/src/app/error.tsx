'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { AlertIcon } from '@/components/Icons';

/**
 * Genel hata sınırı.
 *
 * NEDEN VAR: Bir Server Component hata fırlattığında (ör. veritabanı
 * erişilemez) Next varsayılan olarak ham bir 500 sayfası gösterir — üst bar,
 * gezinme ve marka olmadan. Fiyat karşılaştırma sitesinde en çok ziyaret
 * edilen sayfa ürün sayfasıdır; oradaki bir kesintide kullanıcının elinde
 * hiçbir şey kalmamalıdır demek yanlıştır.
 *
 * KRİTİK KARAR: Burada ÖRNEK VERİYE DÜŞÜLMEZ. Veritabanı erişilemezken
 * demo fiyat göstermek, kullanıcıya gerçek olmayan bir fiyat söylemek olur —
 * bu, sayfayı hiç gösterememekten çok daha zararlıdır.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Hata sunucu günlüğünde zaten var; buradaki kayıt istemci tarafındaki
    // bağlamı (hangi sayfa, hangi tarayıcı) ekler.
    console.error('Sayfa hatası:', error.message, error.digest);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-warning/12 text-warning">
        <AlertIcon className="h-7 w-7" />
      </span>

      <h1 className="mt-5 text-2xl font-black tracking-tight">
        Bu sayfayı şu an gösteremiyoruz
      </h1>

      <p className="mt-3 leading-relaxed text-muted">
        Fiyat verilerine geçici olarak ulaşamıyoruz. Size eski veya yanlış bir fiyat
        göstermektense hiç göstermemeyi tercih ediyoruz.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
        >
          Tekrar dene
        </button>
        <Link
          href="/"
          className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-brand/45"
        >
          Ana sayfaya dön
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 font-mono text-[11px] text-subtle">
          Destek kodu: {error.digest}
        </p>
      )}
    </div>
  );
}
