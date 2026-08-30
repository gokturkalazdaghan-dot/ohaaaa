import Link from 'next/link';
import { Suspense } from 'react';

import { formatMoney } from '@ohaaaa/shared';

import { FlashDeals } from '@/components/FlashDeals';
import { categoryIcons, ArrowRightIcon, ShieldIcon, StarIcon, StoreIcon, TruckIcon } from '@/components/Icons';
import { ProductCard } from '@/components/ProductCard';
import { TrustSignals } from '@/components/TrustSignals';
import { SearchBar } from '@/components/SearchBar';
import { getCategories, getFlashDeals, getVendors, searchProducts } from '@/data/catalog';

/** Ana sayfa 5 dakikada bir yeniden üretilir: taze fiyat + CDN önbelleği. */
export const revalidate = 300;

export default async function HomePage() {
  // Bağımsız sorgular paralel çalışır; art arda beklemek sayfayı yavaşlatır.
  const [deals, categories, vendors, trending] = await Promise.all([
    getFlashDeals(3),
    getCategories(),
    getVendors(),
    searchProducts({ sort: 'offers', limit: 8 }),
  ]);

  return (
    <>
      <Hero />

      <div className="space-y-20 pb-8">
        <CategoryStrip categories={categories} />
        <FlashDeals deals={deals} />
        <TrendingProducts results={trending} />
        <VendorShowcase vendors={vendors} />
        <TrustSignals />
        <VendorCta />
      </div>
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line">
      {/* Arka plan ışımaları — tamamen dekoratif.
          Açık temada belirgin biçimde zayıflatılır: beyaz zeminde aynı
          yoğunluk, metnin kontrastını düşüren pastel bir bulanıklık üretir. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand/8 blur-[100px] animate-[float_9s_ease-in-out_infinite] dark:bg-brand/20" />
        <div className="absolute -right-24 top-10 h-96 w-96 rounded-full bg-electric/8 blur-[100px] animate-[float_11s_ease-in-out_infinite_reverse] dark:bg-electric/20" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-oha/5 blur-[90px] dark:bg-oha/12" />
      </div>

      <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-4 py-1.5 text-xs font-medium text-muted backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          3 mağaza, 12 milyon ürün, tek arama
        </span>

        <h1 className="mt-7 text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
          Aynı ürün, <span className="text-gradient">onlarca mağaza</span>.
          <br />
          En iyi fiyatı biz buluruz.
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          Ohaaaa, Türkiye’nin bütün satıcılarını tek çatı altında toplar. Kargo dahil
          <strong className="font-semibold text-fg"> gerçek toplam maliyeti</strong> karşılaştırır,
          farklı mağazalardan aldıklarınızı tek sepette birleştirir.
        </p>

        <div className="mx-auto mt-10 max-w-3xl">
          <Suspense fallback={<div className="h-20 w-full rounded-2xl skeleton" />}>
            <SearchBar size="hero" />
          </Suspense>
        </div>

        <dl className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Aktif taşeron', value: '3' },
            { label: 'Karşılaştırılan ürün', value: '12M+' },
            { label: 'Ortalama tasarruf', value: '%18' },
            { label: 'Memnuniyet', value: '4.7/5' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-line bg-surface/60 p-3 backdrop-blur">
              <dd className="tabular text-xl font-black text-fg sm:text-2xl">{stat.value}</dd>
              <dt className="mt-0.5 text-[11px] text-muted">{stat.label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function CategoryStrip({ categories }: { categories: Awaited<ReturnType<typeof getCategories>> }) {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
      <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Kategoriler</h2>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {categories.map((category, index) => {
          const CategoryIcon = categoryIcons[category.slug] ?? StoreIcon;

          return (
            <Link
              key={category.id}
              href={`/kategori/${category.slug}`}
              className="group flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:border-brand/45 hover:shadow-[var(--glow-brand)]"
              style={{ animation: `rise 0.5s cubic-bezier(0.16,1,0.3,1) ${index * 45}ms both` }}
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-brand/18 to-electric/18 text-brand-soft transition-transform duration-300 group-hover:scale-110">
                <CategoryIcon className="h-6 w-6" />
              </span>
              <span className="text-sm font-medium">{category.name}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function TrendingProducts({ results }: { results: Awaited<ReturnType<typeof searchProducts>> }) {
  if (results.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
            En çok karşılaştırılanlar
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Birden fazla mağazada bulunan, fiyat farkı en yüksek ürünler.
          </p>
        </div>

        <Link
          href="/arama"
          className="hidden shrink-0 items-center gap-1.5 text-sm font-medium text-brand-soft hover:text-brand sm:flex"
        >
          Tümünü gör
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {results.map((result) => (
          <ProductCard key={result.groupId} result={result} />
        ))}
      </div>
    </section>
  );
}

function VendorShowcase({ vendors }: { vendors: Awaited<ReturnType<typeof getVendors>> }) {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Ohaaaa’daki mağazalar</h2>
      <p className="mt-1.5 text-sm text-muted">
        Hepsi doğrulanmış, hepsi tek sepette birleşiyor.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {vendors.map((vendor) => (
          <article
            key={vendor.id}
            className="card flex flex-col p-5 transition-all duration-300 hover:-translate-y-1 hover:border-brand/40"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand to-electric text-base font-black text-white">
                {vendor.displayName.charAt(0)}
              </span>
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{vendor.displayName}</h3>
                <p className="flex items-center gap-1 text-xs text-muted">
                  <StarIcon className="h-3.5 w-3.5 fill-warning text-warning" />
                  <span className="tabular">{vendor.rating.toFixed(2)}</span>
                  <span className="text-subtle">
                    ({vendor.ratingCount.toLocaleString('tr-TR')} değerlendirme)
                  </span>
                </p>
              </div>
            </div>

            {vendor.description && (
              <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-muted">
                {vendor.description}
              </p>
            )}

            <div className="mt-4 flex items-center gap-4 border-t border-line pt-4 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <ShieldIcon className="h-4 w-4 text-success" />
                Doğrulanmış
              </span>
              <span className="flex items-center gap-1.5">
                <TruckIcon className="h-4 w-4" />
                Hızlı kargo
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function VendorCta() {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="card-glow relative overflow-hidden p-8 sm:p-12">
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand/25 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand-soft">
              <StoreIcon className="h-3.5 w-3.5" />
              Taşeronlar için
            </span>

            <h2 className="mt-5 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              Ürünlerinizi 15 dakikada Ohaaaa’ya taşıyın.
            </h2>

            <p className="mt-4 max-w-xl leading-relaxed text-muted">
              Tek bir REST çağrısıyla kataloğunuzu senkronize edin. Kendi API anahtarınızı
              panelden oluşturun, stok ve fiyatı anlık güncelleyin, siparişleri aynı API’den
              okuyun. Kurulum ücreti yok; yalnızca satıştan komisyon.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/tasoron/basvuru"
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-electric px-6 py-3 font-semibold text-white transition-transform hover:scale-[1.03]"
              >
                Hemen başvur
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link
                href="/tasoron/api"
                className="rounded-xl border border-line bg-surface px-6 py-3 font-semibold transition-colors hover:border-brand/45"
              >
                API dokümantasyonu
              </Link>
            </div>
          </div>

          {/* Entegrasyonun ne kadar basit olduğunu göstermek, uzun bir
              açıklamadan daha ikna edici. */}
          <div className="overflow-hidden rounded-xl border border-line bg-bg">
            <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
              <span className="ml-2 font-mono text-[11px] text-subtle">ürün-besle.sh</span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-muted">
              <code>{`curl -X POST https://api.ohaaaa.com/api/v1/products \\
  -H "x-api-key: $OHAAAA_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "products": [{
      "external_id": "SKU-001",
      "title": "Ürün adı",
      "gtin": "8690000000001",
      "price_cents": 129900,
      "stock": 42
    }]
  }'`}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
