'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { discountPercent, formatMoney, type FlashDeal } from '@ohaaaa/shared';

import { BoltIcon } from './Icons';

/**
 * "Günün En Oha Fiyatı" modülü.
 *
 * Aciliyet iki sinyalle kurulur: geri sayım ve stok çubuğu. Geri sayım
 * istemcide çalışır; sunucuda render edilmez, çünkü sunucu saati ile
 * kullanıcı saati arasındaki fark yanlış süre gösterir.
 */
export function FlashDeals({ deals }: { deals: FlashDeal[] }) {
  if (deals.length === 0) return null;

  const [headline, ...rest] = deals;

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight sm:text-3xl">
            <BoltIcon className="h-7 w-7 text-brand" />
            <span className="text-gradient-oha">Günün En Oha Fiyatı</span>
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Gece yarısına kadar geçerli, sınırlı stoklu fırsatlar.
          </p>
        </div>

        {headline && <Countdown endsAt={headline.endsAt} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {headline && <HeadlineDeal deal={headline} />}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {rest.map((deal) => (
            <SecondaryDeal key={deal.id} deal={deal} />
          ))}
        </div>
      </div>
    </section>
  );
}

function HeadlineDeal({ deal }: { deal: FlashDeal }) {
  const percent = discountPercent(deal.dealPriceCents, deal.originalPriceCents);
  const sold = deal.stockLimit ? Math.round((deal.soldCount / deal.stockLimit) * 100) : null;

  return (
    <Link
      href={deal.groupSlug ? `/urun/${deal.groupSlug}` : '/arama'}
      className="card-glow group relative overflow-hidden p-6 transition-transform duration-150 ease-out hover:-translate-y-1 sm:p-8"
    >
      {/* Dekoratif ışıma — içerikle etkileşmez. */}
      <div
        /*
          `animate-[float_...]` sınıfı buradaydı ama `float` keyframe'i hiç
          tanımlanmamıştı — yani sonsuz bir animasyon yazılmış, hiç
          çalışmamıştı. Tanımlamak yerine KALDIRILDI: sürekli ve sonsuz bir
          arka plan hareketi, sık görülen bir öge üzerinde hiçbir şey
          anlatmaz; yalnızca dikkati fiyattan çalar ve pil harcar.
        */
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/25 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-cta px-3 py-1 text-2xs font-bold uppercase tracking-wide text-white">
          <BoltIcon className="h-3.5 w-3.5" />
          {deal.headline}
        </span>

        <h3 className="mt-5 max-w-md text-2xl font-bold leading-tight sm:text-3xl">
          {deal.title}
        </h3>

        {deal.vendorName && (
          <p className="mt-2 text-sm text-muted">Satıcı: {deal.vendorName}</p>
        )}

        <div className="mt-6 flex flex-wrap items-baseline gap-3">
          <span className="tabular text-4xl font-black text-brand">
            {formatMoney(deal.dealPriceCents)}
          </span>
          <span className="tabular text-lg text-subtle line-through">
            {formatMoney(deal.originalPriceCents)}
          </span>
          {percent !== null && (
            <span className="rounded-lg bg-success/15 px-2 py-1 text-sm font-bold text-success">
              %{percent} indirim
            </span>
          )}
        </div>

        {sold !== null && (
          <div className="mt-6 max-w-sm">
            <div className="flex justify-between text-xs text-muted">
              <span>{deal.soldCount} adet satıldı</span>
              <span>{(deal.stockLimit ?? 0) - deal.soldCount} adet kaldı</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-700"
                style={{ width: `${Math.min(sold, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}

function SecondaryDeal({ deal }: { deal: FlashDeal }) {
  const percent = discountPercent(deal.dealPriceCents, deal.originalPriceCents);

  return (
    <Link
      href={deal.groupSlug ? `/urun/${deal.groupSlug}` : '/arama'}
      className="card flex items-center gap-4 p-4 transition-[transform,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-brand/45"
    >
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand/15 text-lg font-black text-brand">
        {percent !== null ? `%${percent}` : '!'}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium">{deal.title}</p>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="tabular text-base font-bold text-brand">
            {formatMoney(deal.dealPriceCents)}
          </span>
          <span className="tabular text-xs text-subtle line-through">
            {formatMoney(deal.originalPriceCents)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Kampanya bitişine kalan süre. */
function Countdown({ endsAt }: { endsAt: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    function tick() {
      setRemaining(Math.max(0, new Date(endsAt).getTime() - Date.now()));
    }

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  // Sunucuda ve ilk boyamada boş yer tutucu: saat farkı yanlış süre göstermesin.
  if (remaining === null) {
    return <div className="h-14 w-44 rounded-xl skeleton" aria-hidden="true" />;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className="flex items-center gap-2" role="timer" aria-live="off">
      <span className="text-xs text-muted">Bitişine</span>
      {[
        { value: hours, label: 'sa' },
        { value: minutes, label: 'dk' },
        { value: seconds, label: 'sn' },
      ].map((unit) => (
        <div
          key={unit.label}
          className="flex min-w-12 flex-col items-center rounded-xl border border-brand/30 bg-brand/10 px-2 py-1.5"
        >
          <span className="tabular text-lg font-bold leading-none text-brand">
            {String(unit.value).padStart(2, '0')}
          </span>
          <span className="text-3xs text-muted">{unit.label}</span>
        </div>
      ))}
    </div>
  );
}
