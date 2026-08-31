import type { Metadata } from 'next';
import Link from 'next/link';

import { ReviewForm } from '@/components/ReviewForm';
import { getReviewableItems } from '@/data/catalog';

export const metadata: Metadata = {
  title: 'Değerlendirmelerim',
  description: 'Teslim aldığınız ürünleri ve satıcıları değerlendirin.',
  alternates: { canonical: '/degerlendirmelerim' },
  // Kişiye özel içerik: arama motorunda yeri yok.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ReviewsPage() {
  const items = await getReviewableItems();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-fg">
        Değerlendirmelerim
      </h1>
      <p className="mt-3 max-w-xl leading-relaxed text-muted">
        Teslim aldığınız ürünleri değerlendirebilirsiniz. Ürün ve satıcı ayrı
        puanlanır: ürün beklediğiniz gibi olabilir ama teslimat kötü olabilir,
        ya da tersi. Sonraki alıcı ikisini ayırt edebilmeli.
      </p>

      {items.length === 0 ? (
        <div className="card mt-8 p-6">
          <p className="font-semibold text-fg">Değerlendirilecek sipariş yok</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Değerlendirme, <strong>teslim edilmiş</strong> siparişler için açılır.
            Böylece her yorumun arkasında gerçek bir alışveriş olur — bu sitede
            satın almadan yorum yazılamaz.
          </p>
          <Link
            href="/arama"
            className="mt-5 inline-block rounded-xl border border-line px-4 py-2 text-sm font-medium transition-colors hover:border-brand/50"
          >
            Ürünlere göz at
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-5">
          {items.map((item) => (
            <li key={item.orderItemId} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-semibold text-fg">
                    {item.productSlug ? (
                      <Link href={`/urun/${item.productSlug}`} className="hover:underline">
                        {item.title}
                      </Link>
                    ) : (
                      item.title
                    )}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {item.vendorName}
                    {item.deliveredAt && (
                      <>
                        {' · '}
                        <time dateTime={item.deliveredAt}>
                          {new Date(item.deliveredAt).toLocaleDateString('tr-TR', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })}{' '}
                          teslim edildi
                        </time>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <ReviewForm item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
