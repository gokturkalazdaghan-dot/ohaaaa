import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Satıcı olun',
  description:
    'Ohaaaa’da satış: başvuru sonrası API ile katalog, yalnızca gerçekleşen satıştan komisyon.',
};

export default function VendorLandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section className="max-w-xl text-left">
        <h1 className="text-3xl font-bold tracking-tight text-fg">Mağazanızı Ohaaaa’da yayın</h1>
        <p className="mt-2 text-muted">
          Listeleme bedeli yok. Fiyat ve stok sizin sisteminizden gelir. Komisyon yalnızca satış
          olursa kesilir.
        </p>
        <p className="mt-6 text-sm">
          <Link href="/tasoron/basvuru" className="text-brand underline-offset-2 hover:underline">
            Başvuru formu
          </Link>
        </p>
        <p className="mt-8 text-sm leading-relaxed text-muted">
          Onay sonrası panelden API anahtarı üretirsiniz. Besleme tek POST ile 500 ürüne kadar
          gider. Ayrıntı{' '}
          <Link href="/tasoron/api" className="text-brand underline-offset-2 hover:underline">
            API sayfasında
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
