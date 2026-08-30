import Link from 'next/link';

/**
 * Başlık kilidi: arma + turuncu zemin üzerinde kelime işareti.
 *
 * ARMA BİR SİMGEDİR, OKUNACAK AD DEĞİL
 * Armanın İÇİNDEKİ "Ohaaaa" 36 pikselde okunmaz; o boyutta harfler birkaç
 * piksele düşer ve bulanık bir lekeye dönüşür. Bu yüzden arma tanınan bir
 * biçim ve renk olarak durur, adı yanındaki kelime işareti taşır.
 *
 * LEVHADA NE YAZAR
 * Marka adı + "kargo dahil fiyat". Arma 36 pikselde okunmadığı için (harfler
 * birkaç piksele düşer) adı yalnızca bu levha taşır; buradan da kaldırılırsa
 * marka adı başlıkta hiç görünmez. Alt satır ise siteyi ayıran tek şeyi
 * söyler: karşılaştırma kargo dahil toplam üzerinden yapılır.
 *
 * "En ucuz" gibi bir üstünlük iddiası BİLEREK kullanılmadı. Ticari Reklam ve
 * Haksız Ticari Uygulamalar Yönetmeliği bu tür iddiaları ispat yükümlülüğüne
 * bağlar; yalnızca anlaşmalı mağazalar karşılaştırıldığı için piyasanın en
 * ucuzu ispatlanamaz. "Kargo dahil fiyat" yöntem tarifidir, sonuç vaadi
 * değil — hem doğru hem savunulabilir.
 *
 * ZEMİN
 * Kelime işareti, armanın ARKASINDAN uzanan turuncu bir levhanın üzerinde
 * oturur. Levha sola taşar (negatif kenar boşluğu) ve arma onun üstünde
 * kalır (z-index); sağ ucu tam yuvarlak, böylece armanın dairesini
 * yankılar. Renk armanın kendi turuncusundan (#E9692A) markanın tuğla
 * kırmızısına (#C13515) gider — levha ayrı bir kutu değil, armanın
 * uzantısı gibi okunur.
 *
 * DOKUNMA ALANI
 * Bağlantının dokunma alanı 36 pikseldi; mobilde önerilen asgari 44'ün
 * altında. Dikey iç boşluk alanı büyütür, negatif dış boşluk başlığın
 * yüksekliğini değiştirmez: görünüm aynı kalır, hedef büyür.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group -my-2 flex items-center py-2 ${className}`}
      aria-label="Ohaaaa ana sayfa"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/ohaaaa-badge.png"
        alt=""
        width={36}
        height={36}
        className="relative z-10 h-9 w-9 shrink-0 transition-transform duration-200 group-hover:-rotate-6"
      />

      <span className="-ml-4 flex flex-col justify-center rounded-r-full bg-gradient-to-r from-[#E9692A] via-[#D4501F] to-[#C13515] py-1 pl-5 pr-4 text-[#fffaf5] shadow-sm transition-transform duration-200 origin-left group-hover:scale-x-[1.02]">
        <span className="text-xl font-extrabold leading-[1.05] tracking-tight">Ohaaaa</span>
        <span className="text-[9.5px] font-semibold uppercase leading-[1.2] tracking-[0.04em] opacity-90">
          kargo dahil fiyat
        </span>
      </span>
    </Link>
  );
}
