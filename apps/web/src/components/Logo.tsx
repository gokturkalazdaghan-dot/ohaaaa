import Link from 'next/link';

/**
 * Baslik kilidi: arma + kelime.
 *
 * Armanin ICINDEKI "Ohaaaa" 40 pikselde okunmaz - o boyutta harfler birkac
 * piksele duser ve bulanik bir lekeye donusur. Bu yuzden arma burada bir
 * SIMGE gibi kullanilir (taninan bicim ve renk), okunacak ad ise yanindaki
 * kelime isaretidir. Ikisi ayni isi yapmaya calismaz.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group flex items-center gap-2.5 ${className}`}
      aria-label="Ohaaaa ana sayfa"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/ohaaaa-badge.png"
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 shrink-0 transition-transform duration-200 group-hover:-rotate-6"
      />
      <span className="text-xl font-extrabold tracking-tight text-fg">
        Ohaaaa
      </span>
    </Link>
  );
}
