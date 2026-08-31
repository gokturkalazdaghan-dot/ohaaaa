/**
 * Yıldız gösterimi.
 *
 * Puan RENKLE DEĞİL, sayıyla da anlatılır: beş turuncu yıldızı dört turuncu
 * bir griden ayırmak, düşük görme keskinliğinde ya da renk körlüğünde
 * güvenilir değildir. Yıldızlar `aria-hidden`, gerçek bilgi metinde.
 *
 * Yarım yıldız çizilmiyor: 4,3 puanı 4,5 yıldızla göstermek, olmayan bir
 * kesinlik iddiasıdır. Dolu yıldız sayısı yuvarlanır, kesin değer yanında
 * rakamla yazılır.
 */
import { StarIcon } from './Icons';

export function Stars({
  rating,
  count,
  size = 'sm',
}: {
  rating: number;
  /** Değerlendirme sayısı. Verilmezse yalnızca puan gösterilir. */
  count?: number;
  size?: 'sm' | 'md';
}) {
  const filled = Math.round(rating);
  const box = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <StarIcon
            key={i}
            className={`${box} ${i <= filled ? 'text-brand' : 'text-subtle opacity-40'}`}
          />
        ))}
      </span>
      <span className="tabular text-sm font-semibold text-fg">
        {rating.toFixed(1)}
      </span>
      {count !== undefined && (
        <span className="text-xs text-muted">
          ({count} değerlendirme)
        </span>
      )}
    </span>
  );
}
