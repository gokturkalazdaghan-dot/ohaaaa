import {
  assessDiscountClaim,
  formatMoney,
  summarizePriceHistory,
  type PricePoint,
} from '@ohaaaa/shared';

/**
 * Fiyat geçmişi bölümü.
 *
 * NEDEN ÖNCE CÜMLE, SONRA GRAFİK?
 * Ziyaretçinin sorusu "bu indirim gerçek mi". Bunun cevabı bir eğri değil,
 * bir cümledir. Grafik cevabı DESTEKLER; kendi başına bırakılırsa okuyucu
 * kendi yorumunu yapmak zorunda kalır ve çoğu yapmaz.
 *
 * NE SÖYLEMEYİZ
 * Yeterli gözlem yoksa hiçbir şey. Üç günlük veriyle "en düşük fiyat" demek
 * yanlış olur; satıcının indirim iddiasını üç günle çürütmek ise haksızlık.
 * Eşik packages/shared içinde (MIN_OBSERVED_DAYS) ve orada test ediliyor.
 */
export function PriceHistory({
  points,
  currentCents,
  compareAtCents,
}: {
  points: PricePoint[];
  currentCents: number;
  compareAtCents: number | null;
}) {
  const summary = summarizePriceHistory(points, currentCents);
  if (!summary.available) return null;

  const claim = assessDiscountClaim(compareAtCents, points);

  return (
    <section className="card p-5" aria-labelledby="fiyat-gecmisi-baslik">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="fiyat-gecmisi-baslik" className="text-sm font-bold text-fg">
          Fiyat geçmişi
        </h2>
        <span className="text-xs text-subtle">son {summary.observedDays} gün</span>
      </div>

      {/* --- Asıl mesaj --- */}
      <p className="mt-3 text-sm leading-relaxed text-fg">
        {summary.isAtLowest ? (
          <>
            Şu anki fiyat, <strong>gözlediğimiz en düşük fiyat</strong>.
          </>
        ) : (
          <>
            Gözlediğimiz en düşük fiyat{' '}
            <strong className="tabular">{formatMoney(summary.lowestCents)}</strong> idi;
            şu anki fiyat bunun <strong>%{summary.aboveLowestPercent}</strong> üstünde.
          </>
        )}
      </p>

      {claim.kind === 'overstated' && (
        <p className="mt-2 rounded-lg bg-warning/[0.08] p-3 text-xs leading-relaxed text-fg">
          Satıcı eski fiyatı{' '}
          <span className="tabular">{formatMoney(claim.referenceCents)}</span> gösteriyor,
          ancak son 30 günde bu ürünü{' '}
          <span className="tabular">{formatMoney(claim.lowest30Cents)}</span>&apos;e kadar
          gördük. İndirim, etikette yazandan küçük olabilir.
        </p>
      )}

      <Sparkline points={points} lowest={summary.lowestCents} highest={summary.highestCents} />

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          ['En düşük', summary.lowestCents],
          ['Ortalama', summary.averageCents],
          ['En yüksek', summary.highestCents],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg bg-surface-2 px-2 py-2">
            <dt className="text-[11px] text-muted">{label}</dt>
            <dd className="tabular mt-0.5 text-sm font-bold text-fg">
              {formatMoney(value as number)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-subtle">
        Geçmiş, bu ürünü izlemeye başladığımızdan bu yana kendi gözlemlerimize
        dayanır. Gözlemediğimiz dönemler için fiyat üretmiyoruz.
      </p>
    </section>
  );
}

/**
 * Basit alan grafiği.
 *
 * Eksen etiketi yok: 90 güne kadar veri, 300 piksel genişlikte okunabilir
 * etiket almaz. Sayısal cevap zaten üstteki cümlede ve alttaki üç kutuda.
 * Grafiğin işi eğilimi göstermek.
 */
function Sparkline({
  points,
  lowest,
  highest,
}: {
  points: PricePoint[];
  lowest: number;
  highest: number;
}) {
  const W = 300;
  const H = 56;
  const span = Math.max(highest - lowest, 1);

  const xy = points.map((p, i) => {
    const x = points.length === 1 ? W : (i / (points.length - 1)) * W;
    const y = H - ((p.minPriceCents - lowest) / span) * (H - 6) - 3;
    return [x, y] as const;
  });

  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-4 h-14 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Fiyat eğrisi: en düşük ${formatMoney(lowest)}, en yüksek ${formatMoney(highest)}.`}
    >
      <path d={area} fill="var(--brand)" opacity="0.10" />
      <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
