import Link from 'next/link';

/**
 * Metin ağırlıklı sayfalar için ortak kabuk (hakkımızda, gizlilik, SSS…).
 *
 * Tipografi burada tek yerden yönetilir: `prose` benzeri bir eklenti yerine
 * doğrudan seçicilerle yazıldı, çünkü ihtiyaç duyulan kural sayısı azdır ve
 * tasarım tokenlarımızla (renk, kenarlık) uyumlu kalması gerekir.
 */
export function ContentPage({
  title,
  description,
  updatedAt,
  breadcrumb,
  children,
}: {
  title: string;
  description?: string;
  /** Son güncelleme tarihi — yasal metinlerde zorunludur. */
  updatedAt?: string;
  breadcrumb?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      {/* İç linkleme: her sayfa ana sayfaya geri bağlanır. */}
      <nav aria-label="Sayfa yolu" className="mb-6 flex items-center gap-2 text-xs text-muted">
        <Link href="/" className="transition-colors hover:text-fg">
          Ana sayfa
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-fg">{breadcrumb ?? title}</span>
      </nav>

      <header>
        <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">{title}</h1>

        {description && (
          <p className="mt-4 text-lg leading-relaxed text-muted">{description}</p>
        )}

        {updatedAt && (
          <p className="mt-4 text-xs text-subtle">
            Son güncelleme:{' '}
            <time dateTime={updatedAt}>
              {new Date(updatedAt).toLocaleDateString('tr-TR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </time>
          </p>
        )}
      </header>

      <div
        className={[
          'mt-10 space-y-6',
          '[&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight',
          '[&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold',
          '[&_p]:leading-relaxed [&_p]:text-muted',
          '[&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:text-muted [&_li]:list-disc [&_li]:leading-relaxed',
          '[&_ol]:space-y-2 [&_ol]:pl-5 [&_ol]:text-muted [&_ol>li]:list-decimal',
          /*
           * `.btn` MUAFTIR.
           *
           * Bu kural içerideki HER bağlantıyı markanın kırmızısına boyuyordu;
           * kırmızı zeminli bir indirme düğmesi konduğunda yazı zeminle aynı
           * renk olup görünmez oldu. Metin bağlantısı ile düğme farklı
           * şeylerdir; düğmeye `btn` sınıfı verildiğinde bu kural onu atlar.
           */
          '[&_a:not(.btn)]:text-brand-soft [&_a:not(.btn)]:underline-offset-2',
          'hover:[&_a:not(.btn)]:underline',
          '[&_strong]:font-semibold [&_strong]:text-fg',
          '[&_table]:w-full [&_table]:text-sm [&_th]:py-2 [&_th]:text-left [&_th]:font-medium',
          '[&_td]:border-t [&_td]:border-line [&_td]:py-2 [&_td]:align-top [&_td]:text-muted',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  );
}

/** Yasal metinlerde kullanılan uyarı kutusu. */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning';
  children: React.ReactNode;
}) {
  const classes =
    tone === 'warning'
      ? 'border-warning/25 bg-warning/8 text-warning'
      : 'border-brand/25 bg-brand/8 text-brand-soft';

  return (
    <div className={`rounded-xl border p-4 text-sm leading-relaxed ${classes}`}>{children}</div>
  );
}
