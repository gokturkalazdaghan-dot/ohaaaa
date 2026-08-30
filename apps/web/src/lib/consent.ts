'use client';

import { useSyncExternalStore } from 'react';

/**
 * Çerez onayı — tek doğruluk kaynağı.
 *
 * Onay durumu localStorage'da tutulur ve değişimi özel bir olayla yayılır.
 * Betiklerin onaydan haberdar olmasının başka bir yolu yoksa, her biri
 * kendi kontrolünü yapar ve biri unutulur.
 */

export const CONSENT_STORAGE_KEY = 'ohaaaa-consent';

export type ConsentState = 'granted' | 'denied' | 'unset';

export function readConsent(): ConsentState {
  if (typeof window === 'undefined') return 'unset';

  try {
    const value = localStorage.getItem(CONSENT_STORAGE_KEY);
    return value === 'granted' || value === 'denied' ? value : 'unset';
  } catch {
    // Gizli sekmede localStorage okunamayabilir. Onay alınamadıysa
    // varsayılan REDDEDİLMİŞ sayılır — sessizce ölçümleme yapılmaz.
    return 'unset';
  }
}

export function writeConsent(state: Exclude<ConsentState, 'unset'>): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, state);
  } catch {
    // Yazılamazsa da olayı yayımla: en azından bu oturumda geçerli olsun.
  }

  window.dispatchEvent(new CustomEvent('ohaaaa:consent', { detail: state }));
}

/**
 * Onay durumunun React tarafındaki okunuşu.
 *
 * `useEffect` + `setState` ile de yazılabilirdi, ama o kalıp her yüklemede
 * fazladan bir render turu üretir ve React'in "efekt içinde setState" uyarısını
 * tetikler. `useSyncExternalStore` tam olarak bunun için vardır: React
 * dışındaki bir kaynağı (burada localStorage) abonelikle okur.
 *
 * `'unknown'` sunucudaki VE hidrasyon öncesindeki durumdur — "onay yok" ile
 * aynı şey DEĞİLDİR. Ayrımı korumak gerekir: onay şeridi yalnızca gerçekten
 * karar verilmemişse ('unset') görünmeli. İkisi birleştirilseydi, çoktan
 * karar vermiş her ziyaretçi sayfanın ilk boyamasında şeridi bir an görürdü.
 */
export function useConsent(): ConsentState | 'unknown' {
  return useSyncExternalStore(subscribeConsent, readConsent, () => 'unknown' as const);
}

/**
 * Onay değişikliğine abone olur.
 *
 * İki kaynak dinlenir: bu sekmedeki karar (`ohaaaa:consent`) ve BAŞKA bir
 * sekmede verilen/geri alınan karar (`storage`). İkincisi olmadan, bir
 * sekmede reddedilen onay diğer sekmede ölçümlemeyi durdurmazdı.
 */
function subscribeConsent(onChange: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key === CONSENT_STORAGE_KEY) onChange();
  }

  window.addEventListener('ohaaaa:consent', onChange);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener('ohaaaa:consent', onChange);
    window.removeEventListener('storage', onStorage);
  };
}
