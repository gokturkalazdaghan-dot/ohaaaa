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
