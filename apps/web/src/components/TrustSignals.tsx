import Link from 'next/link';

import { ShieldIcon, ChartIcon, StoreIcon, TruckIcon } from './Icons';

/**
 * Güven sinyalleri (madde 11).
 *
 * KURAL: Buradaki her ifade DOĞRULANABİLİR olmalıdır. "Türkiye'nin 1
 * numaralı sitesi" gibi kanıtlanamaz iddialar hem Ticari Reklam
 * Yönetmeliği'ne aykırıdır hem de ilk sorgulandığında güveni yok eder.
 *
 * Bu yüzden her madde, sitenin gerçekte yaptığı bir şeye bağlanır ve
 * ayrıntısını anlatan sayfaya link verir.
 */
const SIGNALS = [
  {
    icon: ChartIcon,
    title: 'Sıralama satılık değil',
    body:
      'Teklifler yalnızca kargo dahil toplam fiyata göre sıralanır. Komisyon aldığımız ' +
      'mağazalar listede yukarı çıkmaz.',
    href: '/ortaklik-aciklamasi',
    linkLabel: 'Nasıl para kazanıyoruz?',
  },
  {
    icon: ShieldIcon,
    title: 'Fiyat geçmişi açık',
    body:
      '“İndirim” derken mağazanın üstü çizili fiyatına değil, kendi ölçtüğümüz geçmişe ' +
      'bakıyoruz. Gözlem süremiz kısaysa bunu belirtiyoruz.',
    href: '/sss',
    linkLabel: 'Nasıl ölçüyoruz?',
  },
  {
    icon: TruckIcon,
    title: 'Kargo dahil fiyat',
    body:
      'Etiket fiyatı değil, ödeyeceğiniz tutar gösterilir. Ücretsiz kargo eşikleri ' +
      'hesaba katılır.',
    href: '/kosullar',
    linkLabel: 'Sıralama kriterleri',
  },
  {
    icon: StoreIcon,
    title: 'Satıcı bilgisi görünür',
    body:
      'Her teklifte satıcının adı, puanı ve satışın nerede tamamlanacağı yazar. ' +
      'Kimden aldığınızı tıklamadan önce bilirsiniz.',
    href: '/hakkimizda',
    linkLabel: 'İki tür satıcı',
  },
] as const;

export function TrustSignals() {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
        Neden bize güvenebilirsiniz?
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Her iddianın arkasında, denetleyebileceğiniz bir kural var.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SIGNALS.map((signal) => (
          <article key={signal.title} className="card flex flex-col p-5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/12 text-brand">
              <signal.icon className="h-5 w-5" />
            </span>

            <h3 className="mt-4 text-sm font-semibold">{signal.title}</h3>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-muted">{signal.body}</p>

            <Link
              href={signal.href}
              className="mt-3 text-xs font-medium text-brand-soft transition-colors hover:text-brand"
            >
              {signal.linkLabel} →
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
