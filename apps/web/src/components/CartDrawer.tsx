'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { formatMoney } from '@ohaaaa/shared';

import { ArrowRightIcon, CartIcon, MinusIcon, PlusIcon, StoreIcon, TrashIcon, TruckIcon } from './Icons';
import { useCart, useCartSummary } from '@/store/cart';

/**
 * Yandan açılan sepet paneli.
 *
 * Sepet, taşeron bazında GRUPLANMIŞ gösterilir. Bu, split-cart modelinin
 * kullanıcıya yansımasıdır: "3 ürün aldım ama 2 ayrı kargo geliyor" bilgisi
 * ödeme adımında sürpriz olmamalıdır.
 *
 * NEDEN <dialog>?
 * Panel `aria-modal="true"` diyordu ama ODAK TUZAĞI YOKTU: sekme tuşuyla
 * arkadaki sayfaya geçilebiliyordu. Ekran okuyucuya "burası kipli bir
 * pencere" deyip odağı serbest bırakmak, hiçbir şey dememekten kötüdür —
 * kullanıcı kapatamadığı bir yerde olduğunu sanır.
 *
 * `<dialog open>` yerine `showModal()` kullanılır. Yalnızca `showModal()`
 * odak tuzağını, arka planın etkisizleştirilmesini (inert), ESC ile
 * kapanmayı ve `::backdrop` katmanını verir; `open` özniteliği bunların
 * hiçbirini getirmez.
 *
 * Çıkış animasyonu da bu sayede mümkün: React öğeyi anında sökerse
 * animasyon çalışamaz. `display`/`overlay` geçişleri `allow-discrete` ile
 * tarayıcıya bırakılır — ve geçiş (keyframe değil) olduğu için kullanıcı
 * kapanırken tekrar açarsa hareket bulunduğu yerden geri döner.
 */
