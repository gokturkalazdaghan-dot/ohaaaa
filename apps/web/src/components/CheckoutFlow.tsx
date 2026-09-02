'use client';

import Link from 'next/link';
import { useState } from 'react';

import { checkoutSchema, formatMoney, toOrderPayload } from '@ohaaaa/shared';

import { Field } from './Field';
import { AlertIcon, CheckIcon, ShieldIcon, StoreIcon, TruckIcon } from './Icons';
import type { SavedAddress } from '@/data/catalog';
import { useCart, useCartSummary } from '@/store/cart';

interface VendorOrderResult {
  vendor_name: string;
  items_subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  estimated_delivery_days?: number;
  item_count?: number;
}

interface OrderResult {
  order_number: string;
  demo: boolean;
  grand_total_cents?: number;
  vendor_orders: VendorOrderResult[];
}

/**
 * Ödeme akışı.
 *
 * Ödeme SİMÜLASYONDUR: gerçek bir kart işlemi yapılmaz. Kart alanları
 * gerçekçi bir akış göstermek için vardır ve girilen değerler sunucuya
 * GÖNDERİLMEZ — kart verisi hiçbir zaman bu sistemden geçmemelidir
 * (PCI-DSS kapsamı, ödeme sağlayıcısının barındırdığı alanlarla sınırlanır).
 */
