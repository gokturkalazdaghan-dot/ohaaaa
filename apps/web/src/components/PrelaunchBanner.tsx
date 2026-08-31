import { AlertIcon } from './Icons';

/**
 * Yayın öncesi uyarı şeridi.
 *
 * Gizlenebilir DEĞİLDİR ve her sayfada görünür. Sebep: bu şeridin varlığı,
 * `NEXT_PUBLIC_LAUNCH_STATE` değerinin hâlâ `prelaunch` olduğunun tek görünür
 * işaretidir. Kapatılabilir olsaydı, canlıya geçtiğinizi sanıp haftalarca
 * indekslenmeyen bir siteyle yaşayabilirdiniz.
 */
export function PrelaunchBanner() {
  return (
    <aside aria-label="Yayın durumu uyarısı" className="border-b border-brand/25 bg-brand/10">
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-2 text-xs text-brand-soft sm:items-center sm:px-6">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
        <p>
          <strong className="font-semibold">Yayın öncesi.</strong> Site arama
          motorlarına kapalı (<code className="font-mono">noindex</code> +{' '}
          <code className="font-mono">robots.txt</code>). İşletme kaydı tamamlanıp
          yasal metinler doldurulduktan sonra{' '}
          <code className="font-mono">NEXT_PUBLIC_LAUNCH_STATE=live</code> ile açılır.
        </p>
      </div>
    </aside>
  );
}
