import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage } from '@/components/ContentPage';
import { JsonLd } from '@/components/JsonLd';
import { siteUrl } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Sıkça Sorulan Sorular',
  description:
    'Ohaaaa nasıl çalışır, fiyatlar neden farklı, komisyon alıyor musunuz, ' +
    'iade nasıl yapılır — en çok sorulan sorular ve yanıtları.',
  alternates: { canonical: '/sss' },
};

/**
 * Sorular tek bir dizide tutulur: hem sayfa hem FAQPage yapılandırılmış
 * verisi buradan üretilir. İki yerde ayrı yazılsaydı, biri güncellenip
 * diğeri unutulurdu — Google'a yanlış içerik göstermek cezalandırılır.
 */
const FAQS = [
  {
    q: 'Ohaaaa bir mağaza mı, karşılaştırma sitesi mi?',
    a:
      'İkisi birden. Bazı ürünler doğrudan bizim satıcılarımızda satılır; siparişi bizde ' +
      'verirsiniz. Bazı ürünler ise ortak mağazalarda satılır; sizi oraya yönlendiririz. ' +
      'Hangisi olduğu ürün sayfasında düğmenin üstünde yazar: “Sepete ekle” bizde, ' +
      '“Mağazaya git” ortak mağazada.',
  },
  {
    q: 'Aynı ürün için neden farklı fiyatlar görüyorum?',
    a:
      'Her satıcı kendi fiyatını belirler. Biz fiyatı değiştirmez, olduğu gibi gösteririz. ' +
      'Sıralamayı etiket fiyatına göre değil, kargo dahil toplam maliyete göre yaparız — ' +
      'çünkü ödeyeceğiniz tutar odur.',
  },
  {
    q: 'Sıralamada para karşılığı öne çıkarma var mı?',
    a:
      'Hayır. Bir mağazadan komisyon alıyor olmamız onu listede yukarı taşımaz. Tek sıralama ' +
      'ölçütümüz kargo dahil toplam fiyattır. Komisyon aldığımız teklifler “Mağazaya git” ' +
      'düğmesiyle ve bağlantı üzerindeki sponsorlu işaretiyle ayırt edilir.',
  },
  {
    q: 'Fiyatlar ne sıklıkla güncelleniyor?',
    a:
      'Ortak mağaza fiyatlarını günde dört kez tazeleriz. Buna rağmen mağaza sayfasındaki ' +
      'fiyat farklı olabilir; geçerli olan mağazanın kendi sayfasındaki fiyattır. Yanlış bir ' +
      'fiyat görürseniz bize bildirin.',
  },
  {
    q: '“90 günün en düşük fiyatı” ne demek?',
    a:
      'Mağazanın üstü çizili fiyatına değil, kendi ölçtüğümüz fiyat geçmişine bakarız. ' +
      'Bir ürünü 90 gündür izliyorsak ve bugünkü fiyat o dönemin en düşüğüyse bunu ' +
      'belirtiriz. Yeni izlemeye başladığımız ürünlerde bu iddiayı zayıf işaretleriz.',
  },
  {
    q: 'Siparişim neden birden fazla kargoyla geliyor?',
    a:
      'Farklı satıcılardan ürün aldıysanız her satıcı kendi gönderisini yapar. Sepette ve ' +
      'ödeme sayfasında kaç ayrı gönderi olacağını ve her birinin kargo ücretini önceden ' +
      'gösteririz.',
  },
  {
    q: 'İade ve değişimi kim yapıyor?',
    a:
      'Ohaaaa üzerinden verdiğiniz siparişlerde biz yönetiriz. Ortak mağazadan aldıysanız ' +
      'satış sözleşmesi o mağazayla kurulur; iade talebini onların koşullarına göre onlara ' +
      'iletirsiniz. Mesafeli Sözleşmeler Yönetmeliği gereği 14 günlük cayma hakkınız her ' +
      'durumda saklıdır.',
  },
  {
    q: 'Yönlendirme yaptığınızda ben fazla mı ödüyorum?',
    a:
      'Hayır. Komisyon mağazanın pazarlama bütçesinden ödenir; ürün fiyatına eklenmez. ' +
      'Bizim linkimizden gitmeniz ile doğrudan gitmeniz arasında ödediğiniz tutar açısından ' +
      'fark yoktur.',
  },
  {
    q: 'Mağazamı Ohaaaa’da nasıl listelerim?',
    a:
      'Satıcı başvuru formunu doldurun. Onay sonrası panelden API anahtarınızı oluşturup ' +
      'kataloğunuzu tek bir istekle gönderebilirsiniz. Kurulum ücreti veya aylık sabit ' +
      'ücret yoktur; yalnızca gerçekleşen satıştan komisyon alınır.',
  },
  {
    q: 'Hangi verilerimi topluyorsunuz?',
    a:
      'Bir mağazaya yönlendirdiğimizde tıklamayı kaydederiz. IP adresiniz ve tarayıcı ' +
      'bilginiz ham olarak saklanmaz; günlük değişen bir anahtarla özetlenir, böylece ' +
      'günler arası takip mümkün olmaz. Ayrıntılar gizlilik politikamızda.',
  },
] as const;

export default function FaqPage() {
  return (
    <>
      {/*
        FAQPage şeması: arama sonucunda soruların açılır olarak görünmesini
        sağlar. Sayfadaki metinle BİREBİR aynı olmalıdır — farklı içerik
        göstermek yapılandırılmış veri ihlalidir.
      */}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          '@id': `${siteUrl}/sss`,
          mainEntity: FAQS.map((faq) => ({
            '@type': 'Question',
            name: faq.q,
            acceptedAnswer: { '@type': 'Answer', text: faq.a },
          })),
        }}
      />

      <ContentPage
        title="Sıkça Sorulan Sorular"
        description="Karşılaştırmanın nasıl çalıştığı, komisyon modeli ve iade süreçleri."
        breadcrumb="SSS"
      >
        <div className="space-y-3">
          {FAQS.map((faq) => (
            <details key={faq.q} className="card group p-5">
              <summary className="cursor-pointer list-none font-semibold text-fg marker:hidden">
                <span className="flex items-start justify-between gap-4">
                  {faq.q}
                  <span
                    aria-hidden="true"
                    className="mt-1 shrink-0 text-muted transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted">{faq.a}</p>
            </details>
          ))}
        </div>

        <h2>Sorunuz burada yok mu?</h2>
        <p>
          <Link href="/iletisim">İletişim sayfasından</Link> yazın; konusuna göre 1–2 iş
          günü içinde dönüş yapıyoruz.
        </p>
      </ContentPage>
    </>
  );
}
