'use client';

/**
 * Son gezilen ürünler.
 *
 * Tarayıcıda tutulur, sunucuya gönderilmez. Sebep gizlilik değil sadece:
 * gezinme geçmişi kişisel veridir ve onu saklamak için KVKK karşılığında bir
 * gerekçemiz olmalı. Kullanıcıya kolaylık sağlamak için sunucuda saklamaya
 * gerek yok — tarayıcı yeter.
 *
 * Oturum açmış kullanıcılar için sunucu tarafı bir liste ileride eklenebilir;
 * o zaman gerekçe "kendi hesabında görmek istiyor" olur ve açık rıza alınır.
 */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'ohaaaa-son-gezilen';

/** Kaç ürün hatırlanır. Uzun bir liste ne kullanışlı ne de saklamaya değer. */
const MAX_ITEMS = 12;

export interface ViewedProduct {
  slug: string;
  title: string;
  imageUrl: string | null;
  priceCents: number | null;
  /** Kayıt zamanı — sıralama için. */
  at: number;
}

/**
 * Bir ürünü listeye ekler (varsa başa taşır).
 *
 * Aynı ürün iki kez görünmemeli: kullanıcı bir ürüne üç kez baktığında listesi
 * o üründen üç kopya içermemeli, sadece en öne gelmeli.
 */
export function recordView(product: Omit<ViewedProduct, 'at'>): void {
  try {
    const current = readList().filter((item) => item.slug !== product.slug);
    const next = [{ ...product, at: Date.now() }, ...current].slice(0, MAX_ITEMS);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    // Aynı sekmedeki diğer bileşenler haberdar olsun: `storage` olayı
    // yalnızca DİĞER sekmelerde tetiklenir.
    window.dispatchEvent(new Event('ohaaaa:son-gezilen'));
  } catch {
    // Gizli sekmede ya da depolama kapalıyken yazılamaz. Bu bir kolaylık
    // özelliği; başarısızlığı kullanıcıya bildirmenin bir anlamı yok.
  }
}

/** Listeyi temizler. */
export function clearViewed(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('ohaaaa:son-gezilen'));
  } catch {
    // Yukarıdakiyle aynı.
  }
}

/**
 * Listeyi React tarafında okur.
 *
 * Sunucuda ve hidrasyon sırasında BOŞ döner; liste yalnızca tarayıcıda
 * vardır ve sunucu render'ında farklı bir şey döndürmek hidrasyon
 * uyuşmazlığı üretirdi.
 */
export function useRecentlyViewed(): ViewedProduct[] {
  return useSyncExternalStore(subscribe, readCached, () => EMPTY);
}

const EMPTY: ViewedProduct[] = [];

/*
 * `useSyncExternalStore` anlık görüntüyü referans eşitliğiyle karşılaştırır.
 * Her okumada yeni bir dizi üretmek sonsuz render döngüsü kurar; bu yüzden
 * ham metin değişmediği sürece AYNI dizi nesnesi döndürülür.
 */
let cachedRaw: string | null = null;
let cachedList: ViewedProduct[] = EMPTY;

function readCached(): ViewedProduct[] {
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

function readList(): ViewedProduct[] {
  try {
    return parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/**
 * Depodaki değeri güvenle çözer.
 *
 * localStorage'a başka bir sekmedeki eski sürüm, bir eklenti ya da elle
 * müdahale herhangi bir şey yazmış olabilir. Bozuk kayıt yüzünden sayfanın
 * çökmesi kabul edilemez; tanınmayan her şey atılır.
 */
function parse(raw: string | null): ViewedProduct[] {
  if (!raw) return EMPTY;

  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;

    const items = value.filter((item): item is ViewedProduct => {
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
  window.addEventListener('ohaaaa:son-gezilen', onChange);
  // Başka sekmede gezilen ürün burada da görünsün.
  window.addEventListener('storage', onChange);

  return () => {
    window.removeEventListener('ohaaaa:son-gezilen', onChange);
    window.removeEventListener('storage', onChange);
  };
}
