import type { Metadata } from 'next';
import Link from 'next/link';

import { ArrowRightIcon, ChartIcon, CodeIcon, KeyIcon, ShieldIcon, StoreIcon, TruckIcon } from '@/components/Icons';

export const metadata: Metadata = {
  title: 'Satıcı olun',
  description:
    'Ohaaaa’ya katılın: kurulum ücreti yok, tek REST çağrısıyla katalog senkronizasyonu, ' +
    'şeffaf komisyon ve anlık hakediş takibi.',
};

const STEPS = [
  {
    icon: StoreIcon,
    title: 'Başvurun',
    description:
      'Firma bilgilerinizi girin. Vergi numarası doğrulaması sonrası hesabınız genellikle ' +
      '1 iş günü içinde onaylanır.',
  },
  {
    icon: KeyIcon,
    title: 'Anahtarınızı oluşturun',
    description:
      'Panelden API anahtarınızı üretin. Her anahtara yalnızca ihtiyaç duyduğu yetkileri ' +
      'verin; anahtarı dilediğiniz an iptal edin.',
  },
  {
    icon: CodeIcon,
    title: 'Kataloğu besleyin',
    description:
      'Tek bir POST isteğiyle 500 ürüne kadar gönderin. Besleme idempotenttir: aynı sayfayı ' +
      'tekrar göndermek mükerrer kayıt oluşturmaz.',
  },
  {
    icon: ChartIcon,
    title: 'Satın, takip edin',
    description:
      'Siparişler aynı API’den düşer. Panelde ciro, komisyon ve hakedişinizi günlük ' +
      'kırılımla izleyin.',
  },
];

export default function VendorLandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <header className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-4 py-1.5 text-xs font-semibold text-brand-soft">
          <StoreIcon className="h-3.5 w-3.5" />
          Taşeronlar için
        </span>

        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-5xl">
          Kataloğunuz zaten hazır.
          <br />
          <span className="text-gradient">Bir REST çağrısı uzağınızda.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl leading-relaxed text-muted">
          Ohaaaa ürünlerinizi kendi başına listelemez — sizin beslemenizle çalışır. Fiyat ve
          stoğun tek doğruluk kaynağı sizin sisteminizdir; biz onu milyonlarca alıcıya
          ulaştırırız.
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link
            href="/tasoron/basvuru"
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-electric px-6 py-3 font-semibold text-white transition-transform hover:scale-[1.03]"
          >
            Başvuru formunu doldur
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <Link
            href="/tasoron/api"
            className="rounded-xl border border-line bg-surface px-6 py-3 font-semibold transition-colors hover:border-brand/45"
          >
            Önce API’yi incele
          </Link>
        </div>
      </header>

      <section className="mt-20 grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: ShieldIcon,
            title: 'Kurulum ücreti yok',
            body: 'Aylık sabit ücret ya da listeleme bedeli almıyoruz. Yalnızca gerçekleşen satıştan komisyon.',
          },
          {
            icon: ChartIcon,
            title: 'Şeffaf komisyon',
            body: 'Oranınız sözleşmede sabittir ve sipariş anında dondurulur. Sonradan değişen oran, geçmiş siparişi etkilemez.',
          },
          {
            icon: TruckIcon,
            title: 'Kargoyu siz yönetin',
            body: 'Kendi anlaşmalı kargonuzla gönderin. Takip numarasını API’den bildirin, gerisini biz hallederiz.',
          },
        ].map((item) => (
          <article key={item.title} className="card p-6">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand/18 to-electric/18 text-brand-soft">
              <item.icon className="h-5 w-5" />
            </span>
            <h2 className="mt-4 font-semibold">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
          </article>
        ))}
      </section>

      <section className="mt-20">
        <h2 className="text-center text-2xl font-black tracking-tight sm:text-3xl">
          Dört adımda yayında
        </h2>

        <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand to-electric text-white">
                <step.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 flex items-center gap-2 font-semibold">
                <span className="tabular text-xs text-subtle">0{index + 1}</span>
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card-glow mt-20 p-8 text-center sm:p-12">
        <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
          Panelinizi şimdi keşfedin
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted">
          Başvurunuz onaylanmadan önce bile paneli örnek verilerle inceleyebilirsiniz.
        </p>
        <Link
          href="/tasoron/panel"
          className="mt-7 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-electric px-6 py-3 font-semibold text-white transition-transform hover:scale-[1.03]"
        >
          Örnek paneli aç
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
