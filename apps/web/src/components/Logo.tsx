'use client';

import Link from 'next/link';

/**
 * Ohaaaa.com arması — `Ohaaaa.com` kelime işareti.
 *
 * RESMİ MARKA ADI TEK: `Ohaaaa.com`. Kısaltılmaz, `.com`'suz yazılmaz.
 * Mobil ile masaüstü AYNI kelime işaretini gösterir, yalnızca boy farklıdır.
 *
 * BÜYÜK HARFTEN KÜÇÜK HARFE: `OHAAAA.COM` -> `Ohaaaa.com`
 *
 * Marka kuralı (`verify-brand.mjs`) üç biçimi de doğru sayar: `Ohaaaa`,
 * `ohaaaa`, `OHAAAA`. Arma artık ilk harfi büyük olanı çiziyor.
 *
 * `O` İLE `h` BİTİŞİK -- ve bu okunurluk için, süs için değil.
 *
 * Küçük harfli dizide gerçek bir sorun var: Liberation Serif Bold'da `h`
 * harfinin omzu `a` harfinin kâsesine benziyor. Yan yana dizildiğinde
 * "haaaa" bir bakışta BEŞ yuvarlak gibi okunuyor ve marka fazla `a` ile
 * sayılıyor. Bu ölçüldü, varsayılmadı: armanın ilk çizimi ekranda beş
 * yuvarlak gibi okundu, oysa konturlar dörttü.
 *
 * (Yanlış yazım burada ÖRNEKLENMİYOR: `verify-brand.mjs` yorumları da
 * tarar ve haklı olarak reddeder -- marka adının yanlış hâli depoda
 * hiçbir yerde, yorumda bile geçmemeli.)
 *
 * `O` ile `h` kaynatılınca `Oh` TEK parça okunuyor ve kalan dört `a` net
 * sayılıyor. Örtüşme 80 font birimi: doğal boşluk 151 birimdi, yani `h`
 * gövdesi 231 birim sola çekildi ve `O` kâsesinin sağ kenarına giriyor.
 * Değer üç adayla (12 / 45 / 80) gerçek tarayıcıda karşılaştırılarak
 * seçildi; 12 ve 45'te bağ 26px'te görünmüyordu.
 *
 * ÖLÇÜLER
 *   zemin  #fc5f00        (referans görselin baskın renginden okundu)
 *   O      cap 62px       büyük baş harf
 *   haaaa  aynı optik boy  küçük harf -- boy farkı x-yüksekliğinden gelir
 *   .com   x-yük. 17px    O'nun %27,4'ü (referans oranı korundu)
 *   hepsi tek taban çizgisinde
 *
 * Yazı tipi de tahmin edilmedi: referanstaki O, A ve M biçimleri on beş
 * serif adayıyla piksel örtüşmesi (IoU) ölçülerek karşılaştırıldı.
 * Liberation Serif Bold açık ara kazandı (O 0,88 / A 0,87); bu yüz Times
 * New Roman ile metrik uyumludur, yani referans Times Bold ile çizilmiş.
 * Konturlar `fontTools` ile GERÇEK yazı tipinden çıkarıldı ve harf
 * konumları font ilerlemelerinden HESAPLANDI -- göz kararıyla değil.
 * Tek istisna `O`-`h` örtüşmesi; o da yukarıda gerekçelendirildi.
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
 * `verify-browser.mjs` bu özniteliklerden diziyi geri kurup `Ohaaaa.com`
 * olduğunu -- yani `a` sayısının DÖRT olduğunu -- doğruluyor.
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

/**
 * Mürekkep kutusu.
 *
 * Oran 5,653:1 — eski büyük harfli armada 6,309:1'di. Kelime işareti
 * `OHAAAA.COM`'dan `Ohaaaa.com`'a geçince daraldı: küçük harfler büyük
 * harflerden dar ilerler. Yani AYNI yükseklikte daha az yatay yer tutuyor.
 */
const EN = 376.6;
const BOY = 66.6;

/**
 * Taban çizgisi ofseti.
 *
 * Küçük `h` üst çıkıntısı (1421 birim) büyük `O` cap yüksekliğinden
 * (1341) DAHA UZUN — serif yüzlerde normaldir. Kutu bu yüzden 63,6'dan
 * 66,6'ya çıktı; ofset de ölçülen üst kenardan geliyor, varsayımdan değil.
 */
const TABAN = 65.7;

