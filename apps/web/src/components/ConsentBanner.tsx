'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { useConsent, writeConsent } from '@/lib/consent';

/**
 * Çerez onay şeridi.
 *
 * “Reddet” düğmesi “Kabul et” ile AYNI görünürlüktedir. Reddetmeyi zorlaştıran
 * tasarımlar (karanlık desen) hem etik değildir hem de mevzuata aykırıdır:
 * onay ancak özgür iradeyle verilmişse geçerlidir.
 */
export function ConsentBanner() {
  const consent = useConsent();

  // Karar bu sekmede verildikten sonra şerit kapanır. Onay durumu
  // localStorage'a da yazılır; `dismissed` yalnızca kapanışı anında
  // uygulamak içindir (aboneliğin dönmesini beklemeden).
  const [dismissed, setDismissed] = useState(false);

  // 'unknown' = henüz istemcide okunmadı. Şerit o anda GÖSTERİLMEZ: çoktan
  // karar vermiş ziyaretçi ilk boyamada şeridi bir an görmemeli.
  const visible = !dismissed && consent === 'unset';

  /*
   * Şerit `fixed` konumlandığı için sayfa akışından çıkar ve alt bilginin
   * son satırını örter. Sabit bir dolgu (padding) eklemek, şerit kapandıktan
   * sonra boşluk bırakırdı; bu yüzden dolgu yalnızca şerit GÖRÜNÜRKEN
   * uygulanır ve temizlik fonksiyonunda geri alınır.
   */
  useEffect(() => {
    if (!visible) return;

    const previous = document.body.style.paddingBottom;
    document.body.style.paddingBottom = '7.5rem';

    return () => {
      document.body.style.paddingBottom = previous;
    };
  }, [visible]);

  if (!visible) return null;

  function decide(state: 'granted' | 'denied') {
    writeConsent(state);
    setDismissed(true);
  }

  return (
    <div
      role="dialog"
      aria-label="Çerez tercihi"
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-line bg-bg-elevated/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:px-6">
        <p className="flex-1 text-sm leading-relaxed text-muted">
          Siteyi geliştirmek için ölçümleme çerezleri kullanmak istiyoruz. Sitenin
          çalışması için zorunlu olanlar dışında hiçbir çerez onayınız olmadan
          yüklenmez.{' '}
          <Link href="/gizlilik" className="text-brand-soft underline-offset-2 hover:underline">
            Ayrıntılar
          </Link>
        </p>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide('denied')}
            className="flex-1 rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold transition-colors hover:border-line-strong sm:flex-none"
          >
            Reddet
          </button>
          <button
            type="button"
            onClick={() => decide('granted')}
            className="flex-1 rounded-xl bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] sm:flex-none"
          >
            Kabul et
          </button>
        </div>
      </div>
    </div>
  );
}
