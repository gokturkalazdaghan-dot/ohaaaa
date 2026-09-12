import Link from 'next/link';

import { formatMoney, scoredCount } from '@ohaaaa/shared';

import type { ShowcaseTier } from '@/data/catalog';
import { ProductPlaceholder } from './ProductPlaceholder';
import { resolveProductImage } from './ProductCard';

/**
 * Vitrin: en iyi satıcıdan başlayarak basamaklar, her basamakta beş KARE.
 *
 * NEDEN BENTO IZGARASI KALDIRILDI
 * Önceki hâl değişken yükseklikli bir "bento" ızgarasıydı: `auto-rows-[60px]`
 * satır yüksekliği ve yalnızca `sm:`/`md:` altında tanımlı `row-span`
 * sınıfları. Telefonda (tek sütun) hiçbir span uygulanmıyordu, dolayısıyla
 * her kare 1 satır = 60 piksel yükseklik alıyor ve tam genişliğe yayılıyordu
 * -- ürün fotoğrafları uzun şeritlere dönüşüyordu. Ölçülen davranış buydu.
 * Kare ızgara bu sınıfı tamamen ortadan kaldırıyor: `aspect-square` her
 * genişlikte aynı oranı verir.
 *
 * NEDEN SUNUCU BİLEŞENİ
 * Önceki galeri istemci bileşeniydi (sürükle-bırak, büyütme kipi, animasyon
 * kütüphanesi). Bir SIRALAMAYI kullanıcının sürükleyerek bozabilmesi zaten
 * çelişkiliydi. Sunucuda çizilince ana sayfaya framer-motion yükü binmiyor
 * ve kareler ilk boyamada görünür oluyor.
 */
export function ShowcaseTiers({ tiers }: { tiers: ShowcaseTier[] }) {
  if (tiers.length === 0) return null;

  return (
    <section aria-labelledby="vitrin-basligi">
      <h2 id="vitrin-basligi" className="text-2xl font-extrabold tracking-tight text-fg sm:text-3xl">
        Vitrin
      </h2>
      <p className="mt-2 text-sm text-muted">
        En çok teklif veren mağazadan başlayarak, her basamakta o mağazanın öne çıkan beş ürünü.
      </p>

      <ol className="mt-6 space-y-8">
        {tiers.map((tier, sira) => (
          <li key={tier.merchantSlug}>
            <TierHead tier={tier} basamak={sira + 1} />

            {/*
              KARE IZGARA.
              Telefonda iki sütun (kareler parmakla dokunulabilir boyutta
              kalır), tablette üç, geniş ekranda beşi tek satırda -- basamak
              kavramının görsel karşılığı.
            */}
            <ol className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {tier.products.map((urun, index) => {
                const gorsel = resolveProductImage(urun.imageUrl, urun.slug);

                return (
                  <li key={urun.slug}>
                    <Link
                      href={`/urun/${urun.slug}`}
                      className="card-link group flex h-full flex-col overflow-hidden"
                    >
                      <div className="relative aspect-square overflow-hidden bg-surface-photo">
                        {gorsel ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={gorsel}
                            alt=""
                            /*
                              İlk basamağın ilk iki karesi katlamanın üstünde
                              olabiliyor; onlar beklemeye alınmıyor.
                            */
                            loading={sira === 0 && index < 2 ? 'eager' : 'lazy'}
                            decoding="async"
                            className="h-full w-full object-contain transition-transform duration-200 ease-out group-hover:scale-[1.03]"
                          />
                        ) : (
                          <ProductPlaceholder seed={urun.slug} />
                        )}

                        {/* Sıra numarası: basamak içindeki yer. */}
                        <span
                          aria-hidden="true"
                          className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-cta text-2xs font-bold text-white shadow-sm"
                        >
                          {index + 1}
                        </span>

                        {/*
                          SKOR ROZETİ YALNIZCA ÖLÇÜLDÜYSE.
                          `score` null geldiğinde hiçbir şey çizilmez; boş bir
                          rozet ya da "—" yazmak, ölçemediğimiz bir şeyi
                          ölçmüş gibi göstermenin yumuşak hâli olurdu.
                        */}
                        {urun.score !== null && (
                          <span className="absolute right-2 top-2 rounded-full bg-fg/85 px-2 py-0.5 text-2xs font-bold tabular text-bg">
                            {urun.score}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col p-3">
                        {urun.brand && (
                          <p className="text-2xs font-semibold uppercase tracking-wide text-subtle">
                            {urun.brand}
                          </p>
                        )}
                        <h3 className="clamp-2 mt-1 text-sm font-semibold leading-snug text-fg">
                          {urun.title}
                        </h3>

                        <div className="mt-auto pt-2">
                          {/*
                            Fiyat, para birimi BİLİNİYORSA basılır. Bilinmiyorsa
                            hiç gösterilmez: GBP bir fiyatı `₺` ile yazmak
                            yanlış bilgi vermektir.
                          */}
                          {urun.minPriceCents !== null && urun.currency && (
                            <p className="tabular text-base font-extrabold leading-none text-fg">
                              {formatMoney(urun.minPriceCents, urun.currency)}
                            </p>
                          )}
                          {urun.offerCount > 1 && (
                            <p className="mt-1 text-xs text-muted">{urun.offerCount} teklif</p>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Basamak başlığı -- ve sıranın NEYE göre kurulduğunun açıkça yazıldığı yer.
 *
 * Bu cümle süs değil. Ohaaaa skoru bugün kataloğun hiçbir ürününde
 * ölçülemiyor (her ürünün tek fiyat gözlemi var, skorun eşiği ise ölçülebilen
 * ağırlığın yarısı). "En yüksek puanlı ürünler" yazıp altına puansız beş
 * ürün dizmek, ölçmediğimiz bir sıralamayı ölçülmüş gibi sunmak olurdu.
 */
function TierHead({ tier, basamak }: { tier: ShowcaseTier; basamak: number }) {
  const puanli = scoredCount(tier.products);
  const olcut =
    puanli === tier.products.length
      ? 'Ohaaaa puanına göre'
      : puanli > 0
        ? `${puanli} üründe Ohaaaa puanı ölçüldü, onlar önde`
        : 'Ohaaaa puanı henüz ölçülemedi — en çok teklifle karşılaştırılanlar';

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="tabular text-xs font-bold text-subtle">{basamak}.</span>
      <Link href={`/magaza/${tier.merchantSlug}`} className="text-lg font-bold text-fg hover:text-brand">
        {tier.merchantName}
      </Link>
      <span className="tabular text-xs text-muted">{tier.offerCount.toLocaleString('tr-TR')} teklif</span>
      <span className="text-xs text-subtle">· {olcut}</span>
    </div>
  );
}