export function CartDrawer() {
  const isOpen = useCart((state) => state.isOpen);
  const close = useCart((state) => state.close);
  const remove = useCart((state) => state.remove);
  const setQuantity = useCart((state) => state.setQuantity);
  const summary = useCartSummary();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Açılış/kapanış tarayıcıya bırakılır; React yalnızca hangi durumda
  // olunacağını söyler.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  /*
   * ESC ve `::backdrop` tıklaması tarayıcının kendi kapatma yollarıdır ve
   * React durumunu güncellemezler. `close` olayı ikisini de yakalar —
   * kendi tuş dinleyicimizi yazmak, platformun zaten yaptığı işi ikinci
   * kez ve daha kötü yapmak olurdu.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onClose = () => close();
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, [close]);

  // Arka planın kayması engellenir: showModal() bunu her tarayıcıda yapmaz.
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return (
    <dialog ref={dialogRef} className="cart-dialog" aria-label="Sepet">
      {/*
        Örtü tıklaması. `::backdrop` doğrudan tıklama almadığı için panelin
        arkasında tam ekran bir düğme durur; ekran okuyucuda gizli değildir,
        çünkü "kapat" gerçek bir eylemdir.
      */}
      <button
        type="button"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default"
        aria-label="Sepeti kapat"
        tabIndex={-1}
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-line bg-bg-elevated shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CartIcon className="h-5 w-5 text-brand" />
            Sepetim
            <span className="text-sm font-normal text-muted">({summary.itemCount})</span>
          </h2>
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-hover hover:text-fg"
          >
            Kapat
          </button>
        </header>

        {summary.groups.length === 0 ? (
          <EmptyCart onClose={close} />
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {summary.groups.map((group) => (
                <section key={group.vendorId} className="rounded-2xl border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                      <StoreIcon className="h-4 w-4 text-brand" />
                      {group.vendorName}
                    </span>
                    <span className="text-2xs text-subtle">
                      {group.estimatedDeliveryDays} günde kargoda
                    </span>
                  </div>

                  <ul className="divide-y divide-line">
                    {group.items.map((item) => (
                      <li key={item.productId} className="flex gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm text-fg">{item.title}</p>
                          <p className="tabular mt-1 text-sm font-semibold text-fg">
                            {formatMoney(item.priceCents)}
                          </p>

                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex items-center rounded-lg border border-line">
                              <button
                                type="button"
                                onClick={() => setQuantity(item.productId, item.quantity - 1)}
                                className="grid h-7 w-7 place-items-center text-muted hover:text-fg"
                                aria-label="Adet azalt"
                              >
                                <MinusIcon className="h-3.5 w-3.5" />
                              </button>
                              <span className="tabular w-8 text-center text-sm">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => setQuantity(item.productId, item.quantity + 1)}
                                disabled={item.quantity >= item.maxStock}
                                className="grid h-7 w-7 place-items-center text-muted hover:text-fg disabled:opacity-35"
                                aria-label="Adet artır"
                              >
                                <PlusIcon className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => remove(item.productId)}
                              className="grid h-7 w-7 place-items-center rounded-lg text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                              aria-label={`${item.title} ürününü sepetten çıkar`}
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <span className="tabular shrink-0 text-sm font-semibold">
                          {formatMoney(item.priceCents * item.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex items-center justify-between border-t border-line pt-3 text-xs">
                    <span className="flex items-center gap-1.5 text-muted">
                      <TruckIcon className="h-4 w-4" />
                      {group.shippingCents === 0 ? (
                        <span className="text-success">Ücretsiz kargo</span>
                      ) : (
                        <span>Kargo {formatMoney(group.shippingCents)}</span>
                      )}
                    </span>
                    <span className="tabular font-semibold text-fg">
                      {formatMoney(group.totalCents)}
                    </span>
                  </div>

                  {group.freeShippingRemainingCents !== null && (
                    <p className="mt-2 rounded-lg bg-brand/10 px-3 py-2 text-2xs text-brand-soft">
                      {formatMoney(group.freeShippingRemainingCents)} daha ekleyin, kargo bedava
                      olsun.
                    </p>
                  )}
                </section>
              ))}
            </div>

            <footer className="border-t border-line bg-surface px-5 py-4">
              {summary.vendorCount > 1 && (
                <p className="mb-3 rounded-lg border border-brand/25 bg-brand/10 px-3 py-2 text-2xs text-brand-soft">
                  Siparişiniz {summary.vendorCount} mağazaya bölünecek ve{' '}
                  {summary.vendorCount} ayrı kargo ile gelecek.
                </p>
              )}

              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between text-muted">
                  <dt>Ara toplam</dt>
                  <dd className="tabular">{formatMoney(summary.itemsSubtotalCents)}</dd>
                </div>
                <div className="flex justify-between text-muted">
                  <dt>Kargo</dt>
                  <dd className="tabular">
                    {summary.shippingTotalCents === 0
                      ? 'Ücretsiz'
                      : formatMoney(summary.shippingTotalCents)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-base font-bold text-fg">
                  <dt>Toplam</dt>
                  <dd className="tabular">{formatMoney(summary.grandTotalCents)}</dd>
                </div>
              </dl>

              <Link
                href="/odeme"
                onClick={close}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl press bg-brand-cta px-5 py-3 font-semibold text-white"
              >
                Ödemeye geç
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </footer>
          </>
        )}
      </aside>
    </dialog>
  );
}

function EmptyCart({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-surface-2 text-subtle">
        <CartIcon className="h-8 w-8" />
      </div>
      <div>
        <p className="font-semibold text-fg">Sepetiniz boş</p>
        <p className="mt-1 text-sm text-muted">
          Aradığınız ürünü onlarca mağazada karşılaştırın, en ucuzunu sepete ekleyin.
        </p>
      </div>
      <Link
        href="/arama"
        onClick={onClose}
        className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-brand/50"
      >
        Ürünlere göz at
      </Link>
    </div>
  );
}