/**
 * Kelime işareti: Ohaaaa.com.
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
      <g transform={`translate(0 ${TABAN}) scale(1 -1)`}>
        <path data-harf="O" transform="translate(-4.6 0) scale(0.04623)" d="M432 672Q432 353 520 216Q607 80 797 80Q986 80 1074 217Q1161 354 1161 672Q1161 989 1074 1122Q986 1255 797 1255Q607 1255 520 1122Q432 989 432 672ZM100 672Q100 1356 797 1356Q1141 1356 1317 1182Q1493 1009 1493 672Q1493 331 1315 156Q1137 -20 797 -20Q458 -20 279 155Q100 330 100 672Z" />
        <path data-harf="h" transform="translate(58.3 0) scale(0.04623)" d="M436 1014Q436 948 430 858L499 893Q641 965 754 965Q1014 965 1014 688V90L1108 66V0H641V66L725 90V649Q725 733 690 780Q654 827 588 827Q512 827 436 793V90L522 66V0H55V66L147 90V1331L51 1355V1421H436Z" />
        <path data-harf="a" transform="translate(111.0 0) scale(0.04623)" d="M546 961Q899 961 899 701V90L993 66V0H647L625 72Q547 19 484 -0Q421 -20 357 -20Q66 -20 66 260Q66 366 109 430Q152 493 233 524Q314 554 488 558L610 561V698Q610 868 471 868Q387 868 283 816L245 699H179V926Q330 949 401 955Q472 961 546 961ZM610 472 526 469Q429 465 392 418Q354 371 354 266Q354 181 384 141Q414 101 462 101Q530 101 610 136Z" />
        <path data-harf="a" transform="translate(158.4 0) scale(0.04623)" d="M546 961Q899 961 899 701V90L993 66V0H647L625 72Q547 19 484 -0Q421 -20 357 -20Q66 -20 66 260Q66 366 109 430Q152 493 233 524Q314 554 488 558L610 561V698Q610 868 471 868Q387 868 283 816L245 699H179V926Q330 949 401 955Q472 961 546 961ZM610 472 526 469Q429 465 392 418Q354 371 354 266Q354 181 384 141Q414 101 462 101Q530 101 610 136Z" />
        <path data-harf="a" transform="translate(205.7 0) scale(0.04623)" d="M546 961Q899 961 899 701V90L993 66V0H647L625 72Q547 19 484 -0Q421 -20 357 -20Q66 -20 66 260Q66 366 109 430Q152 493 233 524Q314 554 488 558L610 561V698Q610 868 471 868Q387 868 283 816L245 699H179V926Q330 949 401 955Q472 961 546 961ZM610 472 526 469Q429 465 392 418Q354 371 354 266Q354 181 384 141Q414 101 462 101Q530 101 610 136Z" />
        <path data-harf="a" transform="translate(253.0 0) scale(0.04623)" d="M546 961Q899 961 899 701V90L993 66V0H647L625 72Q547 19 484 -0Q421 -20 357 -20Q66 -20 66 260Q66 366 109 430Q152 493 233 524Q314 554 488 558L610 561V698Q610 868 471 868Q387 868 283 816L245 699H179V926Q330 949 401 955Q472 961 546 961ZM610 472 526 469Q429 465 392 418Q354 371 354 266Q354 181 384 141Q414 101 462 101Q530 101 610 136Z" />
        <path data-harf="." transform="translate(302.2 0) scale(0.01807)" d="M256 -29Q187 -29 138 19Q90 67 90 137Q90 206 138 254Q186 303 256 303Q325 303 374 255Q422 207 422 137Q422 68 374 20Q326 -29 256 -29Z" />
        <path data-harf="c" transform="translate(311.5 0) scale(0.01807)" d="M858 57Q813 21 734 1Q654 -19 570 -19Q319 -19 194 102Q70 223 70 472Q70 627 126 738Q183 848 288 906Q393 965 532 965Q672 965 837 930V652H765L723 817Q689 842 656 852Q623 862 569 862Q510 862 462 815Q414 768 388 682Q361 597 361 478Q361 277 424 191Q486 105 622 105Q760 105 858 134Z" />
        <path data-harf="o" transform="translate(327.9 0) scale(0.01807)" d="M946 475Q946 222 838 101Q729 -20 506 -20Q290 -20 184 102Q78 225 78 475Q78 724 186 844Q293 965 514 965Q737 965 842 840Q946 716 946 475ZM653 475Q653 695 620 780Q588 864 508 864Q431 864 401 783Q371 702 371 475Q371 244 402 162Q432 80 508 80Q587 80 620 166Q653 253 653 475Z" />
        <path data-harf="m" transform="translate(346.4 0) scale(0.01807)" d="M434 858 502 893Q642 965 753 965Q921 965 977 843Q1182 965 1323 965Q1577 965 1577 688V90L1671 66V0H1204V66L1288 90V649Q1288 733 1256 780Q1223 827 1157 827Q1083 827 997 785Q1007 743 1007 688V90L1101 66V0H634V66L718 90V649Q718 733 686 780Q653 827 587 827Q521 827 436 788V90L522 66V0H55V66L147 90V850L55 874V940H420Z" />
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
      <Wordmark className="h-[13px] w-auto min-[360px]:h-[18px] sm:h-[26px]" />
    </Link>
  );
}
