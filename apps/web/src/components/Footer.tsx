import Link from 'next/link';

import { Logo } from './Logo';

const LINK_GROUPS = [
  {
    title: 'Ohaaaa',
    links: [
      { label: 'Hakkımızda', href: '/' },
      { label: 'Nasıl çalışır?', href: '/' },
      { label: 'Kariyer', href: '/' },
    ],
  },
  {
    title: 'Taşeronlar',
    links: [
      { label: 'Satıcı ol', href: '/tasoron' },
      { label: 'Başvuru yap', href: '/tasoron/basvuru' },
      { label: 'Satıcı paneli', href: '/tasoron/panel' },
      { label: 'API dokümantasyonu', href: '/tasoron/api' },
    ],
  },
  {
    title: 'Yardım',
    links: [
      { label: 'Sipariş takibi', href: '/' },
      { label: 'İade ve değişim', href: '/' },
      { label: 'İletişim', href: '/' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-bg-elevated">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              Türkiye’nin çok satıcılı süper-agregatörü. Aynı ürünü onlarca mağazadan
              karşılaştır, kargo dahil en iyi toplam fiyatı gör.
            </p>
          </div>

          {LINK_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold text-fg">{group.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted transition-colors hover:text-brand-soft"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Ohaaaa. Tüm hakları saklıdır.</p>
          <p>Fiyatlar taşeronlar tarafından belirlenir ve anlık olarak değişebilir.</p>
        </div>
      </div>
    </footer>
  );
}
