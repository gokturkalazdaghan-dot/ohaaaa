'use client';

import { useState } from 'react';

import { formatMoney, formatMoneyCompact } from '@ohaaaa/shared';

/**
 * Günlük ciro grafiği.
 *
 * FORM SEÇİMİ: Günler ayrık (discrete) birimlerdir ve her günün büyüklüğü
 * karşılaştırılır — bu bir "magnitude" işidir, dolayısıyla çubuk grafik.
 * Çizgi grafik günler arasında süreklilik ima ederdi.
 *
 * RENK: Tek seri olduğu için kategorik palet gerekmez; marka moru tek hue
 * olarak kullanılır ve gösterge (legend) kutusuna gerek yoktur — başlık
 * serinin ne olduğunu zaten söyler.
 *
 * ERİŞİLEBİLİRLİK: Grafik yalnızca görsel bir katmandır; altındaki tablo
 * görünümü aynı veriyi ekran okuyucu ve klavye için erişilebilir kılar.
 */
export function RevenueChart({
  data,
}: {
  data: Array<{ day: string; revenueCents: number; orderCount: number }>;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) return null;

  const maxRevenue = Math.max(...data.map((point) => point.revenueCents));
  const peakIndex = data.findIndex((point) => point.revenueCents === maxRevenue);

  // Görünüm kutusu (viewBox) koordinatları; CSS ile ölçeklenir.
  const width = 720;
  const height = 200;
  const gap = 2; // Bitişik çubuklar arasında 2px yüzey boşluğu.
  const plotHeight = height - 8;
  const barWidth = Math.max(2, width / data.length - gap);

  // Izgara çizgileri, ÖLÇEKLE aynı orana oturur ve etiketlenir. Etiketsiz
  // ızgara, veri gibi görünen bir süstür — okuyucuya hiçbir şey söylemez.
  const gridRatios = [0.5, 1];

  return (
    <div>
      {/* Eksen etiketleri kendi sol kolonunda durur; çizim alanının üstüne
          binmeleri ilk günlerin çubuklarını okunamaz hâle getirirdi. */}
      <div className="relative pl-14">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12">
          {gridRatios.map((ratio) => (
            <span
              key={ratio}
              className="tabular absolute right-0 -translate-y-1/2 text-[10px] text-subtle"
              style={{ top: `${(1 - (ratio * plotHeight) / height) * 100}%` }}
            >
              {formatMoneyCompact(maxRevenue * ratio)}
            </span>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-52 w-full"
          role="img"
          aria-label={`Son ${data.length} günün günlük ciro grafiği. En yüksek gün: ${formatMoney(maxRevenue)}.`}
          preserveAspectRatio="none"
        >
          {gridRatios.map((ratio) => (
            <line
              key={ratio}
              x1={0}
              x2={width}
              y1={height - ratio * plotHeight}
              y2={height - ratio * plotHeight}
              stroke="var(--line)"
              strokeWidth={1}
              strokeDasharray="3 5"
            />
          ))}

          {data.map((point, index) => {
            const barHeight = Math.max(2, (point.revenueCents / maxRevenue) * plotHeight);
            const x = index * (barWidth + gap);
            const y = height - barHeight;
            const isPeak = index === peakIndex;
            const isHovered = hovered === index;

            return (
              <rect
                key={point.day}
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                /* Veri ucunda 4px yuvarlatma; taban çizgisine sabitli. */
                rx={Math.min(4, barWidth / 2)}
                fill="var(--brand)"
                opacity={hovered === null ? (isPeak ? 1 : 0.55) : isHovered ? 1 : 0.28}
                className="transition-opacity duration-150"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
        </svg>

        {/* İşaretçiden büyük isabet alanları: fare hedefi çubuk genişliğine
            bağlı kalmasın (2-3px çubuklarda üzerine gelmek imkânsız olurdu). */}
        <div className="absolute inset-y-0 right-0 left-14 flex">
          {data.map((point, index) => (
            <button
              key={point.day}
              type="button"
              className="h-full flex-1 cursor-default"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              aria-label={`${formatDay(point.day)}: ${formatMoney(point.revenueCents)}, ${point.orderCount} sipariş`}
            />
          ))}
        </div>

        {hovered !== null && data[hovered] && (
          <Tooltip point={data[hovered]!} index={hovered} total={data.length} />
        )}
      </div>

      <div className="mt-2 flex justify-between pl-14 text-[11px] text-subtle">
        <span>{formatDay(data[0]!.day)}</span>
        <span>{formatDay(data[data.length - 1]!.day)}</span>
      </div>

      {/* Tablo görünümü — grafik verisinin erişilebilir karşılığı. */}
      <details className="mt-4 group">
        <summary className="cursor-pointer text-xs text-muted transition-colors hover:text-fg">
          Veriyi tablo olarak gör
        </summary>
        <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-line">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-muted">Gün</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-muted">Ciro</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-muted">Sipariş</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...data].reverse().map((point) => (
                <tr key={point.day}>
                  <td className="px-3 py-1.5">{formatDay(point.day)}</td>
                  <td className="tabular px-3 py-1.5 text-right">{formatMoney(point.revenueCents)}</td>
                  <td className="tabular px-3 py-1.5 text-right">{point.orderCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Tooltip({
  point,
  index,
  total,
}: {
  point: { day: string; revenueCents: number; orderCount: number };
  index: number;
  total: number;
}) {
  const ratio = index / Math.max(total - 1, 1);

  return (
    <div
      /*
       * Kutu çizim alanının İÇİNDE, üst kenara yakın durur.
       * Önceki hali `-top-2` + `-translate-y-full` ile grafiğin tamamen
       * ÜSTÜNE çıkıyordu; panelde grafiğin hemen üstünde ciro ve komisyon
       * rakamları olduğu için ipucu onların üzerine biniyor ve okunmalarını
       * engelliyordu. Çubuklar tabandan yükseldiği için üst şerit genelde
       * boştur; kutunun asıl yeri orası.
       */
      className="pointer-events-none absolute top-2 z-10 rounded-xl border border-line bg-bg-elevated px-3 py-2 shadow-xl"
      style={{
        left: `${ratio * 100}%`,
        // Kenarlarda kutunun taşmasını önlemek için hizalama kaydırılır.
        transform: `translateX(${ratio < 0.15 ? '0' : ratio > 0.85 ? '-100%' : '-50%'})`,
      }}
      role="status"
    >
      <p className="text-[11px] text-muted">{formatDay(point.day)}</p>
      <p className="tabular text-sm font-bold">{formatMoney(point.revenueCents)}</p>
      <p className="tabular text-[11px] text-muted">{point.orderCount} sipariş</p>
    </div>
  );
}

function formatDay(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00`).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
  });
}
