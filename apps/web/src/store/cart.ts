'use client';

/**
 * Sepet durumu (istemci tarafı).
 *
 * Sepet tarayıcıda tutulur: oturum açmadan alışverişe başlayabilmek dönüşüm
 * oranını doğrudan etkiler. Kalıcılık localStorage üzerindendir.
 *
 * GÜVENLİK NOTU: Buradaki fiyatlar yalnızca GÖSTERİM içindir. Sipariş
 * oluşturulurken sunucudaki create_order() fonksiyonu fiyatları veritabanından
 * yeniden okur; istemcinin gönderdiği tutara asla güvenilmez.
 */

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  addToCart as addItem,
  removeFromCart as removeItem,
  summarizeCart,
  updateQuantity as setItemQuantity,
  type CartItem,
  type CartSummary,
} from '@ohaaaa/shared';

interface CartState {
  items: CartItem[];
  /** Sepet paneli açık mı? */
  isOpen: boolean;
  /**
   * localStorage okunduktan sonra true olur.
   * Sunucu HTML'i boş sepetle render edildiği için, bu bayrak olmadan
   * ilk boyamada sunucu ve istemci çıktısı uyuşmaz (hydration hatası).
   */
  hydrated: boolean;

  /** Rehidrasyon bittiğinde çağrılır. */
  setHydrated: () => void;
  add: (item: CartItem) => void;
  remove: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
  summary: () => CartSummary;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,
      hydrated: false,

      setHydrated: () => set({ hydrated: true }),
      add: (item) => set((state) => ({ items: addItem(state.items, item), isOpen: true })),
      remove: (productId) => set((state) => ({ items: removeItem(state.items, productId) })),
      setQuantity: (productId, quantity) =>
        set((state) => ({ items: setItemQuantity(state.items, productId, quantity) })),
      clear: () => set({ items: [], isOpen: false }),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),

      summary: () => summarizeCart(get().items),
    }),
    {
      name: 'ohaaaa-cart',
      version: 1,
      // `isOpen` ve `hydrated` kalıcı olmamalı: sayfa yenilendiğinde
      // panel kendiliğinden açılmasın.
      partialize: (state) => ({ items: state.items }),
      /*
       * DİKKAT — buradaki geri çağırım `useCart`i KULLANAMAZ.
       *
       * zustand'ın persist eklentisi, senkron bir depo (localStorage) ile
       * rehidrasyonu `create()` çağrısının İÇİNDE yapar. Yani bu geri çağırım,
       * `const useCart = ...` ataması daha tamamlanmadan çalışır ve o değişken
       * hâlâ TDZ'dedir. Önceki hali `useCart.setState({ hydrated: true })`
       * diyordu; bu istisna eklenti tarafından yutuluyor, `hydrated` sonsuza
       * dek `false` kalıyordu.
       *
       * Sonuç sessiz ve ağırdı: ürün localStorage'a yazılıyor ama sepet
       * arayüzde hep boş görünüyor, başlıkta sayaç çıkmıyor ve ödemeye
       * geçilemiyordu — sayfa yenilense bile.
       *
       * Doğrusu, eklentinin geri çağırıma verdiği `state` üzerinden gitmektir.
       */
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          // Depo okunamadıysa (gizli sekme, kapalı çerezler) sepet boş
          // başlar — ama arayüz kilitlenmemeli.
          console.warn('Sepet geri yüklenemedi:', error);
        }
        state?.setHydrated();
      },
    },
  ),
);

/**
 * İlk render'dan sonra true olur. Sunucuda ve istemcinin İLK boyamasında
 * false'tur; ikisi de aynı çıktıyı üretir, hidrasyon uyuşmazlığı olmaz.
 */
function useMounted(): boolean {
  // `useEffect` + `setState` yerine `useSyncExternalStore`: aynı sonucu
  // fazladan bir render turu üretmeden verir. Abone olunacak bir kaynak yok
  // (değer bir kez false'tan true'ya geçer), bu yüzden `subscribe` boştur.
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}

/** Değişmeyen bir değerin aboneliği: hiçbir zaman haber vermez. */
function subscribeNothing(): () => void {
  return () => {};
}

/**
 * Sepet özetini, rehidrasyon tamamlanana kadar boş döndürür.
 * Böylece sunucu ve istemci ilk render'da aynı çıktıyı üretir.
 *
 * `hydrated` YA DA `mounted` yeterlidir. İkinci koşul bir emniyet kemeri:
 * rehidrasyon geri çağırımı hiç çalışmazsa (depo erişilemez, eklenti bir
 * istisnayı yutar) `hydrated` sonsuza dek false kalır ve sepet arayüzde
 * ölür — ürün eklenir, sayaç çıkmaz, ödemeye geçilemez. Bu tam olarak
 * yaşanan hataydı. `mounted` takılıp kalamaz.
 */
export function useCartSummary(): CartSummary {
  const items = useCart((state) => state.items);
  const hydrated = useCart((state) => state.hydrated);
  const mounted = useMounted();

  return summarizeCart(hydrated || mounted ? items : []);
}
