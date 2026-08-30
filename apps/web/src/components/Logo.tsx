import Link from 'next/link';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`flex items-center gap-2 ${className}`}
      aria-label="Ohaaaa ana sayfa"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/ohaaaa-badge.png"
        alt=""
        width={40}
        height={40}
        className="h-10 w-10"
      />
      <span className="text-lg font-bold tracking-tight text-fg">Ohaaaa</span>
    </Link>
  );
}
