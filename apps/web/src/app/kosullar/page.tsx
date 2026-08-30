import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage, Notice } from '@/components/ContentPage';

export const metadata: Metadata = {
  title: 'Kullanım Şartları',
  description:
    'Ohaaaa’yı kullanırken geçerli olan koşullar: fiyat doğruluğu, satıcı ilişkisi, ' +
    'iade süreçleri ve sorumluluk sınırları.',
  alternates: { canonical: '/kosullar' },
};

export default function TermsPage() {
  return (
    <ContentPage
      title="Kullanım Şartları"
      description="Kim neyden sorumlu, satış sözleşmesi kiminle kurulur, iade nasıl işler."
      updatedAt="2026-08-30"
      breadcrumb="Şartlar"
    >
      <Notice tone="warning">
        <strong>Yayına almadan önce:</strong> Bu metin sistemin gerçek işleyişini doğru
        anlatır ancak <strong>hukuki incelemeden geçmemiştir</strong>. Köşeli parantezli
        alanlar doldurulmalı ve bir avukat tarafından gözden geçirilmelidir.
        <br />
        <br />
        <strong>ETBİS kaydı:</strong> 6563 sayılı Kanun kapsamında e-ticaret hizmet
        sağlayıcıları ve aracı hizmet sağlayıcıları, şahıs işletmesi olsalar dahi ETBİS’e
        kayıt olmakla yükümlüdür. Kayıt numarası sitede yayımlanmalıdır.
      </Notice>

      <h2>1. Taraflar</h2>
      <p>
        Bu şartlar, <strong>Armanalabs</strong> işletme adıyla faaliyet gösteren{' '}
        <strong>[Ad Soyad]</strong> (“Ohaaaa”, “biz”) tarafından işletilen ohaaaa.com
        sitesinin kullanımını düzenler. Siteyi kullanarak bu şartları kabul etmiş
        sayılırsınız.
      </p>
      <p>
        İşletme bilgilerinin tamamı <Link href="/iletisim">iletişim sayfasında</Link>{' '}
        yayımlanmıştır.
      </p>

      <h2>2. Ohaaaa ne yapar, ne yapmaz</h2>
      <p>
        Ohaaaa bir <strong>fiyat karşılaştırma ve pazar yeri platformudur</strong>. İki
        farklı ilişki türü vardır ve <strong>satış sözleşmesinin kiminle kurulduğu buna
        göre değişir</strong>:
      </p>

      <table>
        <thead>
          <tr>
            <th>Tür</th>
            <th>Satış sözleşmesi</th>
            <th>Ödeme</th>
            <th>İade muhatabı</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Ohaaaa satıcısı</strong>
              <br />
              (“Sepete ekle”)
            </td>
            <td>Sizinle satıcı arasında; Ohaaaa aracı hizmet sağlayıcıdır</td>
            <td>Ohaaaa tahsil eder</td>
            <td>Ohaaaa üzerinden yürütülür</td>
          </tr>
          <tr>
            <td>
              <strong>Ortak mağaza</strong>
              <br />
              (“Mağazaya git”)
            </td>
            <td>Sizinle mağaza arasında; Ohaaaa taraf değildir</td>
            <td>Mağaza tahsil eder</td>
            <td>Doğrudan mağazaya</td>
          </tr>
        </tbody>
      </table>

      <p>
        Ohaaaa, 6563 sayılı Kanun kapsamında <strong>aracı hizmet sağlayıcıdır</strong>.
        Satıcıların sunduğu ürünlerin niteliğinden, ayıplı olmasından veya teslim
        edilmemesinden ilgili satıcı sorumludur.
      </p>

      <h2>3. Fiyat ve stok bilgisi</h2>
      <p>
        Gösterilen fiyatlar satıcılardan alınır ve <strong>günde en az dört kez</strong>{' '}
        tazelenir. Buna rağmen fiyat değişmiş olabilir.{' '}
        <strong>Geçerli olan, satın alma anında satıcının kendi sayfasında görünen
        fiyattır.</strong>
      </p>
      <p>
        Bariz bir maddi hata (örneğin 50.000 TL’lik bir ürünün 50 TL görünmesi) hâlinde
        işlem iptal edilebilir ve ödemeniz iade edilir.
      </p>

      <h3>“En düşük fiyat” iddiası</h3>
      <p>
        “90 günün en düşük fiyatı” gibi ifadeler, <strong>bizim kendi
        gözlemlerimize</strong> dayanır — satıcının beyanına değil. Gözlem süremiz kısaysa
        bunu sayfada belirtiriz. Bu bilgi geçmişe dair bir tespittir, geleceğe dair bir
        taahhüt değildir.
      </p>

      <h2>4. Sıralama kriterleri</h2>
      <p>
        6563 sayılı Kanun ve ilgili yönetmelik uyarınca sıralama ölçütlerimizi açıklıyoruz:
        teklifler <strong>kargo dahil toplam maliyete göre artan sırada</strong> listelenir.
        Eşitlik hâlinde daha kısa teslim süresi öne geçer.
      </p>
      <p>
        <strong>Ücret karşılığı sıralama yapılmaz.</strong> Bir satıcıdan komisyon almamız
        onu listede yukarı taşımaz. Komisyon aldığımız bağlantılar sponsorlu olarak
        işaretlenir — bkz. <Link href="/ortaklik-aciklamasi">Ortaklık Açıklaması</Link>.
      </p>

      <h2>5. Cayma hakkı ve iade</h2>
      <p>
        Mesafeli Sözleşmeler Yönetmeliği uyarınca, teslim tarihinden itibaren{' '}
        <strong>14 gün içinde</strong> gerekçe göstermeden cayma hakkınız vardır. Yönetmelikte
        sayılan istisnalar (kişiye özel üretilen ürünler, ambalajı açılmış hijyen ürünleri,
        dijital içerik vb.) saklıdır.
      </p>
      <ul>
        <li>
          <strong>Ohaaaa satıcısından</strong> aldıysanız: talebinizi bize iletin, süreci
          yürütelim.
        </li>
        <li>
          <strong>Ortak mağazadan</strong> aldıysanız: talebi doğrudan o mağazaya
          iletmeniz gerekir; sözleşme onlarla kurulmuştur.
        </li>
      </ul>

      <h2>6. Kullanıcı yükümlülükleri</h2>
      <ul>
        <li>Doğru ve güncel bilgi vermek</li>
        <li>Siteyi otomatik araçlarla aşırı yüklememek</li>
        <li>Başkasının hesabını veya ödeme aracını kullanmamak</li>
        <li>Yanıltıcı yorum veya sahte sipariş oluşturmamak</li>
      </ul>

      <h2>7. Fikri mülkiyet</h2>
      <p>
        Sitedeki tasarım, metin ve yazılım Ohaaaa’ya aittir. Ürün adları, görselleri ve
        markaları ilgili hak sahiplerine aittir; yalnızca tanıtım amacıyla gösterilir.
      </p>
      <p>
        Fiyat karşılaştırma verilerimizin sistematik olarak kopyalanması veya ticari
        amaçla yeniden yayınlanması izne tabidir.
      </p>

      <h2>8. Sorumluluk sınırı</h2>
      <p>
        Siteyi kesintisiz ve hatasız sunmak için çaba gösteririz ancak bunu taahhüt
        etmeyiz. Satıcıların ürün, teslimat ve satış sonrası hizmetlerinden doğan
        zararlardan ilgili satıcı sorumludur. Tüketici mevzuatından doğan haklarınız bu
        madde ile sınırlandırılamaz.
      </p>

      <h2>9. Değişiklikler ve uyuşmazlık</h2>
      <p>
        Bu şartları değiştirebiliriz; değişiklik sayfada yayımlandığı anda geçerli olur ve
        güncelleme tarihi yenilenir.
      </p>
      <p>
        Uyuşmazlıklarda Türk hukuku uygulanır. Tüketici işlemlerinde parasal sınırlara göre
        <strong> Tüketici Hakem Heyetleri</strong> ve <strong>Tüketici Mahkemeleri</strong>{' '}
        yetkilidir.
      </p>

      <p className="text-sm">
        İlgili diğer metinler: <Link href="/gizlilik">Gizlilik Politikası</Link> ·{' '}
        <Link href="/sss">SSS</Link>
      </p>
    </ContentPage>
  );
}
