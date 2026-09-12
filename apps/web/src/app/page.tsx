import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { DataUnavailable } from '@/components/DataUnavailable';
import { FlashDeals } from '@/components/FlashDeals';
import { categoryIcon } from '@/components/Icons';
import { SearchBar } from '@/components/SearchBar';
import { isVisualSearchConfigured } from '@/lib/visualSearch';
import { ProductCard } from '@/components/ProductCard';
import { RecentlyViewed } from '@/components/RecentlyViewed';
import { TrustSignals } from '@/components/TrustSignals';
import {
  getCategoryTree,
  getFlashDeals,
  getShowcaseTiers,
  getVendors,
  searchProducts,
} from '@/data/catalog';
import { ShowcaseTiers } from '@/components/ShowcaseTiers';

/*
 * Ana sayfanın kendi meta verisi yoktu.
 *
 * Başlık ve açıklama yerleşimden (layout) düşüyordu — o kısım zaten
 * doğruydu — ama CANONICAL hiç yayınlanmıyordu. Ana sayfa, aynı içeriğe
 * en çok farklı adresten ulaşılan sayfadır: kök ile eğik çizgili hâli,
 * `www` olan ve olmayan alan adı, kampanya bağlantılarındaki `?utm_*`
 * kuyrukları. Canonical söylenmediğinde arama motoru bunları ayrı sayfa
 * sayabilir ve sıralama sinyalleri bölünür.
 *
 * Başlık burada TEKRAR yazılmaz: yerleşimdeki `default` zaten doğru ve
 * iki yere yazmak, birini değiştirip diğerini unutmanın davetidir.
 */
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

/**
 * Bir veri çağrısının sonucu: değer geldi mi, yoksa kaynağa mı ulaşılamadı?
 *
 * NEDEN AYRI BİR TİP
 * `.catch(() => [])` kolaydır ama BİLGİ KAYBEDER: boş dizi "veri yok" ile
 * "veriye ulaşamadık"ı aynı şeye indirger. Ana sayfa tam olarak bu ikisini
 * ayırmak zorunda -- kesinti sırasında ziyaretçiye "katalog boş" demek,
 * ona gerçek olmayan bir şey söylemektir.
 */
type Fetched<T> = { ok: true; value: T } | { ok: false };

/** Bir veri çağrısını yakalar, loglar ve sonucu SINIFLANDIRIR (madde 24). */
async function fetched<T>(what: string, promise: Promise<T>): Promise<Fetched<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Ana sayfa bölümü veri kaynağına ulaşamadı',
        section: what,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false };
  }
}

