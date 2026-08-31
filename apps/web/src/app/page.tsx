import Link from 'next/link';

import { FlashDeals } from '@/components/FlashDeals';
import { ProductCard } from '@/components/ProductCard';
import { RecentlyViewed } from '@/components/RecentlyViewed';
import { TrustSignals } from '@/components/TrustSignals';
import { getCategories, getFlashDeals, getVendors, searchProducts } from '@/data/catalog';

export default async function HomePage() {
  const [deals, categories, vendors, trendingPage] = await Promise.all([
    getFlashDeals(3),
    getCategories(),
    getVendors(),
    searchProducts({ sort: 'offers', limit: 8 }),
  ]);
  const trending = trendingPage.results;

  /* Katalogda hicbir urun yoksa sayfa hero'dan sonra bosluga dusuyordu.
     O durumda ziyaretciye ne oldugunu, saticiya ne yapmasi gerektigini
     soyleyen bir lansman bolumu gosterilir. Uydurma urun konmaz. */
  const catalogEmpty = trending.length === 0 && deals.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      {/* --- Giris -----------------------------------------------------------
          Onceki hali baslik + tek satir alt metinden ibaretti ve sayfanin
          ustunde bos bir serit birakiyordu. Deger onermesi ("kargo dahil")
          burada acikca soylenir; fiyat karsilastirmada asil fark budur. */}
      <section className="py-10 sm:py-14">
        <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-fg sm:text-5xl">
          Aynı ürün, <span className="text-brand">kargo dahil</span> fiyat
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted sm:text-lg">
          Mağazaların kargo ve indirimlerini hesaba katıp toplam tutarı karşılaştırıyoruz.
          En düşük toplam üstte durur.
        </p>

        {categories.length > 0 && (
          <nav aria-label="Kategoriler" className="mt-7">
            <ul className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <li key={category.id}>
                  <Link href={`/kategori/${category.slug}`} className="chip">
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>

      {catalogEmpty && <LaunchState />}

      {/* Geri dönen ziyaretçi kaldığı yerden devam edebilsin. Liste boşsa
          bölüm hiç çizilmez. */}
      <RecentlyViewed />

      {/* Güven sinyalleri: her maddesi doğrulanabilir ve ayrıntısını anlatan
          sayfaya bağlanıyor. Bileşen yazılmış ama hiç kullanılmamıştı. */}
      <div className="mt-16">
        <TrustSignals />
      </div>

      {/* --- Firsatlar -----------------------------------------------------
          Ana sayfa bu bloğu KENDİ işaretlemesiyle çiziyordu; FlashDeals
          bileşeni yazılmış ama hiç kullanılmamıştı. İki kopya, aynı verinin
          iki farklı görünümü demekti. Bileşen olan sürüm daha iyi: geri
          sayım ve stok çubuğu var, ikisi de aciliyeti gerçek veriden
          kuruyor (uydurma bir "son 2 ürün" yazmıyor). */}
      <div className="mt-2">
        <FlashDeals deals={deals} />
      </div>

      {/* --- Urunler -------------------------------------------------------- */}
      {trending.length > 0 && (
        <section className="mt-12">
          <SectionHead title="Çok karşılaştırılanlar" href="/arama" linkLabel="Tümü" />
          <ul className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {trending.map((result) => (
              <li key={result.groupId}>
                <ProductCard result={result} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- Magazalar ------------------------------------------------------ */}
      {vendors.length > 0 && (
        <section className="mt-12">
          <SectionHead title="Karşılaştırdığımız mağazalar" />
          {/* Mağaza adları artık kendi vitrinlerine bağlanıyor. Tıklanamayan
              bir isim, ziyaretçiye o mağaza hakkında hiçbir şey vermiyordu. */}
          <ul className="mt-4 flex flex-wrap gap-2">
            {vendors.map((vendor) => (
              <li key={vendor.id}>
                <Link href={`/magaza/${vendor.slug}`} className="chip">
                  {vendor.displayName}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionHead({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
      <h2 className="text-xl font-bold tracking-tight text-fg">{title}</h2>
      {href && linkLabel && (
        <Link href={href} className="text-sm font-semibold text-brand hover:underline">
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}

/*
 * Lansman durumu.
 *
 * Katalog bos oldugunda gorunur. Iki isi var: ziyaretciye durumu durustce
 * soylemek (uydurma urun/fiyat koymadan) ve asil ihtiyac olan tarafi -
 * saticiyi - basvuruya goturmek. Katalog magazalardan gelir; bu yuzden bos
 * bir ana sayfanin en degerli kullanimi satici kazanmaktir.
 */
function LaunchState() {
  return (
    <section className="mt-2" aria-labelledby="lansman">
      <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">Yeni açıldı</p>
        <h2 id="lansman" className="mt-3 text-2xl font-extrabold tracking-tight text-fg sm:text-3xl">
          Katalog satıcılarla birlikte dolacak
        </h2>
        <p className="mt-4 max-w-2xl leading-relaxed text-muted">
          Şu anda yayında ürün yok. Gerçek satıcıdan gelmeyen hiçbir fiyatı
          göstermiyoruz — örnek ürün ya da temsili fiyat koymuyoruz. İlk
          mağazalar bağlandıkça karşılaştırma burada başlayacak.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href="/tasoron"
            className="rounded-full bg-brand px-6 py-3 text-sm font-bold text-[#fffaf5] transition-colors hover:bg-brand-strong"
          >
            Mağazanızı ücretsiz yayınlayın
          </Link>
          <Link
            href="/tasoron/marka"
            className="rounded-full border border-line px-6 py-3 text-sm font-semibold text-fg transition-colors hover:border-brand/45"
          >
            Marka kitini indir
          </Link>
        </div>
      </div>

      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {LAUNCH_POINTS.map((point) => (
          <li key={point.title} className="rounded-2xl border border-line bg-surface p-5">
            <p className="font-semibold text-fg">{point.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{point.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const LAUNCH_POINTS = [
  {
    title: 'Listeleme ücretsiz',
    body: 'Aylık ücret, kurulum bedeli ya da satış komisyonu yok.',
  },
  {
    title: 'Karşılığı ambalajınız',
    body: 'Gönderilerinizde Ohaaaa koli bandını ve armasını kullanırsınız. Baskı dosyaları bizden.',
  },
  {
    title: 'Fiyat sizin',
    body: 'Fiyat ve stok sizin sisteminizden gelir; biz yalnızca kargo dahil toplamı karşılaştırırız.',
  },
];
