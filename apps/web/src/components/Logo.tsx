import Link from 'next/link';

/**
 * Başlık kilidi: arma + kelime işareti + marka şeridi.
 *
 * ARMA BİR SİMGEDİR, OKUNACAK AD DEĞİL
 * Armanın İÇİNDEKİ "Ohaaaa" 36 pikselde okunmaz; o boyutta harfler birkaç
 * piksele düşer ve bulanık bir lekeye dönüşür. Bu yüzden arma burada tanınan
 * bir biçim ve renk olarak durur, adı yanındaki kelime işareti taşır.
 * İkisi aynı işi yapmaya çalışmaz.
 *
 * ŞERİT
 * Kelime işaretinin altındaki turuncu şerit, armanın ARKASINDAN çıkıyormuş
 * gibi sola taşar (negatif kenar boşluğu) ve arma onun üstünde kalır
 * (z-index). Renk armanın turuncusundan markanın tuğla kırmızısına gider;
 * böylece şerit ayrı bir süs değil, armanın uzantısı gibi okunur.
 *
 * DOKUNMA ALANI
 * Bağlantının görsel yüksekliği 36 pikselken dokunma alanı da 36 pikseldi;
 * mobilde önerilen asgari 44'ün altında. Telefonda logoya basıp bir şey
 * olmaması bundandır. Dikey iç boşluk alanı büyütür, negatif dış boşluk
 * başlığın yüksekliğini değiştirmez — görünüm aynı kalır, hedef büyür.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group -my-2 flex items-center gap-2.5 py-2 ${className}`}
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

      <span className="flex flex-col">
        <span className="text-xl font-extrabold leading-none tracking-tight text-fg">
          Ohaaaa
        </span>
        <span
          aria-hidden="true"
          className="-ml-6 mt-[5px] h-[3px] rounded-full bg-gradient-to-r from-[#E9692A] via-[#D4501F] to-[#C13515] transition-transform duration-200 group-hover:scale-x-105 origin-left"
        />
      </span>
    </Link>
  );
}
