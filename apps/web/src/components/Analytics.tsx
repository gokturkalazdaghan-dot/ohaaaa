'use client';

/**
 * Google Analytics (madde 18) — KVKK uyumlu, onaya bağlı.
 *
 * TASARIM KARARI: Betik, kullanıcı çerezlere onay verene kadar YÜKLENMEZ.
 * "Önce yükle, sonra sor" yaklaşımı yaygın ama hatalıdır: onay alınmadan
 * yapılan ölçümleme KVKK ve ePrivacy açısından ihlaldir ve para cezasına
 * konu olur.
 *
 * Onay verilmemişse hiçbir üçüncü taraf isteği yapılmaz — bu aynı zamanda
 * sayfanın ilk yüklenmesini de hızlandırır.
 */

import Script from 'next/script';
import { useEffect, useState } from 'react';

import { CONSENT_STORAGE_KEY, readConsent } from '@/lib/consent';

export function Analytics({ measurementId }: { measurementId: string }) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(readConsent() === 'granted');

    // Onay kutusundan gelen değişikliği dinle: kullanıcı onay verdiğinde
    // sayfa yenilenmeden ölçümleme başlasın.
    function onConsentChange() {
      setAllowed(readConsent() === 'granted');
    }

    window.addEventListener('ohaaaa:consent', onConsentChange);
    // Başka bir sekmede geri alınan onay burada da geçerli olmalı.
    window.addEventListener('storage', (event) => {
      if (event.key === CONSENT_STORAGE_KEY) onConsentChange();
    });

    return () => window.removeEventListener('ohaaaa:consent', onConsentChange);
  }, []);

  if (!allowed || !measurementId) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());

          // IP anonimleştirme ve reklam sinyallerinin kapatılması:
          // ölçümleme için gereken en az veriyle çalışıyoruz.
          gtag('config', '${measurementId}', {
            anonymize_ip: true,
            allow_google_signals: false,
            allow_ad_personalization_signals: false
          });
        `}
      </Script>
    </>
  );
}

/**
 * Ortaklık tıklamasını ölçümlemeye bildirir.
 *
 * Bu, sitenin en değerli olayıdır: hangi ürün ve hangi yerleşimin gerçekten
 * tıklandığını gösterir. Onay yoksa sessizce hiçbir şey yapmaz.
 */
export function trackOutboundClick(input: {
  offerId: string;
  merchantName: string;
  priceCents: number;
  placement: string;
}): void {
  if (typeof window === 'undefined') return;
  if (readConsent() !== 'granted') return;

  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;

  gtag('event', 'select_promotion', {
    promotion_id: input.offerId,
    promotion_name: input.merchantName,
    creative_slot: input.placement,
    value: input.priceCents / 100,
    currency: 'TRY',
  });
}
