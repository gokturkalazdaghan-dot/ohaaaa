'use client';

import Link from 'next/link';

/**
 * Ohaaaa.com arması — OHAAAA.COM kelime işareti.
 *
 * RESMİ MARKA ADI TEK: `Ohaaaa.com`. Kısaltılmaz, `.com`'suz yazılmaz.
 * Eskiden dar ekranda `OHA` monogramı çiziliyordu; o kısaltma kaldırıldı.
 * Mobil ile masaüstü AYNI kelime işaretini gösterir, yalnızca boy farklıdır.
 *
 * ONAYLANAN TASARIM ve NEREDEN GELDİĞİ
 *
 * Referans görsel ölçülerek çözümlendi, göz kararıyla taklit edilmedi:
 *   zemin  #fc5f00        (görselin baskın renginden okundu)
 *   O      cap 62px       büyütülmüş baş harf
 *   HAAAA  cap 47px       küçük kapiteller — O'nun %75,8'i
 *   .COM   cap 17px       O'nun %27,4'ü
 *   hepsi tek taban çizgisinde, ek harf aralığı YOK
 *
 * Yazı tipi de tahmin edilmedi: referanstaki O, A ve M biçimleri on beş
 * serif adayıyla piksel örtüşmesi (IoU) ölçülerek karşılaştırıldı.
 * Liberation Serif Bold açık ara kazandı (O 0,88 / A 0,87); bu yüz Times
 * New Roman ile metrik uyumludur, yani referans Times Bold ile çizilmiş.
 * Doğrulama: harfler VARSAYILAN ilerlemelerle dizildiğinde üretilen
 * mürekkep genişliği 401 birim, referansta 402 px — tracking sıfır.
 *
 * NEDEN CANLI METİN DEĞİL, KONTUR
 * Uygulama Outfit ve Plus Jakarta Sans yüklüyor; serif bir aile YOK. On
 * harf için üçüncü bir yazı tipi ailesi indirmek pahalı. Konturlar 3,3 KB
 * ve satır içi gömülü: ek ağ isteği yok, FOUT yok ve arma HER platformda
 * birebir aynı çiziliyor — sistem serifine bırakılsa Windows, Android ve
 * Linux'ta üç farklı arma çıkardı.
 *
 * Her yol `data-harf` taşıyor. Sebep: kontura çevrilen yazı DOM'da metin
 * bırakmaz, yani `verify-brand.mjs` de `textContent` de A sayısını göremez.
 * `verify-browser.mjs` bu özniteliklerden diziyi geri kurup `OHAAAA.COM`
 * olduğunu doğruluyor.
 *
 * Yazı tipi lisansı: Liberation Serif, SIL OFL 1.1. Konturların işarete
 * gömülmesi lisans kapsamında serbesttir.
 */

/**
 * Arma zemini.
 *
 * `--brand-cta` (#b84f14) DEĞİL: o düğme dolgusu için seçilmiş ayrı bir
 * işlevsel token ve beyaza karşı 5,04:1 veriyor. Arma rengi referanstan
 * geliyor ve beyaza karşı 3,10:1. Bu değer normal metin için WCAG AA
 * eşiğinin (4,5:1) altında; WCAG 1.4.3 logo ve marka adını bu kuraldan
 * MUAF tutuyor, ama muafiyet yalnızca armaya ait. Bu yüzden renk global
 * token katmanına konmadı: buradan başka bir yere sızarsa gerçek bir
 * erişilebilirlik ihlali olur.
 */
const ARMA_ZEMIN = '#fc5f00';

/** Mürekkep kutusu — referanstan ölçülen orana eşit (6,309:1). */
const EN = 401.4;
const BOY = 63.6;

