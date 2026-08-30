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
      onRehydrateStorage: () => () => {
        // Rehidrasyon store oluşturulduktan sonra çalışır, bu yüzden
        // `useCart` burada güvenle kullanılabilir.
        useCart.setState({ hydrated: true });
      },
    },
  ),
);

/**
 * Sepet özetini, rehidrasyon tamamlanana kadar boş döndürür.
 * Böylece sunucu ve istemci ilk render'da aynı çıktıyı üretir.
 */
export function useCartSummary(): CartSummary {
  const items = useCart((state) => state.items);
  const hydrated = useCart((state) => state.hydrated);

  return summarizeCart(hydrated ? items : []);
}
