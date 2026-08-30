'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { SearchIcon } from './Icons';
import { VisualSearchButton } from './VisualSearchButton';
import { VoiceSearchButton } from './VoiceSearchButton';

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
    runSearch(value);
  }

  /** Metin aramasını çalıştırır; kutu da aynı metni gösterir. */
  function runSearch(text: string) {
    const query = text.trim();
    setValue(query);
    router.push(query ? `/arama?q=${encodeURIComponent(query)}` : '/arama');
  }

  /**
   * Barkod aramasi metin aramasindan AYRI bir parametreyle gider.
   *
   * Barkodu `q` ile göndermek onu bir metin sorgusuna çevirirdi; barkod ise
   * kesin bir kimliktir ve bulanık eşleşmeye sokulmamalı. Ayrı parametre,
   * sunucunun tam eşleşme araması ve tek sonuçta doğrudan ürüne yönlendirmesi
   * anlamına gelir.
   */
  function runBarcodeSearch(gtin: string) {
    setValue('');
    router.push(`/arama?barkod=${encodeURIComponent(gtin)}`);
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
            className={`flex items-center rounded-2xl bg-bg-elevated ${
              isHero ? 'gap-2 px-5 py-3' : 'gap-1.5 px-3 py-1.5'
            }`}
          >
            <SearchIcon
              className={isHero ? 'ml-1 h-6 w-6 text-muted' : 'ml-1 h-5 w-5 text-muted'}
            />

            <input
              type="search"
              name="q"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus={autoFocus}
              placeholder={
                'Ürün, marka veya model'
              }
              aria-label="Ürün ara"
              className={`w-full min-w-0 bg-transparent px-1 text-fg outline-none placeholder:text-subtle ${
                isHero ? 'text-lg' : 'text-sm'
              }`}
            />

            {/* Kamera ve mikrofon, gönder düğmesinin SOLUNDA: klavye sırası
                "yaz → sesle söyle → fotoğraf çek → ara" olur. Gönder düğmesi
                en sonda kalır, çünkü akışı bitiren odur. */}
            <VoiceSearchButton onResult={runSearch} compact={!isHero} />
            <VisualSearchButton
              onQuery={runSearch}
              onBarcode={runBarcodeSearch}
              compact={!isHero}
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