export function CheckoutFlow({ addresses = [] }: { addresses?: SavedAddress[] }) {
  const items = useCart((state) => state.items);
  const clear = useCart((state) => state.clear);
  const summary = useCartSummary();

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);

  /*
   * Seçili kayıtlı adres. Varsayılan adres ilk sırada geldiği için baştan o
   * seçilidir: en sık kullanılan adresi elle seçtirmek, defterin varlık
   * sebebini ortadan kaldırırdı. "yeni" değeri elle doldurmak demektir.
   */
  const [selectedAddressId, setSelectedAddressId] = useState<string>(
    addresses[0]?.id ?? 'yeni',
  );
  const selected = addresses.find((address) => address.id === selectedAddressId) ?? null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setErrors({});

    const formData = new FormData(event.currentTarget);

    const candidate = {
      email: String(formData.get('email') ?? ''),
      items: toOrderPayload(items),
      shipping_address: {
        full_name: String(formData.get('full_name') ?? ''),
        phone: String(formData.get('phone') ?? ''),
        city: String(formData.get('city') ?? ''),
        district: String(formData.get('district') ?? ''),
        address_line: String(formData.get('address_line') ?? ''),
      },
      notes: String(formData.get('notes') ?? '') || undefined,
    };

    const parsed = checkoutSchema.safeParse(candidate);

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        // "shipping_address.city" -> "city"
        const field = issue.path[issue.path.length - 1];
        if (typeof field === 'string') fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      setFormError('Lütfen işaretli alanları düzeltin.');
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const body = (await response.json()) as
        | { data: OrderResult }
        | { error: { message: string } };

      if (!response.ok || 'error' in body) {
        setFormError('error' in body ? body.error.message : 'Sipariş oluşturulamadı.');
        return;
      }

      setResult(body.data);
      clear();
    } catch {
      setFormError('Bağlantı hatası. Lütfen tekrar deneyin.');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) return <OrderSuccess result={result} />;

  if (summary.groups.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-line bg-surface p-10 text-center">
        <p className="font-semibold">Sepetiniz boş</p>
        <p className="mt-1.5 text-sm text-muted">Ödeme yapabilmek için önce ürün ekleyin.</p>
        <Link
          href="/arama"
          className="mt-5 inline-block rounded-xl press bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white"
        >
          Alışverişe başla
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-8 lg:grid-cols-[1.35fr_1fr]" noValidate>
      <div className="space-y-6">
        <fieldset className="card p-5">
          <legend className="px-1 text-sm font-semibold">Teslimat bilgileri</legend>

          {addresses.length > 0 && (
            <div className="mt-4">
              {/*
                Gerçek radyo düğmeleri kullanılıyor, tıklanabilir div'ler
                değil: klavyeyle ok tuşları arasında gezinmek ve ekran
                okuyucunun "3 seçenekten 1." demesi bedavaya gelir.
              */}
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Kayıtlı adreslerim
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {addresses.map((address) => (
                  <label
                    key={address.id}
                    className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm transition-colors ${
                      selectedAddressId === address.id
                        ? 'border-brand bg-brand/6'
                        : 'border-line hover:border-brand/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="kayitli_adres"
                      value={address.id}
                      checked={selectedAddressId === address.id}
                      onChange={() => setSelectedAddressId(address.id)}
                      className="mt-1 shrink-0 accent-[var(--color-brand)]"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-fg">
                        {address.label ?? address.city}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {address.fullName} · {address.district} / {address.city}
                      </span>
                    </span>
                  </label>
                ))}

                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition-colors ${
                    selectedAddressId === 'yeni'
                      ? 'border-brand bg-brand/6'
                      : 'border-line hover:border-brand/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="kayitli_adres"
                    value="yeni"
                    checked={selectedAddressId === 'yeni'}
                    onChange={() => setSelectedAddressId('yeni')}
                    className="shrink-0 accent-[var(--color-brand)]"
                  />
                  <span className="font-semibold text-fg">Yeni adres yaz</span>
                </label>
              </div>
            </div>
          )}

          {/*
            `key` seçili adresle değişir ve alanlar yeniden kurulur.
            Alanlar denetimsiz (FormData ile okunuyor); `defaultValue`
            değişmesi tek başına yazılıyı güncellemez. Anahtar olmadan
            başka bir adres seçmek, ekranda eski adresi bırakırdı --
            yani yanlış yere gönderilen bir sipariş.
          */}
          <div key={selectedAddressId} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Ad Soyad" name="full_name" required error={errors.full_name} autoComplete="name" defaultValue={selected?.fullName} />
            <Field label="Telefon" name="phone" required error={errors.phone} autoComplete="tel" placeholder="05XX XXX XX XX" defaultValue={selected?.phone} />
            <Field label="E-posta" name="email" required type="email" error={errors.email} autoComplete="email" wrapperClassName="sm:col-span-2" />
            <Field label="İl" name="city" required error={errors.city} autoComplete="address-level1" defaultValue={selected?.city} />
            <Field label="İlçe" name="district" required error={errors.district} autoComplete="address-level2" defaultValue={selected?.district} />
            <Field
              label="Açık adres"
              name="address_line"
              required
              error={errors.address_line}
              autoComplete="street-address"
              multiline
              wrapperClassName="sm:col-span-2"
              defaultValue={selected?.addressLine}
            />
            <Field label="Sipariş notu (isteğe bağlı)" name="notes" wrapperClassName="sm:col-span-2" multiline />
          </div>

          {addresses.length === 0 && (
            <p className="mt-3 text-xs text-subtle">
              Adreslerinizi{' '}
              <Link href="/adreslerim" className="text-brand hover:underline">
                adres defterine
              </Link>{' '}
              kaydederseniz bir dahaki sefere hazır gelir.
            </p>
          )}
        </fieldset>

        <fieldset className="card p-5">
          <legend className="px-1 text-sm font-semibold">Ödeme</legend>

          <p className="mt-3 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Bu bir <strong>ödeme simülasyonudur</strong>. Kart bilgileri sunucuya
              gönderilmez ve hiçbir tahsilat yapılmaz. Gerçek entegrasyonda kart alanları
              ödeme sağlayıcısının kendi güvenli çerçevesinde barındırılır.
            </span>
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Kart üzerindeki isim" name="card_name" wrapperClassName="sm:col-span-2" defaultValue="ZEYNEP YILMAZ" />
            <Field label="Kart numarası" name="card_number" wrapperClassName="sm:col-span-2" defaultValue="4242 4242 4242 4242" />
            <Field label="Son kullanma" name="card_expiry" defaultValue="12/29" />
            <Field label="CVC" name="card_cvc" defaultValue="123" />
          </div>
        </fieldset>
      </div>

      {/* Sipariş özeti — mağaza bazında bölünmüş. */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="card p-5">
          <h2 className="text-sm font-semibold">Sipariş özeti</h2>

          {summary.vendorCount > 1 && (
            <p className="mt-3 rounded-xl border border-electric/25 bg-electric/10 px-3 py-2 text-2xs text-electric-soft">
              Siparişiniz {summary.vendorCount} mağazaya bölünecek. Her mağaza kendi kargosuyla
              gönderim yapar; ürünler ayrı ayrı ulaşabilir.
            </p>
          )}

          <div className="mt-4 space-y-4">
            {summary.groups.map((group) => (
              <div key={group.vendorId} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <StoreIcon className="h-3.5 w-3.5 text-brand" />
                    {group.vendorName}
                  </span>
                  <span className="text-3xs text-subtle">
                    {group.estimatedDeliveryDays} gün
                  </span>
                </div>

                <ul className="mt-2 space-y-1">
                  {group.items.map((item) => (
                    <li key={item.productId} className="flex justify-between gap-2 text-xs text-muted">
                      <span className="line-clamp-1">
                        {item.quantity}× {item.title}
                      </span>
                      <span className="tabular shrink-0">
                        {formatMoney(item.priceCents * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-2 flex justify-between border-t border-line pt-2 text-xs">
                  <span className="flex items-center gap-1 text-muted">
                    <TruckIcon className="h-3.5 w-3.5" />
                    {group.shippingCents === 0 ? 'Ücretsiz' : formatMoney(group.shippingCents)}
                  </span>
                  <span className="tabular font-semibold">{formatMoney(group.totalCents)}</span>
                </div>
              </div>
            ))}
          </div>

          <dl className="mt-5 space-y-1.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between text-muted">
              <dt>Ara toplam</dt>
              <dd className="tabular">{formatMoney(summary.itemsSubtotalCents)}</dd>
            </div>
            <div className="flex justify-between text-muted">
              <dt>Kargo ({summary.vendorCount} gönderi)</dt>
              <dd className="tabular">
                {summary.shippingTotalCents === 0 ? 'Ücretsiz' : formatMoney(summary.shippingTotalCents)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-lg font-black">
              <dt>Toplam</dt>
              <dd className="tabular">{formatMoney(summary.grandTotalCents)}</dd>
            </div>
          </dl>

          {formError && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl press bg-brand-cta px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'İşleniyor…' : `${formatMoney(summary.grandTotalCents)} öde`}
          </button>

          {/*
            Önceki hâli "Ödemeniz ürün teslim edilene kadar güvencede" idi.
            Bu ekranın kendisi bir SİMÜLASYON: tahsilat yapılmıyor, dolayısıyla
            güvenceye alınan bir ödeme de yok. Düğmenin hemen altında, tam da
            kullanıcının kart bilgisi girmeyi düşündüğü anda söylenen bir
            yanlış, sayfadaki en pahalı yanlıştır.
          */}
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-2xs text-subtle">
            <ShieldIcon className="h-3.5 w-3.5 shrink-0" />
            Bu bir simülasyondur — tahsilat yapılmaz, kart bilgisi gönderilmez
          </p>
        </div>
      </aside>
    </form>
  );
}

function OrderSuccess({ result }: { result: OrderResult }) {
  const total = result.vendor_orders.reduce((sum, order) => sum + order.total_cents, 0);

  return (
    <div className="mx-auto mt-10 max-w-2xl">
      <div className="card-glow p-8 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success/15 text-success">
          <CheckIcon className="h-9 w-9" />
        </span>

        <h2 className="mt-5 text-2xl font-black">Siparişiniz alındı!</h2>
        <p className="mt-2 text-sm text-muted">
          Sipariş numaranız{' '}
          <span className="font-mono font-semibold text-fg">{result.order_number}</span>
        </p>

        {result.demo && (
          <p className="mt-3 inline-block rounded-lg bg-warning/10 px-3 py-1.5 text-2xs text-warning">
            Demo modu — gerçek bir tahsilat yapılmadı.
          </p>
        )}

        <div className="mt-8 space-y-3 text-left">
          <p className="text-sm font-semibold">
            Siparişiniz {result.vendor_orders.length} mağazaya bölündü:
          </p>

          {result.vendor_orders.map((vendorOrder, index) => (
            <div
              key={`${vendorOrder.vendor_name}-${index}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg press bg-brand-cta text-xs font-black text-white">
                  {vendorOrder.vendor_name.charAt(0)}
                </span>
                <div>
                  <p className="text-sm font-medium">{vendorOrder.vendor_name}</p>
                  <p className="text-2xs text-muted">
                    {vendorOrder.shipping_cents === 0
                      ? 'Ücretsiz kargo'
                      : `Kargo ${formatMoney(vendorOrder.shipping_cents)}`}
                    {vendorOrder.estimated_delivery_days
                      ? ` · ${vendorOrder.estimated_delivery_days} günde teslim`
                      : ''}
                  </p>
                </div>
              </div>
              <span className="tabular font-semibold">{formatMoney(vendorOrder.total_cents)}</span>
            </div>
          ))}

          <div className="flex justify-between rounded-xl bg-surface-2 p-4 text-base font-black">
            <span>Toplam</span>
            <span className="tabular">{formatMoney(result.grand_total_cents ?? total)}</span>
          </div>
        </div>

        <Link
          href="/"
          className="mt-8 inline-block rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold transition-colors hover:border-brand/50"
        >
          Alışverişe devam et
        </Link>
      </div>
    </div>
  );
}
