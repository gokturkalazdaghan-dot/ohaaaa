'use client';

/**
 * Favoriler.
 *
 * Tarayıcıda tutulur. Oturum açmayı zorunlu kılmak, bir ürünü işaretlemek
 * gibi küçük bir eylem için fazla yüksek bir bariyer; oturum açmadan da
 * çalışması gerekiyor.
 *
 * KAYDEDİLDİĞİ ANDAKİ FİYAT DA SAKLANIR. Bir fiyat karşılaştırma sitesinde
 * favori listesinin asıl değeri budur: kullanıcı "işaretlediğimden beri ne
 * oldu" sorusunun cevabını görür. Fiyat listeye girdiği andaki gerçek
 * değerdir — sonradan uydurulmaz.
 */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'ohaaaa-favoriler';

/** Üst sınır. Sınırsız bir liste hem kullanışsız hem de depoyu şişirir. */
const MAX_ITEMS = 100;

export interface FavoriteProduct {
  slug: string;
  title: string;
  imageUrl: string | null;
  /** Listeye eklendiği andaki en düşük fiyat (kuruş). */
  savedPriceCents: number | null;
  /** Eklenme zamanı (ms). */
  savedAt: number;
}

export function isFavorite(list: FavoriteProduct[], slug: string): boolean {
  return list.some((item) => item.slug === slug);
}

/** Ekler ya da çıkarır; yeni durumu döner. */
export function toggleFavorite(product: Omit<FavoriteProduct, 'savedAt'>): boolean {
  try {
    const current = readList();
    const exists = current.some((item) => item.slug === product.slug);

    const next = exists
      ? current.filter((item) => item.slug !== product.slug)
      : [{ ...product, savedAt: Date.now() }, ...current].slice(0, MAX_ITEMS);

    write(next);
    return !exists;
  } catch {
    return false;
  }
}

export function removeFavorite(slug: string): void {
  try {
    write(readList().filter((item) => item.slug !== slug));
  } catch {
    // Depolama kapalıysa yapacak bir şey yok; bu bir kolaylık özelliği.
  }
}

export function useFavorites(): FavoriteProduct[] {
  return useSyncExternalStore(subscribe, readCached, () => EMPTY);
}

const EMPTY: FavoriteProduct[] = [];

/*
 * `useSyncExternalStore` anlık görüntüyü referans eşitliğiyle karşılaştırır.
 * Her okumada yeni dizi üretmek sonsuz render döngüsü kurar; ham metin
 * değişmedikçe AYNI dizi döndürülür.
 */
let cachedRaw: string | null = null;
let cachedList: FavoriteProduct[] = EMPTY;

function readCached(): FavoriteProduct[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }

  if (raw === cachedRaw) return cachedList;

  cachedRaw = raw;
  cachedList = parse(raw);
  return cachedList;
}

function readList(): FavoriteProduct[] {
  try {
    return [...parse(localStorage.getItem(STORAGE_KEY))];
  } catch {
    return [];
  }
}

function write(list: FavoriteProduct[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  // `storage` olayı yalnızca DİĞER sekmelerde tetiklenir; bu sekmedeki
  // bileşenlerin de haberi olmalı.
  window.dispatchEvent(new Event('ohaaaa:favoriler'));
}

/**
 * Depodaki değeri güvenle çözer.
 *
 * localStorage'a eski bir sürüm, bir eklenti ya da elle müdahale herhangi
 * bir şey yazmış olabilir. Bozuk kayıt yüzünden sayfanın çökmesi kabul
 * edilemez; tanınmayan her şey atılır.
 */
function parse(raw: string | null): FavoriteProduct[] {
  if (!raw) return EMPTY;

  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;

    const items = value.filter((item): item is FavoriteProduct => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.slug === 'string' && typeof candidate.title === 'string';
    });

    return items.length > 0 ? items.slice(0, MAX_ITEMS) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('ohaaaa:favoriler', onChange);
  window.addEventListener('storage', onChange);

  return () => {
    window.removeEventListener('ohaaaa:favoriler', onChange);
    window.removeEventListener('storage', onChange);
  };
}
