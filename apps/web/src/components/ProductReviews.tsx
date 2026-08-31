/**
 * Ürün değerlendirmeleri bölümü.
 *
 * Hiç yorum yoksa bölüm KENDİNİ ÇİZMEZ. Boş bir "Henüz değerlendirme yok"
 * kutusu, sayfaya bilgi eklemeyip yalnızca yer kaplar ve ürünü terk edilmiş
 * gösterir.
 */
import type { ProductReview } from '@/data/catalog';

import { Stars } from './Stars';
import { CheckIcon } from './Icons';

export function ProductReviews({
  reviews,
  rating,
  ratingCount,
}: {
  reviews: ProductReview[];
  rating: number;
  ratingCount: number;
}) {
  if (ratingCount === 0 || reviews.length === 0) return null;

  return (
    <section className="mt-12" aria-labelledby="degerlendirmeler">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
        <h2 id="degerlendirmeler" className="text-xl font-bold tracking-tight text-fg">
          Değerlendirmeler
        </h2>
        <Stars rating={rating} count={ratingCount} size="md" />
      </div>

      <ul className="mt-5 space-y-4">
        {reviews.map((review) => (
          <li key={review.id} className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Stars rating={review.productRating} />
              {/*
                "Doğrulanmış alım" bir süs değil: bu sitede yorum yazmak
                YALNIZCA teslim almış alıcıya açık, dolayısıyla her yorum
                doğrulanmıştır ve bunu söylemek okuyana ne kadar
                güvenebileceğini anlatır.
              */}
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-2xs font-semibold text-success">
                <CheckIcon className="h-3 w-3" />
                Doğrulanmış alım
              </span>
              <span className="text-xs text-muted">{review.authorLabel}</span>
              <time
                dateTime={review.createdAt}
                className="text-xs text-subtle"
              >
                {new Date(review.createdAt).toLocaleDateString('tr-TR', {
                  year: 'numeric',
                  month: 'long',
                })}
              </time>
            </div>

            {review.title && (
              <p className="mt-3 font-semibold text-fg">{review.title}</p>
            )}
            {review.body && (
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{review.body}</p>
            )}

            {/* Satıcı puanı AYRI gösterilir: ürün iyi ama kargo kötü olabilir
                ve alıcının ikisini ayırt edebilmesi gerekir. */}
            {review.vendorName && (
              <p className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
                <span>{review.vendorName} satıcı puanı:</span>
                <Stars rating={review.vendorRating} />
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
