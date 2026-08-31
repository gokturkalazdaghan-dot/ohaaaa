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

import { useConsent } from '@/lib/consent';

export function Analytics({ measurementId }: { measurementId: string }) {
  // Abonelik `useConsent` içinde: bu sekmedeki karar da, başka sekmede geri
  // alınan onay da anında geçerli olur. Önceki hali `storage` dinleyicisini
  // temizlemiyordu; her yeniden bağlanışta bir dinleyici daha birikirdi.
  const allowed = useConsent() === 'granted';

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

/*
 * NOT — ORTAKLIK TIKLAMASI BURADA ÖLÇÜLMEZ.
 *
 * Burada `trackOutboundClick` adında, tıklamayı GA'ya `select_promotion`
 * olayı olarak bildiren bir işlev duruyordu. Hiçbir yerden çağrılmıyordu ve
 * yorumu "sitenin en değerli olayı" diyordu — yani okuyana, ölçümlemenin
 * buradan aktığını söyleyen YANLIŞ bir iz bırakıyordu.
 *
 * Tıklama gerçekte `GET /git/:offerId` içinde, `record_click` ile SUNUCUDA
 * kaydediliyor. Atıf için doğrusu da odur:
 *   • reklam engelleyiciler sunucu kaydını düşüremez,
 *   • kayıt `subid` taşır; dönüşümü tıklamaya bağlayan tek bağ odur,
 *   • para yolunun kaydı, ölçümleme onayına bağlı olamaz.
 *
 * GA'ya ikinci ve engellenebilir bir kopya göndermek atıfı iyileştirmezdi;
 * yalnızca iki kaynağın birbirini tutmadığı bir rapor üretirdi. Ayrıca
 * `select_promotion` bu iş için yanlış olaydı: GA4'te tanıtım
 * görsellerine aittir, ürün seçimine değil.
 */
