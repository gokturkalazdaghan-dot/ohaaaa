import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage } from '@/components/ContentPage';

export const metadata: Metadata = {
  title: 'Ortaklık Açıklaması',
  description:
    'Ohaaaa nasıl para kazanıyor: komisyon modeli, sıralamayı nasıl etkilemediği ve ' +
    'sizin ne ödediğiniz.',
  alternates: { canonical: '/ortaklik-aciklamasi' },
};

export default function AffiliateDisclosurePage() {
  return (
    <ContentPage
      title="Ortaklık Açıklaması"
      description="Nasıl para kazandığımızı ve bunun gördüklerinizi nasıl etkilemediğini açık yazıyoruz."
      updatedAt="2026-08-30"
      breadcrumb="Ortaklık açıklaması"
    >
      <h2>Kısa cevap</h2>
      <p>
        Bazı bağlantılarımız <strong>ortaklık (affiliate) bağlantısıdır</strong>. Bu
        bağlantıdan gidip alışveriş yaparsanız, mağaza bize komisyon öder.{' '}
        <strong>Siz fazladan bir şey ödemezsiniz</strong> — komisyon mağazanın pazarlama
        bütçesinden çıkar.
      </p>

      <h2>Sıralamayı etkiliyor mu?</h2>
      <p>
        <strong>Hayır.</strong> Teklifler yalnızca <strong>kargo dahil toplam
        maliyete</strong> göre sıralanır. Komisyon oranı yüksek bir mağaza pahalıysa
        listede aşağıda çıkar; komisyon almadığımız bir satıcı ucuzsa en üstte çıkar.
      </p>
      <p>
        Bunu denetlenebilir kılmak için sıralama kuralını{' '}
        <Link href="/kosullar">Kullanım Şartları’nın 4. maddesinde</Link> yazılı hâle
        getirdik.
      </p>

      <h2>Hangi bağlantılar ortaklık bağlantısı?</h2>
      <p>Üç işaretle ayırt edebilirsiniz:</p>
      <ul>
        <li>
          Düğmede <strong>“Mağazaya git”</strong> yazar (bizim satıcılarımızda “Sepete
          ekle” yazar)
        </li>
        <li>
          Altında <strong>“satış [mağaza adı]’de tamamlanır”</strong> notu bulunur
        </li>
        <li>
          Bağlantı teknik olarak <code>rel=&quot;sponsored&quot;</code> ile işaretlidir
        </li>
      </ul>

      <h2>Neye tıkladığınızı kaydediyor musunuz?</h2>
      <p>
        Evet — ama sizi değil, <strong>tıklamayı</strong>. Bir mağazaya yönlendirdiğimizde
        o tıklamaya rastgele bir izleme numarası veririz. Satış gerçekleşirse mağaza bu
        numarayı bize geri bildirir ve komisyonu hak ettiğimizi doğrularız.
      </p>
      <p>
        Mağazaya <strong>adınız, e-postanız veya IP adresiniz iletilmez</strong>. IP’niz
        bizde de ham hâlde durmaz; günlük değişen bir anahtarla özetlenir. Ayrıntı:{' '}
        <Link href="/gizlilik">Gizlilik Politikası</Link>.
      </p>

      <h2>Neden bu modeli seçtik?</h2>
      <p>
        Alternatifler daha kötüydü. Kullanıcıdan üyelik ücreti almak karşılaştırma
        sitesinin işini bitirir. Sıralamada ücretli üst sıra satmak ise size yalan
        söylemek olurdu — bir karşılaştırma sitesinin satabileceği tek şey güvenilirliktir.
      </p>
      <p>
        Komisyon modeli, çıkarlarımızı sizinkiyle aynı hizaya getiriyor: siz doğru ürünü
        doğru fiyata bulup satın aldığınızda biz kazanıyoruz. Yanlış yönlendirirsek iade
        edilir ve komisyon da geri alınır.
      </p>

      <h2>Yasal dayanak</h2>
      <p>
        Bu açıklama, Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği’nin ticari
        bağlantıların açıkça belirtilmesi yükümlülüğü ile 6563 sayılı Kanun’un sıralama
        kriterlerinin şeffaflığı hükümleri uyarınca yapılmıştır.
      </p>
    </ContentPage>
  );
}