/**
 * Kelime işareti: OHAAAA.COM.
 *
 * `aria-hidden`: erişilebilir ad çağıran taraftaki bağlantıda. Ekran
 * okuyucunun harfleri tek tek okuması ("O, H, A, A, A, A...") istenmiyor.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${EN} ${BOY}`}
      className={className}
      fill="currentColor"
    >
      {/* Yazı tipi y ekseni yukarı, SVG'ninki aşağı: tek seferde çevriliyor. */}
      <g transform={`translate(0 62.7) scale(1 -1)`}>
        <path data-harf="O" transform="translate(-4.6 0) scale(0.04623)" d="M432.0 672.0Q432.0 353.0 519.5 216.5Q607.0 80.0 797.0 80.0Q986.0 80.0 1073.5 217.0Q1161.0 354.0 1161.0 672.0Q1161.0 989.0 1073.5 1122.0Q986.0 1255.0 797.0 1255.0Q607.0 1255.0 519.5 1122.0Q432.0 989.0 432.0 672.0ZM100.0 672.0Q100.0 1356.0 797.0 1356.0Q1141.0 1356.0 1317.0 1182.5Q1493.0 1009.0 1493.0 672.0Q1493.0 331.0 1315.0 155.5Q1137.0 -20.0 797.0 -20.0Q458.0 -20.0 279.0 155.0Q100.0 330.0 100.0 672.0Z" />
        <path data-harf="H" transform="translate(69.0 0) scale(0.03505)" d="M35.0 0.0V74.0L207.0 100.0V1241.0L35.0 1268.0V1341.0H694.0V1268.0L522.0 1241.0V745.0H1070.0V1241.0L898.0 1268.0V1341.0H1559.0V1268.0L1386.0 1241.0V100.0L1559.0 74.0V0.0H898.0V74.0L1070.0 100.0V635.0H522.0V100.0L694.0 74.0V0.0Z" />
        <path data-harf="A" transform="translate(124.9 0) scale(0.03505)" d="M428.0 73.0V0.0H20.0V73.0L120.0 100.0L597.0 1352.0H887.0L1362.0 100.0L1464.0 73.0V0.0H867.0V73.0L1022.0 100.0L894.0 447.0H379.0L256.0 100.0ZM641.0 1150.0 420.0 557.0H856.0Z" />
        <path data-harf="A" transform="translate(176.7 0) scale(0.03505)" d="M428.0 73.0V0.0H20.0V73.0L120.0 100.0L597.0 1352.0H887.0L1362.0 100.0L1464.0 73.0V0.0H867.0V73.0L1022.0 100.0L894.0 447.0H379.0L256.0 100.0ZM641.0 1150.0 420.0 557.0H856.0Z" />
        <path data-harf="A" transform="translate(228.5 0) scale(0.03505)" d="M428.0 73.0V0.0H20.0V73.0L120.0 100.0L597.0 1352.0H887.0L1362.0 100.0L1464.0 73.0V0.0H867.0V73.0L1022.0 100.0L894.0 447.0H379.0L256.0 100.0ZM641.0 1150.0 420.0 557.0H856.0Z" />
        <path data-harf="A" transform="translate(280.4 0) scale(0.03505)" d="M428.0 73.0V0.0H20.0V73.0L120.0 100.0L597.0 1352.0H887.0L1362.0 100.0L1464.0 73.0V0.0H867.0V73.0L1022.0 100.0L894.0 447.0H379.0L256.0 100.0ZM641.0 1150.0 420.0 557.0H856.0Z" />
        <path data-harf="." transform="translate(332.2 0) scale(0.01268)" d="M256.0 -29.0Q187.0 -29.0 138.5 19.0Q90.0 67.0 90.0 137.0Q90.0 206.0 138.0 254.5Q186.0 303.0 256.0 303.0Q325.0 303.0 373.5 255.0Q422.0 207.0 422.0 137.0Q422.0 68.0 374.0 19.5Q326.0 -29.0 256.0 -29.0Z" />
        <path data-harf="C" transform="translate(338.7 0) scale(0.01268)" d="M815.0 -20.0Q478.0 -20.0 289.0 159.0Q100.0 338.0 100.0 655.0Q100.0 999.0 280.5 1177.5Q461.0 1356.0 814.0 1356.0Q1047.0 1356.0 1297.0 1289.0L1303.0 967.0H1213.0L1185.0 1161.0Q1053.0 1251.0 878.0 1251.0Q646.0 1251.0 539.0 1106.5Q432.0 962.0 432.0 658.0Q432.0 377.0 544.0 230.0Q656.0 83.0 870.0 83.0Q983.0 83.0 1067.5 113.0Q1152.0 143.0 1200.0 184.0L1232.0 404.0H1323.0L1317.0 64.0Q1227.0 29.0 1083.0 4.5Q939.0 -20.0 815.0 -20.0Z" />
        <path data-harf="O" transform="translate(357.4 0) scale(0.01268)" d="M432.0 672.0Q432.0 353.0 519.5 216.5Q607.0 80.0 797.0 80.0Q986.0 80.0 1073.5 217.0Q1161.0 354.0 1161.0 672.0Q1161.0 989.0 1073.5 1122.0Q986.0 1255.0 797.0 1255.0Q607.0 1255.0 519.5 1122.0Q432.0 989.0 432.0 672.0ZM100.0 672.0Q100.0 1356.0 797.0 1356.0Q1141.0 1356.0 1317.0 1182.5Q1493.0 1009.0 1493.0 672.0Q1493.0 331.0 1315.0 155.5Q1137.0 -20.0 797.0 -20.0Q458.0 -20.0 279.0 155.0Q100.0 330.0 100.0 672.0Z" />
        <path data-harf="M" transform="translate(377.6 0) scale(0.01268)" d="M882.0 0.0H827.0L332.0 1133.0V100.0L512.0 73.0V0.0H35.0V73.0L207.0 100.0V1242.0L35.0 1268.0V1341.0H562.0L945.0 459.0L1336.0 1341.0H1874.0V1268.0L1702.0 1242.0V100.0L1874.0 73.0V0.0H1207.0V73.0L1387.0 100.0V1133.0Z" />
      </g>
    </svg>
  );
}

