'use client';

/**
 * KÖK YERLEŞİMİN KENDİ HATA SINIRI.
 *
 * NEDEN AYRI BİR DOSYA GEREKİYOR
 * `app/error.tsx` yalnızca kök yerleşimin İÇİNDEKİ hataları yakalar. Hata
 * yerleşimin kendisinde çıkarsa (`layout.tsx` içindeki `getRequestLocale()`
 * ya da `headers()` çağrısı düşerse) o sınır hiç devreye giremez, çünkü
 * sınırı barındıran ağaç henüz kurulmamıştır. O durumda Next kendi ham
 * hata sayfasını gösterir: marka yok, dil yok, kullanıcıya verilmiş bir
 * yön yok.
 *
 * `global-error.tsx` ağacın en üstünde durur ve KENDİ `<html>` ile
 * `<body>` etiketlerini yazmak ZORUNDADIR -- çünkü devreye girdiğinde
 * yerleşimin ürettiği belge yoktur.
 *
 * `lang="tr"` BURADA SABİT, ve bu bilinçli: dili çözen kodun kendisi
 * düşmüş olabilir. Çözülemeyen bir dili uydurmaktansa sitenin ana dilini
 * yazmak doğrudur.
 *
 * SIZINTI YOK: kullanıcıya yalnızca `digest` (özet kodu) gösterilir.
 * `error.message` içinde bağlantı dizesi, sorgu parçası ya da iç yol adı
 * bulunabilir; onu tarayıcıya yazmak, arızayı saldırganın haritasına
 * çevirmek olurdu. Mesaj sunucu günlüğünde kalır.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0b0f',
          color: '#f4f4f5',
          /*
           * Sistem yazı tipi yığını: bu sayfa, uygulamanın yazı tipleri
           * yüklenemediğinde de çizilmek zorunda.
           */
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <main style={{ maxWidth: '32rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
            Bir şeyler ters gitti
          </h1>
          <p style={{ margin: '0 0 1.5rem', lineHeight: 1.6, opacity: 0.8 }}>
            Sayfa şu anda açılamıyor. Sorun bizde; birazdan tekrar deneyin.
          </p>

          {/*
            Yenileme `reset()` ile değil, tam sayfa yüklemesiyle: hata kök
            yerleşimde olduğu için React ağacını yeniden denemek aynı
            hatayı tekrar üretir. Belgeyi baştan istemek, sunucunun
            iyileşmiş olma ihtimalini kullanır.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
              `next/link` BİLEREK kullanılmıyor: istemci-içi gezinme aynı
              (bozuk) React ağacını yeniden kurar ve hata tekrarlanır. Tam
              belge yüklemesi, sunucunun iyileşmiş olma ihtimalini kullanan
              tek seçenek. */}
          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              borderRadius: '9999px',
              background: '#f4f4f5',
              color: '#0b0b0f',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Ana sayfaya dön
          </a>

          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', opacity: 0.55 }}>
              Destek kodu: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
