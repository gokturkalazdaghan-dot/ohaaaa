import Link from 'next/link';

import { formatMoney, type PriceDrop } from '@ohaaaa/shared';

import { ProductPlaceholder } from './ProductPlaceholder';
import { resolveProductImage } from './ProductCard';

/**
 * Fiyatı düşen bir ürünün kartı.
 *
 * DÜŞÜŞÜN NASIL YAZILDIĞI ÖNEMLİDİR.
 * Yaygın kalıp, referans fiyatı üstü çizili göstermektir. Burada KASITLI
 * olarak öyle yapılmıyor: üstü çizili fiyat, kullanıcının zihninde
 * "mağazanın liste fiyatı" anlamına gelir ve biz o fiyatı kullanmıyoruz.
 * Bunun yerine referansın ne olduğu açıkça yazılıyor:
 * "Son N günde gördüğümüz en yüksek fiyat".
 *
 * Gözlem penceresi kısaysa (7 günden az) düşüş oranı gösterilir ama yanına
 * kaç günlük gözleme dayandığı yazılır. Üç günlük gözlemi otuz günlükmüş
 * gibi sunmak, ölçüm yokken ölçüm iddia etmekle aynı kapıya çıkar.
 */
export function PriceDropCard({
  drop,
  priority = false,
}: {
  drop: PriceDrop;
  priority?: boolean;
}) {
  const image = resolveProductImage(drop.imageUrl, drop.slug);
  const yuzde = Math.round(drop.dropRatio * 100);
  const fark = drop.referencePriceCents - drop.currentPriceCents;

  return (
    <Link
      href={`/urun/${drop.slug}`}
      className="card-link group flex h-full flex-col overflow-hidden"
    >
      <div className="relative aspect-4/3 overflow-hidden bg-surface-photo">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            className="h-full w-full object-contain transition-transform duration-200 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <ProductPlaceholder seed={drop.slug} />
        )}

        {/*
          Zemin açık yeşil (--success #4ade80); üstüne beyaz yazı kontrast
          eşiğini geçmez. Koyu metin OfferRow'daki "en iyi teklif" rozetiyle
          aynı yolu izliyor.
        */}
        <span className="absolute left-2 top-2 rounded-full bg-success px-2 py-0.5 text-2xs font-bold text-on-success">
          %{yuzde} düştü
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="clamp-2 text-sm font-semibold leading-snug text-fg">{drop.title}</h3>

        <div className="mt-auto pt-3">
          <p className="tabular text-lg font-extrabold leading-none text-fg">
            {formatMoney(drop.currentPriceCents)}
          </p>

          {/*
            Referansın kaynağı cümlenin İÇİNDE yazıyor. "₺X yerine" demek
            kimin fiyatı olduğunu belirsiz bırakırdı.
          */}
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Son {drop.observedDays > 0 ? `${drop.observedDays} günde` : 'ölçümlerimizde'}{' '}
            gördüğümüz en yüksek fiyat{' '}
            <span className="tabular font-semibold text-fg">
              {formatMoney(drop.referencePriceCents)}
            </span>
            {fark > 0 && <> — aradaki fark {formatMoney(fark)}.</>}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {drop.offerCount > 1 && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-fg">
                {drop.offerCount} mağaza
              </span>
            )}
            {/* Kısa gözlem penceresi saklanmaz; kullanıcı ne kadar
                dayanaklı bir iddia okuduğunu bilmeli. */}
            {drop.observedDays < 7 && (
              <span className="text-subtle">kısa gözlem ({drop.observedDays} gün)</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
