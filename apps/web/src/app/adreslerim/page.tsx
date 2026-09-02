import type { Metadata } from 'next';

import { getSavedAddresses } from '@/data/catalog';

import { AddressForm } from './AddressForm';
import { deleteAddress, makeDefaultAddress } from './actions';

export const metadata: Metadata = {
  title: 'Adreslerim',
  description: 'Kayıtlı teslimat adresleriniz.',
  alternates: { canonical: '/adreslerim' },
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AddressesPage() {
  const addresses = await getSavedAddresses();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-fg">Adreslerim</h1>
      <p className="mt-3 max-w-xl leading-relaxed text-muted">
        Kaydettiğiniz adres ödeme sayfasında hazır gelir. Varsayılan seçtiğiniz
        adres ilk sırada çıkar.
      </p>

      {addresses.length > 0 && (
        <ul className="mt-8 space-y-3">
          {addresses.map((address) => (
            <li key={address.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-fg">
                      {address.label ?? address.city}
                    </span>
                    {address.isDefault && (
                      <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-3xs font-bold uppercase text-success">
                        Varsayılan
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-fg">{address.fullName}</p>
                  <p className="text-sm text-muted">{address.phone}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    {address.addressLine}
                    <br />
                    {address.district} / {address.city}
                    {address.postalCode ? ` · ${address.postalCode}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {/*
                    Her ikisi de FORM: adres silmek ve varsayılan değiştirmek
                    veri değiştirir, bağlantıyla yapılamaz. GET ile silinen
                    bir kayıt, önyükleme yapan bir tarayıcı eklentisi ya da
                    üçüncü taraf bir sayfa tarafından silinebilirdi.
                  */}
                  {!address.isDefault && (
                    <form action={makeDefaultAddress}>
                      <input type="hidden" name="address_id" value={address.id} />
                      <button
                        type="submit"
                        className="rounded-xl border border-line px-3.5 py-1.5 text-xs font-medium transition-colors hover:border-brand/50"
                      >
                        Varsayılan yap
                      </button>
                    </form>
                  )}
                  <form action={deleteAddress}>
                    <input type="hidden" name="address_id" value={address.id} />
                    <button
                      type="submit"
                      className="rounded-xl px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-danger"
                    >
                      Sil
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <AddressForm />
      </div>

      {/*
        Silme geri alınamaz ama telafisi de ucuz: adres yeniden yazılır,
        sipariş etkilenmez. Onay penceresi koymak yerine bunu söylemek
        yeterli -- siparişteki adres kopyadır, buradan silmek geçmiş bir
        gönderinin nereye gittiğini değiştirmez.
      */}
      {addresses.length > 0 && (
        <p className="mt-4 text-xs text-subtle">
          Bir adresi silmek geçmiş siparişlerinizi etkilemez: siparişe yazılan
          adres, gönderildiği günkü hâliyle o siparişte saklanır.
        </p>
      )}
    </div>
  );
}
