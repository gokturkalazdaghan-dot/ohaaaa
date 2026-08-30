import Link from 'next/link';

/**
 * Marka kilidi (lockup).
 *
 * "Ohaaaa" içindeki uzayan 'aaa' markanın karakteridir: gradyanla vurgulanır
 * ve ünlem işareti fırsat rengiyle biter.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group flex items-center gap-2 ${className}`}
      aria-label="Ohaaaa ana sayfa"
    >
      <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand via-electric to-cyan text-white shadow-[var(--glow-brand)] transition-transform duration-300 group-hover:scale-105">
        <span className="text-lg font-black leading-none">O</span>
      </span>
      <span className="text-xl font-black tracking-tight">
        <span className="text-fg">Oh</span>
        <span className="text-gradient">aaa</span>
        <span className="text-oha">a!</span>
      </span>
    </Link>
  );
}
