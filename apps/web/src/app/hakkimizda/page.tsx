import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage } from '@/components/ContentPage';

export const metadata: Metadata = {
  title: 'Hakkımızda',
  description:
    'Ohaaaa satıcıdan komisyon almaz: listeleme ücretsizdir, karşılığı ambalajdır. ' +
    'Aynı ürünü satan mağazaları kargo dahil toplam maliyete göre karşılaştırır.',
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
        Bir ürünün fiyatı, üreticiden çıktığı fiyat değildir. Satıcı büyük pazar
        yerlerinde komisyon, reklam ve vitrin bedeli öder; bu maliyetler etikete
        eklenir. Sonuçta <strong>satıcı daha az kazanır, alıcı daha çok öder</strong>
        ve aradaki farkı ikisi de görmez.
      </p>
      <p>
        Ohaaaa bu aracılığı ortadan kaldırmak için kuruldu.{' '}
        <strong>Satıcıdan komisyon almıyoruz</strong> — listeleme, vitrin ve reklam
        ücretsiz. Karşılığında satıcı, gönderilerinde bizim koli bandımızı ve
        armamızı kullanır. Tek beklentimiz bu; kazancımız satıcının cebinden değil,
        markamızın her kutuda görünmesinden gelir.
      </p>
      <p>
        Alıcı tarafında ise tek iş yaparız: aynı ürünü satan bütün mağazaları tek
        kartta toplar, <strong>kargo dahil toplam maliyete göre</strong> sıralarız.
        Ürünleri mağaza mağaza değil, <strong>ürün ürün</strong> gösteririz.
      </p>

      <h2>Sıralamayı nasıl yapıyoruz?</h2>
      <p>
        Tek ölçütümüz var: <strong>ödeyeceğiniz tutar</strong>. Etiket fiyatı 100 TL daha
        ucuz ama kargosu 150 TL olan bir teklif, listede daha aşağıda çıkar. Ücretsiz kargo
        eşiği olan mağazalarda eşik hesaba katılır.
      </p>
      <p>
        Sıralamada <strong>hiçbir mağaza para karşılığı öne çıkarılmaz</strong>. Öne
        çıkmanın satılık olmadığı bir yerde, sıralamayı yalnızca fiyat belirler.
      </p>
      <p>
        Ortak mağaza tekliflerinde satış o mağazanın kendi sitesinde tamamlanır ve
        gerçekleşirse <strong>mağazadan</strong> komisyon alırız — sizin ödediğiniz
        tutar değişmez ve bu, o teklifi listede yukarı taşımaz. Ayrıntısı{' '}
        <Link href="/ortaklik-aciklamasi">ortaklık açıklaması</Link> sayfasında.
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

      <h2>Kutudaki bant nedir?</h2>
      <p>
        Ohaaaa’dan gelen bir gönderide bizim armamızı taşıyan bir koli bandı
        görürsünüz. O bant, satıcının bize ödediği tek bedeldir:{' '}
        <strong>komisyon yerine ambalaj</strong>. Satıcı bandı kendi matbaasında
        bastırabilir ya da bizden temin edebilir.
      </p>
      <p>
        Bant bir kalite belgesi değildir; ürünün kendisinden, faturasından ve
        iadesinden <strong>satıcı sorumludur</strong>. Bizim sorumluluğumuz
        karşılaştırmanın doğruluğu ve kural ihlallerinin takibidir.
      </p>

      <h2>Neyi vaat etmiyoruz</h2>
      <p>
        Bir fiyat karşılaştırma sitesinin en kolay yalanı, ölçmediği şeyi
        ölçmüş gibi göstermesidir. Bu yüzden açıkça yazıyoruz:
      </p>
      <ul>
        <li>
          Satıcının stok, kalite ve teslimat performansından{' '}
          <strong>biz sorumlu değiliz</strong>; bu satıcının yükümlülüğüdür.
        </li>
        <li>
          Değerlendirme yalnızca <strong>teslim almış alıcıdan</strong> gelir.
          Bu sitede satın almadan yorum yazılamaz — bir ürünün puanı azsa,
          o ürün az satılmıştır, kötü olduğu için değil.
        </li>
        <li>
          Ortak mağaza alışverişleri bizim sistemimizde tamamlanmadığı için{' '}
          <strong>değerlendirilemez</strong>. Doğrulayamadığımız bir yorumu
          göstermektense hiç göstermemeyi seçiyoruz.
        </li>
      </ul>

      <h2>Bize ulaşın</h2>
      <p>
        Bir fiyat yanlış görünüyorsa, bir ürün yanlış eşleşmişse veya mağazanızı listelemek
        istiyorsanız <Link href="/iletisim">iletişim sayfasından</Link> yazın. Satıcı olmak
        için <Link href="/tasoron">satıcı sayfamıza</Link> göz atın.
      </p>
    </ContentPage>
  );
}
