'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';

import { SearchIcon } from './Icons';
import {
  SearchSuggestions,
  useSearchSuggestions,
  type Suggestion,
} from './SearchSuggestions';
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

  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [rawActiveIndex, setActiveIndex] = useState(-1);

  const suggestions = useSearchSuggestions(value);

  /*
   * Vurgulu satır liste SINIRLARINA kırpılır.
   *
   * Kullanıcı 5. öneriyi seçiliyken bir harf daha yazarsa liste kısalabilir;
   * kırpılmasaydı Enter var olmayan bir öğeyi seçmeye çalışır ya da eski
   * indeks yeni listede BAŞKA bir öneriye denk gelirdi.
   */
  const activeIndex = rawActiveIndex < suggestions.length ? rawActiveIndex : -1;

  function submit(event: FormEvent) {
    event.preventDefault();

    // Klavyeyle bir öneri vurgulanmışsa Enter onu seçer, ham metni değil.
    const active = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
    if (active) {
      selectSuggestion(active);
      return;
    }

    runSearch(value);
  }

  /**
   * Öneri seçimi.
   *
   * Tür başına farklı hedef: ürün ve kategori kendi sayfasına gider, marka
   * ise metin aramasına — marka bir sayfa değil, sonuçlar üzerinde bir
   * filtredir. Kullanıcıyı olmayan bir "marka sayfası"na göndermek 404
   * üretirdi.
   */
  function selectSuggestion(item: Suggestion) {
    setFocused(false);
    setActiveIndex(-1);

    if (item.kind === 'urun' && item.slug) {
      setValue(item.suggestion);
      router.push(`/urun/${item.slug}`);
      return;
    }

    if (item.kind === 'kategori' && item.slug) {
      setValue('');
      router.push(`/kategori/${item.slug}`);
      return;
    }

    runSearch(item.suggestion);
  }

  /** Yukarı/aşağı ok ile öneri gezinmesi, Escape ile kapatma. */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const items = suggestions;
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % items.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? items.length - 1 : current - 1));
      return;
    }

    if (event.key === 'Escape') {
      setActiveIndex(-1);
      setFocused(false);
    }
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
          className={`group relative rounded-2xl bg-gradient-to-r from-brand/60 via-electric/50 to-cyan/40 transition-colors duration-200 ease-out focus-within:from-brand focus-within:via-electric focus-within:to-cyan ${
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
              onFocus={() => setFocused(true)}
              // Kapanış GECİKTİRİLİR: öneriye tıklarken girdi önce blur olur,
              // hemen kapatılsaydı tıklama boşluğa düşerdi.
              onBlur={() => setTimeout(() => setFocused(false), 120)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={focused}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
              }
              autoComplete="off"
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
              className={`shrink-0 rounded-xl press bg-brand-cta font-semibold text-white ${
                isHero ? 'px-6 py-2.5 text-base' : 'px-4 py-1.5 text-sm'
              }`}
            >
              Ara
            </button>
          </div>
        </div>

        <SearchSuggestions
          items={suggestions}
          open={focused}
          activeIndex={activeIndex}
          onSelect={selectSuggestion}
          listId={listId}
        />
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
