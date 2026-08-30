import Link from 'next/link';

/**
 * Başlık kilidi: arma + turuncu zemin üzerinde kelime işareti.
 *
 * ARMA BİR SİMGEDİR, OKUNACAK AD DEĞİL
 * Armanın İÇİNDEKİ "Ohaaaa" 36 pikselde okunmaz; o boyutta harfler birkaç
 * piksele düşer ve bulanık bir lekeye dönüşür. Bu yüzden arma tanınan bir
 * biçim ve renk olarak durur, adı yanındaki kelime işareti taşır.
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

      <span
        className="-ml-4 rounded-r-full bg-gradient-to-r from-[#E9692A] via-[#D4501F] to-[#C13515] py-1 pl-5 pr-4 text-xl font-extrabold leading-tight tracking-tight text-[#fffaf5] shadow-sm transition-transform duration-200 origin-left group-hover:scale-x-[1.03]"
      >
        Ohaaaa
      </span>
    </Link>
  );
}
