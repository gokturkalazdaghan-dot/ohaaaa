import Link from 'next/link';

/**
 * Başlık kilidi: arma + turuncu zemin üzerinde kelime işareti.
 *
 * ADI ARMA TAŞIR, LEVHA VAADİ
 * Arma yeniden çizildi: yazı yatay, çember inceldi, segment halkası kalktı,
 * harflerdeki 3B pah gitti. Bu üç değişiklikle "Ohaaaa" 32 pikselde okunur
 * hale geldi (önce 64 pikselden önce okunmuyordu).
 *
 * Ad artık armada okunduğu için levhada tekrar etmesi gereksiz. Levha
 * müşteriye dönük olanı taşıyor: karşılaştırmanın kargo dahil toplam
 * üzerinden yapılması — siteyi ayıran tek şey.
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

      <span className="-ml-4 rounded-r-full bg-gradient-to-r from-[#E9692A] via-[#D4501F] to-[#C13515] py-[7px] pl-5 pr-4 text-[15px] font-extrabold leading-none tracking-tight text-[#fffaf5] shadow-sm transition-transform duration-200 origin-left group-hover:scale-x-[1.02]">
        kargo dahil fiyat
      </span>
    </Link>
  );
}
