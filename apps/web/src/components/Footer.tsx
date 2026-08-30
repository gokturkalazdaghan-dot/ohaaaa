import Link from 'next/link';

import { Logo } from './Logo';

/**
 * Alt bilgi bağlantıları (iç linkleme).
 *
 * Her bağlantı GERÇEK bir sayfaya gider. Var olmayan sayfalara giden
 * yer tutucu bağlantılar hem kullanıcıyı hem arama motorunu yanıltır;
 * "yakında" diye bir sayfaya bağlamak, hiç bağlamamaktan kötüdür.
 */
const LINK_GROUPS = [
  {
    title: 'Ohaaaa',
    links: [
      { label: 'Hakkımızda', href: '/hakkimizda' },
      { label: 'Sıkça sorulan sorular', href: '/sss' },
      { label: 'Ortaklık açıklaması', href: '/ortaklik-aciklamasi' },
      { label: 'Bize ulaşın', href: '/iletisim' },
    ],
  },
  {
    title: 'Satıcılar',
    links: [
      { label: 'Satıcı ol', href: '/tasoron' },
      { label: 'Başvuru yap', href: '/tasoron/basvuru' },
      { label: 'Satıcı paneli', href: '/tasoron/panel' },
      { label: 'API dokümantasyonu', href: '/tasoron/api' },
    ],
  },
  {
    title: 'Yasal',
    links: [
      { label: 'Gizlilik politikası', href: '/gizlilik' },
      { label: 'Kullanım şartları', href: '/kosullar' },
      { label: 'KVKK başvurusu', href: '/gizlilik#kvkk' },
      { label: 'Çerez tercihleri', href: '/gizlilik#cerezler' },
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
          <p className="max-w-xl sm:text-right">
            Fiyatlar satıcılar tarafından belirlenir ve anlık değişebilir. Bazı
            bağlantılarımız ortaklık bağlantısıdır; bu size ek maliyet getirmez ve
            sıralamayı etkilemez.{' '}
            <Link href="/ortaklik-aciklamasi" className="underline underline-offset-2">
              Ayrıntı
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