/**
 * Başlıktaki arma kilidi.
 *
 * BOYLAR ÖLÇÜLEREK SEÇİLDİ. Kısıt YATAY: dar ekranda üst satırda arma ile
 * birlikte hesap, favori ve (pazar yeri modunda) sepet düğmeleri var.
 * Başlık satırının yüksekliğini arama kutusu belirliyor, arma değil --
 * yani armayı büyütmek satırı büyütmüyor, bedava. Gerçek tarayıcıda her
 * genişlikte taşmasız en büyük ink boyu ölçüldü:
 *
 *   320px -> en fazla 14px   (seçilen 14, sınırda; taşmayı test koruyor)
 *   360px -> en fazla 22px   (seçilen 20, 2px pay)
 *   390px -> en fazla 26px
 *   640px+-> en fazla 32px   (seçilen 30, 2px pay)
 *
 * Arma dar ekranda küçülür ama KISALMAZ: marka adı her ekranda tam.
 *
 * `.COM` OKUNURLUĞU -- BİLİNEN SINIR
 * Referans tasarımda `.COM`, O'nun %27,4'ü. Bu oran 512px'lik bir uygulama
 * ikonunda dengeli ama başlık ölçeğinde `.COM` cap yüksekliği 30px inkte
 * 8,2px'e, 320px telefonda 3,8px'e düşüyor. Yani dar ekranda `.COM` metin
 * gibi değil doku gibi okunuyor. Bu tasarımın kendi oranından gelen bir
 * sonuç, uygulama hatası değil. Marka adının tamamı erişilebilir adda
 * (`aria-label`) her ölçekte eksiksiz duruyor.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Ohaaaa.com ana sayfa"
      className={`inline-flex shrink-0 items-center rounded-lg px-2.5 py-2 text-white transition-opacity hover:opacity-90 sm:px-3 ${className}`}
      style={{ backgroundColor: ARMA_ZEMIN }}
    >
      <Wordmark className="h-[14px] w-auto min-[360px]:h-5 sm:h-[30px]" />
    </Link>
  );
}
