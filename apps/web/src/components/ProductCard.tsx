import Image from 'next/image';
import Link from 'next/link';

import { formatMoney, type SearchResult } from '@ohaaaa/shared';

import { StoreIcon } from './Icons';

/**
 * Arama sonucu kartı.
 *
 * Karşılaştırma vaadi kartın kendisinde görünür olmalıdır: yalnızca fiyat
 * değil, "kaç mağazada var" ve "en ucuzu kim veriyor" bilgisi de gösterilir.
 * Kullanıcı böylece ürüne tıklamadan önce agregasyonun değerini görür.
 */
export function ProductCard({ result }: { result: SearchResult }) {
  const hasSpread =
    result.minPriceCents !== null &&
    result.maxPriceCents !== null &&
    result.maxPriceCents > result.minPriceCents;

  const savingsCents = hasSpread ? result.maxPriceCents! - result.minPriceCents! : 0;

  return (
    <Link
      href={`/urun/${result.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-all duration-300 hover:-translate-y-1 hover:border-brand/45 hover:shadow-[var(--glow-brand)]"
    >
      <div className="relative aspect-4/3 overflow-hidden bg-surface-2">
        <ProductThumb title={result.title} />

        {result.offerCount > 1 && (
          <span className="absolute left-3 top-3 rounded-full border border-line-strong bg-bg/85 px-2.5 py-1 text-[11px] font-semibold text-fg backdrop-blur">
            {result.offerCount} mağaza
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        {result.brand && (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
            {result.brand}
          </span>
        )}

        <h3 className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-fg transition-colors group-hover:text-brand-soft">
          {result.title}
        </h3>

        <div className="mt-auto pt-4">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-subtle">en ucuz</span>
            <span className="tabular text-lg font-bold text-fg">
              {result.minPriceCents !== null ? formatMoney(result.minPriceCents) : '—'}
            </span>
          </div>

          {hasSpread && (
            <p className="mt-1 text-[11px] text-success">
              En pahalı mağazadan {formatMoney(savingsCents)} tasarruf
            </p>
          )}

          {result.bestVendorName && !/^örnek\b/i.test(result.bestVendorName) && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
              <StoreIcon className="h-3.5 w-3.5" />
              {result.bestVendorName}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * Görsel yer tutucu.
 *
 * Taşeron görselleri henüz bağlanmadığı için ürün başlığından türetilen
 * kararlı bir renk ve baş harf gösterilir. Rastgele renk KULLANILMAZ:
 * aynı ürün her yüklemede aynı görünmelidir.
 */
function ProductThumb({ title }: { title: string }) {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) % 360;
  }

  return (
    <div
      className="grid h-full w-full place-items-center transition-transform duration-500 group-hover:scale-105"
      style={{
        background: `radial-gradient(120% 120% at 30% 20%, hsl(${hash} 70% 22%) 0%, hsl(${(hash + 45) % 360} 65% 12%) 60%, var(--surface-2) 100%)`,
      }}
      /*
       * Yer tutucu bir görsel bilgi taşımaz; ekran okuyucuya "A harfi"
       * okutmak gürültüdür. Bu yüzden role="img" + alt metni YERİNE
       * tamamen gizlenir — ürün adı zaten kartın içinde yazılıdır.
       *
       * Gerçek ürün görselleri bağlandığında bu bileşen <Image> ile
       * değiştirilecek ve alt metni ürün adından üretilecektir
       * (bkz. ProductImage).
       */
      aria-hidden="true"
    >
      <span className="text-4xl font-black text-white/85">{title.charAt(0).toUpperCase()}</span>
    </div>
  );
}

/**
 * Gerçek ürün görseli (madde 13 ve 17).
 *
 * Görsel yoksa yer tutucuya düşer. `next/image` kullanılır: otomatik
 * WebP/AVIF dönüşümü, boyut değişkeleri ve tembel yükleme (lazy loading)
 * bundan gelir — görsel optimizasyonun tamamı tek bileşende.
 */
export function ProductImage({
  src,
  title,
  brand,
  priority = false,
}: {
  src: string | null;
  title: string;
  brand?: string | null;
  priority?: boolean;
}) {
  if (!src) return <ProductThumb title={title} />;

  return (
    <Image
      src={src}
      /*
       * Alt metni tanımlayıcı olmalı ama anahtar kelime doldurulmamalıdır.
       * "Ürün görseli" gibi ifadeler değersizdir: ekran okuyucu zaten
       * "görsel" der. Marka + ürün adı doğru bilgiyi taşır.
       */
      alt={brand ? `${brand} ${title}` : title}
      fill
      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px"
      className="object-contain transition-transform duration-500 group-hover:scale-105"
      // Vitrindeki ilk görsel LCP ölçüsünü belirler; tembel yüklenmemeli.
      priority={priority}
      loading={priority ? undefined : 'lazy'}
    />
  );
}

export { ProductThumb };
