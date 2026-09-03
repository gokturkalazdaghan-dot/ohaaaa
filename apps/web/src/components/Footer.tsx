import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-bg">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 text-left sm:grid-cols-2 sm:px-6">
        <div>
          <p className="font-semibold text-fg">Ohaaaa</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/hakkimizda" className="text-muted hover:text-fg">
                Hakkımızda
              </Link>
            </li>
            <li>
              <Link href="/firsatlar" className="text-muted hover:text-fg">
                Fırsatlar
              </Link>
            </li>
            <li>
              <Link href="/fiyat-takip" className="text-muted hover:text-fg">
                Fiyat takibi
              </Link>
            </li>
            <li>
              <Link href="/tasoron/basvuru" className="text-muted hover:text-fg">
                Satıcı ol
              </Link>
            </li>
            <li>
              <Link href="/iletisim" className="text-muted hover:text-fg">
                İletişim
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-fg">Yasal</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/gizlilik" className="text-muted hover:text-fg">
                Gizlilik
              </Link>
            </li>
            <li>
              <Link href="/kosullar" className="text-muted hover:text-fg">
                Kullanım şartları
              </Link>
            </li>
            <li>
              <Link href="/kvkk" className="text-muted hover:text-fg">
                KVKK
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-subtle sm:px-6">
        © {new Date().getFullYear()} Armanalabs. Ohaaaa, Armanalabs tarafından işletilir.
        Fiyatları satıcı belirler.
      </p>
    </footer>
  );
}
