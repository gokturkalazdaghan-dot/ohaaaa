import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage } from '@/components/ContentPage';

export const metadata: Metadata = {
  title: 'Hakkımızda',
  description:
    'Ohaaaa, aynı ürünü onlarca mağazadan karşılaştıran bir fiyat agregatörüdür. ' +
    'Kargo dahil gerçek toplam maliyeti gösterir, en ucuzunu öne çıkarır.',
  alternates: { canonical: '/hakkimizda' },
};

export default function AboutPage() {
  return (
    <ContentPage
      title="Hakkımızda"
      description="Aynı ürünü onlarca mağazadan karşılaştırıyoruz — kargo dahil, gerçek toplam fiyatla."
    >
      <h2>Neden kurduk?</h2>
      <p>
        Türkiye’de bir ürünü almadan önce ortalama <strong>dört farklı siteye</strong> bakılıyor.
        Her birinde farklı bir fiyat, farklı bir kargo ücreti ve farklı bir teslim süresi var.
        Etiket fiyatı en düşük olan mağaza, kargo eklendiğinde çoğu zaman en ucuz olan
        mağaza değil.
      </p>
      <p>
        Ohaaaa bu karşılaştırmayı sizin yerinize yapar. Ürünleri mağaza mağaza değil,{' '}
        <strong>ürün ürün</strong> gösteririz: bir telefonun tüm satıcılarını tek kartta
        toplar, <strong>kargo dahil toplam maliyete göre</strong> sıralarız.
      </p>

      <h2>Sıralamayı nasıl yapıyoruz?</h2>
      <p>
        Tek ölçütümüz var: <strong>ödeyeceğiniz tutar</strong>. Etiket fiyatı 100 TL daha
        ucuz ama kargosu 150 TL olan bir teklif, listede daha aşağıda çıkar. Ücretsiz kargo
        eşiği olan mağazalarda eşik hesaba katılır.
      </p>
      <p>
        Sıralamada <strong>hiçbir mağaza para karşılığı öne çıkarılmaz</strong>. Bir
        mağazadan komisyon alıyor olmamız onu üste taşımaz; sadece ucuz olması taşır.
        Bunun nasıl finanse edildiğini{' '}
        <Link href="/ortaklik-aciklamasi">ortaklık açıklaması</Link> sayfasında anlattık.
      </p>

      <h2>“İndirim” dediğimizde ne demek istiyoruz?</h2>
      <p>
        Mağazaların üstü çizili fiyatlarına güvenmiyoruz — o bir pazarlama verisi. Bunun
        yerine <strong>kendi fiyat gözlemimizi</strong> tutuyoruz. Bir ürün için “90 günün
        en düşük fiyatı” dediğimizde, o 90 gün boyunca bizim ölçtüğümüz fiyatları
        kastediyoruz.
      </p>
      <p>
        Yeni takip etmeye başladığımız ürünlerde bu iddiayı zayıf işaretliyoruz: 30 günden
        az gözlemle “en ucuz” demek dürüst olmaz.
      </p>

      <h2>İki tür satıcı</h2>
      <table>
        <tbody>
          <tr>
            <td>
              <strong>Ohaaaa satıcıları</strong>
            </td>
            <td>
              Siparişi bizde verirsiniz, ödemeyi biz alırız, satıcı gönderir. Farklı
              satıcılardan aldıklarınız tek sepette birleşir.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Ortak mağazalar</strong>
            </td>
            <td>
              Siparişi mağazanın kendi sitesinde verirsiniz. Sizi oraya yönlendiririz;
              satış gerçekleşirse mağazadan komisyon alırız. Ödediğiniz tutar değişmez.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Hangisi olduğu ürün sayfasında düğmenin üstünde yazar: “Sepete ekle” bizde,
        “Mağazaya git” ortak mağazada.
      </p>

      <h2>Bize ulaşın</h2>
      <p>
        Bir fiyat yanlış görünüyorsa, bir ürün yanlış eşleşmişse veya mağazanızı listelemek
        istiyorsanız <Link href="/iletisim">iletişim sayfasından</Link> yazın. Satıcı olmak
        için <Link href="/tasoron">satıcı sayfamıza</Link> göz atın.
      </p>
    </ContentPage>
  );
}
