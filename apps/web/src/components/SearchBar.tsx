'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { SearchIcon } from './Icons';

const SUGGESTIONS = ['iPhone 15', 'kulaklık', 'airfryer', 'koşu ayakkabısı', 'süpürge'];

/**
 * Arama çubuğu.
 *
 * `size="hero"` ana sayfadaki devasa varyanttır; üst barda `compact` kullanılır.
 * Form gönderimi normal navigasyon üretir — böylece arama sonuçları SSR ile
 * gelir, paylaşılabilir bir URL'e sahip olur ve arama motorlarınca taranır.
 */
export function SearchBar({
  size = 'compact',
  autoFocus = false,
}: {
  size?: 'hero' | 'compact';
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    const query = value.trim();
    router.push(query ? `/arama?q=${encodeURIComponent(query)}` : '/arama');
  }

  const isHero = size === 'hero';

  return (
    <div className={isHero ? 'w-full' : 'w-full max-w-xl'}>
      <form onSubmit={submit} role="search" className="relative">
        {/* Gradyan çerçeve: odaklandığında parlar. */}
        <div
          className={`group relative rounded-2xl bg-gradient-to-r from-brand/60 via-electric/50 to-cyan/40 transition-all duration-300 focus-within:from-brand focus-within:via-electric focus-within:to-cyan ${
            isHero ? 'p-[2px] focus-within:shadow-[var(--glow-brand)]' : 'p-px'
          }`}
        >
          <div
            className={`flex items-center gap-3 rounded-2xl bg-bg-elevated ${
              isHero ? 'px-5 py-4' : 'px-4 py-2.5'
            }`}
          >
            <SearchIcon className={isHero ? 'h-6 w-6 text-muted' : 'h-5 w-5 text-muted'} />

            <input
              type="search"
              name="q"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus={autoFocus}
              placeholder={
                isHero ? 'Ne arıyorsun? 12 milyon üründe fiyat karşılaştır…' : 'Ürün ara…'
              }
              aria-label="Ürün ara"
              className={`w-full bg-transparent text-fg outline-none placeholder:text-subtle ${
                isHero ? 'text-lg' : 'text-sm'
              }`}
            />

            <button
              type="submit"
              className={`shrink-0 rounded-xl bg-gradient-to-r from-brand to-electric font-semibold text-white transition-transform hover:scale-[1.03] active:scale-95 ${
                isHero ? 'px-6 py-2.5 text-base' : 'px-4 py-1.5 text-sm'
              }`}
            >
              Ara
            </button>
          </div>
        </div>
      </form>

      {isHero && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">Popüler:</span>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                setValue(suggestion);
                router.push(`/arama?q=${encodeURIComponent(suggestion)}`);
              }}
              className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:border-brand/50 hover:text-fg"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