export default async function HomePage() {
  /*
   * ANA SAYFA ARTIK KESİNTİDE ÇÖKMÜYOR.
   *
   * Önceden `getCategories()` doğrudan bekleniyordu; veritabanına
   * ulaşılamadığında hata yukarı çıkıyor ve ana sayfanın TAMAMI 500'e
   * düşüyordu (ölçüldü). Aynı anda `/urun`, `/kategori`, `/magaza`
   * sayfaları düzgünce "veri yok" diyerek ayakta kalıyordu -- yani en çok
   * ziyaret edilen sayfa, sitenin en dirençsiz sayfasıydı.
   *
   * Şimdi her bölüm kendi başına yakalanıyor. Hero ve arama kutusu her
   * hâlükârda çiziliyor: arama `/arama` sayfasına gider ve o sayfa zaten
   * kesintiye dayanıklı.
   */
  const [dealsRes, categoriesRes, vendorsRes, trendingRes, vitrinRes] = await Promise.all([
    fetched('kampanyalar', getFlashDeals(3)),
    fetched('kategoriler', getCategoryTree()),
    fetched('magazalar', getVendors()),
    /*
     * 16 isteniyor ama 8 gosteriliyor: asagida vitrindeki urunler bu
     * listeden ELENIYOR ve eleme sonrasi yine sekiz kart kalmali.
     */
    fetched('one-cikanlar', searchProducts({ sort: 'offers', limit: 16 })),
    fetched('vitrin', getShowcaseTiers({ tiers: 3, perTier: 5 })),
  ]);

  const deals = dealsRes.ok ? dealsRes.value : [];
  const vitrin = vitrinRes.ok ? vitrinRes.value : [];
  const categories = categoriesRes.ok ? categoriesRes.value : [];
  const vendors = vendorsRes.ok ? vendorsRes.value : [];
  /*
   * VITRINDEKI URUNLER BU IZGARADA TEKRAR ETMEZ.
   *
   * Iki bolum de ayni olcute bakiyor (teklif sayisi), dolayisiyla filtresiz
   * birakilirsa vitrinin ilk bes karesi ile bu izgaranin ilk bes karti AYNI
   * urunler olur -- ayni sayfada ayni urunu iki kez gormek hata gibi
   * gorunur. Eleme vitrinden sonra yapilir cunku vitrinin neyi sectigi ancak
   * o zaman belli olur.
   */
  const vitrindekiler = new Set(vitrin.flatMap((b) => b.products.map((u) => u.slug)));
  const trendingHam = trendingRes.ok ? trendingRes.value.results : [];
  const trending = trendingHam
    .filter((sonuc) => !vitrindekiler.has(sonuc.slug))
    .slice(0, 8);

  /*
   * ÜÇ AYRI DURUM, ÜÇ AYRI MESAJ.
   *
   *   1) veri geldi, içinde ürün var      → normal vitrin
   *   2) veri geldi, katalog gerçekten boş → lansman bölümü
   *   3) veriye ULAŞILAMADI                → kesinti bildirimi
   *
   * 2 ile 3'ü karıştırmak, geçici bir kesintide ziyaretçiye "burada hiç
   * ürün yok" demek olurdu. Kataloğun boş OLDUĞUNU ancak kataloğu
   * gerçekten okuyabildiysek söyleyebiliriz.
   */
  const catalogUnavailable = !trendingRes.ok && !categoriesRes.ok;
  /*
   * Karar FILTRESIZ listeye bakar. `trending` vitrinde gosterilenler
   * elendikten sonra kalanlar; kucuk bir katalogda vitrin hepsini
   * tuketebilir ve o zaman "katalog bos" demek YANLIS olurdu.
   */
  const catalogEmpty =
    !catalogUnavailable && trendingHam.length === 0 && deals.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      {/* --- Giris -----------------------------------------------------------
          Onceki hali baslik + tek satir alt metinden ibaretti ve sayfanin
          ustunde bos bir serit birakiyordu. Deger onermesi ("kargo dahil")
          burada acikca soylenir; fiyat karsilastirmada asil fark budur. */}
      <section className="py-10 sm:py-14">
        <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-fg sm:text-5xl">
          <span className="text-brand">OHA!</span> Aradığını bulduk
        </h1>
        {/*
          Alt metin ne yaptığımızı SÖYLER, başlık dikkati çeker. Başlığın
          tek başına ne sattığımızı anlatmaması sorun değil -- hemen altında
          yazıyor. Ama alt metin de kaybolmamalı: "kargo dahil" bu sitenin
          rakiplerinden ayrıldığı tek cümle.
        */}
        <p className="mt-4 max-w-xl text-base text-muted sm:text-lg">
          Ne aradığını yaz — mağazaların kargo ve indirimlerini hesaba katıp
          <strong className="font-semibold text-fg"> kargo dahil toplam tutarı</strong>{' '}
          karşılaştıralım. En düşük toplam üstte durur.
        </p>

        {/*
          HERO ARAMA KUTUSU.

          `size="hero"` varyantı yazılmıştı ama HİÇBİR YERDE kullanılmıyordu —
          arama yalnızca üst çubuktaki küçük kutudan yapılabiliyordu.

          Bir pazar yerinde arama, ana sayfanın birincil eylemidir: ziyaretçi
          gezmeye değil, aklındaki ürünü bulmaya gelir. Onu üst çubuktaki
          küçük bir alana yönlendirmek, dükkânın kapısındaki danışmayı
          arka odaya koymaya benzer.

          Kategori çipleri hemen altında kalır: ne aradığını bilmeyen
          ziyaretçinin yolu da açık olsun.
        */}
        <div className="mt-8 max-w-2xl">
          <Suspense fallback={<div className="h-[68px] w-full rounded-2xl bg-surface-2" />}>
            <SearchBar
              size="hero"
              label="Ürün, marka veya model ara"
              visualSearchEnabled={isVisualSearchConfigured()}
            />
          </Suspense>
        </div>

        {/*
          Kategori çipleri artık İKONLU.

          İkonlar çizilmişti ve `categories.icon` alanı veritabanından ta
          buraya kadar taşınıyordu — ama hiçbir yerde kullanılmıyordu; çipler
          düz metindi. Bir ızgarada aranan kategoriyi bulmak, kelimeyi
          okumaktan çok şekli tanımakla olur; ikon burada süs değil,
          tarama hızıdır.

          İkon `aria-hidden`: adı zaten yanında yazıyor, ekran okuyucuya iki
          kez söylemek gürültüdür. İkonu olmayan kategori sorunsuz şekilde
          yalnızca metinle çizilir.
        */}
        {categories.length > 0 && (
          <nav aria-label="Kategoriler" className="mt-6">
            <ul className="flex flex-wrap gap-2">
              {/*
                Üst kategori ve alt kategorileri BİRLİKTE. Kataloğun
                neredeyse tamamı alt kategorilerde duruyor (bilgisayar
                32.894 grup -- ölçüldü); yalnızca üstleri göstermek en çok
                ürünü olan yolları gizlemekti. Ürün sayısı çipte yazılıyor
                çünkü ölçülmüş bir değer ve kullanıcı hangi kategorinin
                dolu olduğunu böyle görür.
              */}
              {categories.flatMap((node) => [
                <li key={node.category.id}>
                  <Link href={`/kategori/${node.category.slug}`} className="chip">
                    {(() => {
                      const Icon = categoryIcon(node.category);
                      return Icon ? <Icon className="h-4 w-4 text-brand" aria-hidden="true" /> : null;
                    })()}
                    {node.category.name}
                    <span className="tabular text-2xs text-subtle">
                      {node.groupCount.toLocaleString('tr-TR')}
                    </span>
                  </Link>
                </li>,
                ...node.children.map((child) => (
                  <li key={child.category.id}>
                    <Link href={`/kategori/${child.category.slug}`} className="chip">
                      {child.category.name}
                      <span className="tabular text-2xs text-subtle">
                        {child.groupCount.toLocaleString('tr-TR')}
                      </span>
                    </Link>
                  </li>
                )),
              ])}
            </ul>
          </nav>
        )}
      </section>

      {catalogUnavailable && (
        <DataUnavailable
          title="Ürünleri şu an listeleyemiyoruz"
          description="Veri kaynağımıza geçici olarak ulaşamıyoruz. Size eski veya yanlış bir fiyat göstermektense hiç göstermemeyi tercih ediyoruz. Arama kutusu çalışmaya devam ediyor."
        />
      )}
      {catalogEmpty && <LaunchState />}

      {/* --- Firsatlar -----------------------------------------------------
          Ana sayfa bu bloğu KENDİ işaretlemesiyle çiziyordu; FlashDeals
          bileşeni yazılmış ama hiç kullanılmamıştı. İki kopya, aynı verinin
          iki farklı görünümü demekti. Bileşen olan sürüm daha iyi: geri
          sayım ve stok çubuğu var, ikisi de aciliyeti gerçek veriden
          kuruyor (uydurma bir "son 2 ürün" yazmıyor). */}
      <div className="mt-2">
        <FlashDeals deals={deals} />
      </div>

      {/*
        --- Vitrin -----------------------------------------------------------
        Vitrin "Cok karsilastirilanlar" izgarasinin ONUNE konuldu: ikisi ayni
        kataloga bakar ama farkli soruyu cevaplar. Vitrin "hangi magaza, hangi
        bes urun" der (satici bazli basamaklar); asagidaki izgara "hangi urun
        en cok karsilastiriliyor" der (magazadan bagimsiz). Once vitrin gelir
        cunku kare gorseller goz tarafindan daha hizli taranir.

        Bos listede bilesen kendini hic cizmiyor -- bos bir vitrin karesi
        vitrine zarar verir.
      */}
      {vitrin.length > 0 && (
        <section className="mt-12">
          <ShowcaseTiers tiers={vitrin} />
        </section>
      )}

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

      {/* Geri dönen ziyaretçi kaldığı yerden devam edebilsin. Liste boşsa
          bölüm hiç çizilmez. */}
      <RecentlyViewed />

      {/* Güven sinyalleri: her maddesi doğrulanabilir ve ayrıntısını anlatan
          sayfaya bağlanıyor. Bileşen yazılmış ama hiç kullanılmamıştı. */}
      <div className="mt-16">
        <TrustSignals />
      </div>
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
            className="rounded-full press bg-brand-cta px-6 py-3 text-sm font-bold text-[#fffaf5] transition-colors hover:bg-brand-strong"
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
