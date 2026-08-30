'use client';

import { useEffect, useRef, useState } from 'react';

import { BarcodeIcon, SearchIcon, StoreIcon } from './Icons';

export interface Suggestion {
  suggestion: string;
  kind: 'marka' | 'kategori' | 'urun';
  slug: string | null;
  resultCount: number;
}

/**
 * Yazarken tamamlama listesi.
 *
 * ERİŞİLEBİLİRLİK: combobox kalıbı uygulanır (`aria-controls`, `aria-expanded`,
 * `aria-activedescendant`). Öneri listesi klavyeyle gezilebilir olmadığında
 * fare kullanamayan ziyaretçi için arama kutusu tamamen kör kalır — ve öneri
 * listesi tam olarak "ne yazacağını bilmeyen" kullanıcı için vardır.
 *
 * SEÇİM DAVRANIŞI türe göre değişir:
 *   • ürün    → doğrudan ürün sayfası (tek sonuç, ara adım gereksiz)
 *   • kategori→ kategori sayfası
 *   • marka   → metin araması (marka bir sayfa değil, bir filtredir)
 */
/** Öneri isteği için en az uzunluk: tek harfte neredeyse tüm katalog eşleşir. */
const MIN_QUERY_LENGTH = 2;

/**
 * Önerileri getirir.
 *
 * Durum bu kancada tutulur ama LİSTE ÇAĞIRANA döner: klavye gezinmesi ve
 * Enter davranışı arama kutusunun sorumluluğu, ve ikisinin aynı listeyi
 * görmesi zorunlu. Liste iki yerde ayrı tutulsaydı, kullanıcı oklarla
 * seçtiğini sanıp başka bir öneriye giderdi.
 */
export function useSearchSuggestions(query: string): Suggestion[] {
  const [items, setItems] = useState<Suggestion[]>([]);
  const latestRequest = useRef(0);

  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;

  useEffect(() => {
    if (tooShort) return;

    /*
     * Gecikmeli istek (debounce).
     *
     * Her tuş vuruşunda istek atmak hem sunucuyu hem kullanıcının veri
     * paketini boşa harcar. 180 ms, yazmayı yavaşlatmadan ardışık tuşları
     * tek isteğe indirir.
     */
    const controller = new AbortController();

    const timer = setTimeout(() => {
      const requestId = ++latestRequest.current;

      fetch(`/api/oneriler?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { data: [] }))
        .then((payload: { data?: Suggestion[] }) => {
          /*
           * Sıra dışı yanıtı yok say.
           *
           * "kul" isteği "kulaklik" isteğinden SONRA dönebilir; kontrol
           * olmasaydı liste eski sorgunun sonucunu gösterirdi. Kullanıcı
           * bunu "öneriler yanlış" olarak görür.
           */
          if (requestId === latestRequest.current) setItems(payload.data ?? []);
        })
        .catch(() => {
          if (requestId === latestRequest.current) setItems([]);
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, tooShort]);

  /*
   * Kısa sorguda liste TÜRETİLEREK boşaltılır, efekt içinde setState ile
   * değil. Efektte sıfırlamak fazladan bir render turu üretir ve bir kare
   * boyunca eski öneriler ekranda kalır — kullanıcı sildiği harfin
   * önerilerini görmeye devam eder.
   */
  return tooShort ? EMPTY : items;
}

/** Sabit boş dizi: her render'da yenisini üretmek gereksiz render tetikler. */
const EMPTY: Suggestion[] = [];

export function SearchSuggestions({
  items,
  open,
  activeIndex,
  onSelect,
  listId,
}: {
  items: Suggestion[];
  open: boolean;
  activeIndex: number;
  onSelect: (item: Suggestion) => void;
  listId: string;
}) {
  if (!open || items.length === 0) return null;

  return (
    <ul
      id={listId}
      role="listbox"
      aria-label="Arama önerileri"
      className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-line bg-bg-elevated shadow-lg"
    >
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.suggestion}`} role="none">
          <button
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            type="button"
            /*
             * onMouseDown, onClick DEĞİL: tıklama girdinin blur'undan sonra
             * gelir, o sırada liste çoktan kapanmış olur ve seçim kaybolur.
             */
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
              index === activeIndex ? 'bg-surface-2' : 'hover:bg-surface'
            }`}
          >
            <SuggestionIcon kind={item.kind} />

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg">{item.suggestion}</span>
              <span className="block text-xs text-subtle">{KIND_LABEL[item.kind]}</span>
            </span>

            <span className="tabular shrink-0 text-xs text-subtle">
              {item.kind === 'urun'
                ? `${item.resultCount} mağaza`
                : `${item.resultCount} ürün`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const KIND_LABEL: Record<Suggestion['kind'], string> = {
  marka: 'Marka',
  kategori: 'Kategori',
  urun: 'Ürün',
};

function SuggestionIcon({ kind }: { kind: Suggestion['kind'] }) {
  const className = 'h-4 w-4 shrink-0 text-subtle';

  if (kind === 'marka') return <StoreIcon className={className} />;
  if (kind === 'kategori') return <BarcodeIcon className={className} />;
  return <SearchIcon className={className} />;
}
