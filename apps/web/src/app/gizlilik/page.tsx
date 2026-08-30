import type { Metadata } from 'next';
import { LegalIncompleteNotice } from '@/components/LegalIncompleteNotice';
import { business, processors } from '@/lib/legal';
import Link from 'next/link';

import { ContentPage, Notice } from '@/components/ContentPage';

export const metadata: Metadata = {
  title: 'Gizlilik Politikası ve KVKK Aydınlatma Metni',
  description:
    'Ohaaaa hangi kişisel verileri işler, ne kadar saklar, kimlerle paylaşır ve ' +
    'KVKK kapsamındaki haklarınızı nasıl kullanırsınız.',
  alternates: { canonical: '/gizlilik' },
};

export default function PrivacyPage() {
  return (
    <ContentPage
      title="Gizlilik Politikası ve KVKK Aydınlatma Metni"
      description="Hangi veriyi neden işlediğimizi, ne kadar sakladığımızı ve haklarınızı açıkça yazdık."
      updatedAt="2026-08-30"
      breadcrumb="Gizlilik"
    >
      <LegalIncompleteNotice />

      <Notice tone="warning">
        <strong>Yayına almadan önce:</strong> Bu metin teknik olarak sistemin gerçekte ne
        yaptığını doğru anlatır, ancak <strong>hukuki incelemeden geçmemiştir</strong>.
        Köşeli parantezli alanlar işletme bilgileriyle doldurulmalı ve bir avukat
        tarafından gözden geçirilmelidir.
        <br />
        <br />
        <strong>VERBİS:</strong> Yıllık çalışan sayısı 50’den az ve mali bilanço toplamı
        eşiğin altında olan veri sorumluları genellikle VERBİS kaydından muaftır. Ancak
        <strong> ana faaliyeti özel nitelikli kişisel veri işlemek olanlar</strong> için
        muafiyet uygulanmaz. Durumunuzu bir hukukçuya teyit ettirin — muafiyet
        varsayımıyla hareket etmek idari para cezasına konu olabilir.
      </Notice>

      <h2>1. Veri sorumlusu</h2>
      <p>
        6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) uyarınca veri sorumlusu,{' '}
        <strong>Armanalabs</strong> işletme adıyla faaliyet gösteren{' '}
        <strong>{business.legalName.value}</strong>’dır. Adres: [açık adres]. Başvurularınız için:{' '}
        <a href="mailto:kvkk@ohaaaa.com">kvkk@ohaaaa.com</a>
      </p>
      <p>
        Ohaaaa bir şahıs işletmesi tarafından işletilmektedir; veri sorumlusu sıfatı
        tüzel kişiye değil, işletme sahibi gerçek kişiye aittir.
      </p>

      <h2>2. İşlediğimiz veriler</h2>
      <p>
        Siteyi <strong>üye olmadan</strong> kullanabilirsiniz. Aşağıdaki tablo, hangi
        durumda hangi verinin işlendiğini gösterir.
      </p>

      <table>
        <thead>
          <tr>
            <th>Veri</th>
            <th>Ne zaman</th>
            <th>Amaç</th>
            <th>Süre</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Sepet içeriği</strong>
            </td>
            <td>Sepete ürün eklediğinizde</td>
            <td>Alışverişi sürdürebilmeniz</td>
            <td>Yalnızca tarayıcınızda; sunucuya gitmez</td>
          </tr>
          <tr>
            <td>
              <strong>Tıklama kaydı</strong>
              <br />
              (ürün, zaman, özetlenmiş IP ve tarayıcı bilgisi)
            </td>
            <td>Bir ortak mağazaya yönlendirildiğinizde</td>
            <td>Komisyon hakkımızın doğrulanması, sahte tıklama tespiti</td>
            <td>18 ay</td>
          </tr>
          <tr>
            <td>
              <strong>Sipariş bilgileri</strong>
              <br />
              (ad, e-posta, telefon, teslimat adresi)
            </td>
            <td>Ohaaaa üzerinden sipariş verdiğinizde</td>
            <td>Siparişin karşılanması, yasal saklama</td>
            <td>10 yıl (VUK ve TTK gereği)</td>
          </tr>
          <tr>
            <td>
              <strong>İletişim formu</strong>
            </td>
            <td>Bize yazdığınızda</td>
            <td>Talebinizin yanıtlanması</td>
            <td>2 yıl</td>
          </tr>
          <tr>
            <td>
              <strong>Ölçümleme verisi</strong>
            </td>
            <td>Yalnızca çerezlere onay verdiyseniz</td>
            <td>Hangi sayfaların işe yaradığını anlamak</td>
            <td>14 ay</td>
          </tr>
        </tbody>
      </table>

      <h3>IP adresiniz nasıl saklanıyor?</h3>
      <p>
        Ham olarak <strong>saklanmıyor</strong>. IP adresiniz ve tarayıcı bilginiz,{' '}
        <strong>her gün değişen bir anahtarla</strong> tek yönlü olarak özetleniyor.
        Bu, aynı gün içinde mükerrer tıklamayı ayırt etmemizi sağlarken günler arasında
        sizi takip etmeyi imkânsız kılıyor. Özetten IP adresine geri dönülemez.
      </p>

      <h2>3. Hukuki sebep</h2>
      <ul>
        <li>
          <strong>Sözleşmenin kurulması ve ifası</strong> (KVKK m.5/2-c) — sipariş
          bilgileri
        </li>
        <li>
          <strong>Hukuki yükümlülük</strong> (m.5/2-ç) — fatura ve ticari kayıtlar
        </li>
        <li>
          <strong>Meşru menfaat</strong> (m.5/2-f) — komisyon hakkımızın doğrulanması ve
          sahtecilik tespiti için tıklama kaydı
        </li>
        <li>
          <strong>Açık rıza</strong> (m.5/1) — ölçümleme çerezleri ve pazarlama iletileri
        </li>
      </ul>

      <h2>4. Kimlerle paylaşıyoruz</h2>
      <table>
        <tbody>
          <tr>
            <td style={{ width: '32%' }}>
              <strong>Ortak mağazalar ve ortaklık ağları</strong>
            </td>
            <td>
              Bir mağazaya yönlendirildiğinizde, o tıklamaya ait <strong>anonim bir
              izleme kimliği</strong> iletilir. Adınız, e-postanız veya IP adresiniz{' '}
              <strong>iletilmez</strong>.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Satıcılar</strong>
            </td>
            <td>
              Ohaaaa üzerinden sipariş verdiğinizde, yalnızca <strong>kendi
              gönderisi için gereken</strong> bilgiler (ad, adres, telefon, o satıcıdan
              aldığınız ürünler) iletilir. Diğer satıcılardan aldıklarınızı göremezler.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Altyapı sağlayıcıları</strong>
            </td>
            <td>Barındırma ve veritabanı hizmeti alınan firmalar (veri işleyen sıfatıyla).</td>
          </tr>
          <tr>
            <td>
              <strong>Yetkili kurumlar</strong>
            </td>
            <td>Yalnızca yasal talep hâlinde.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Kişisel verilerinizi <strong>hiçbir koşulda satmıyoruz</strong>.
      </p>

      <h2>5. Yurt dışına aktarım</h2>
      <p>
        Barındırma ve ölçümleme hizmetleri yurt dışında sunuculara sahip olabilir. Bu
        durumda aktarım KVKK m.9 kapsamında, açık rızanız veya kanunda öngörülen diğer
        şartlar çerçevesinde yapılır. Kullandığımız sağlayıcılar:{' '}
        {processors.hosting.value}, {processors.analytics.value}.
      </p>

      <h2>6. Çerezler</h2>
      <p>Üç tür çerez kullanıyoruz:</p>
      <ul>
        <li>
          <strong>Zorunlu</strong> — oturum ve güvenlik. Onay gerektirmez; olmadan site
          çalışmaz.
        </li>
        <li>
          <strong>Ölçümleme</strong> — hangi sayfaların işe yaradığını anlamak.{' '}
          <strong>Yalnızca onay verirseniz</strong> yüklenir.
        </li>
        <li>
          <strong>Tercih</strong> — tema seçiminiz gibi ayarlar. Tarayıcınızda kalır.
        </li>
      </ul>
      <p>
        Onayınızı istediğiniz zaman sayfanın altındaki bağlantıdan geri alabilirsiniz.
      </p>

      <h2>7. Haklarınız (KVKK m.11)</h2>
      <p>Bize başvurarak şunları talep edebilirsiniz:</p>
      <ul>
        <li>Kişisel verinizin işlenip işlenmediğini öğrenme</li>
        <li>İşlenmişse buna ilişkin bilgi talep etme</li>
        <li>İşlenme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme</li>
        <li>Yurt içinde veya dışında aktarıldığı üçüncü kişileri bilme</li>
        <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme</li>
        <li>Silinmesini veya yok edilmesini isteme</li>
        <li>Otomatik sistemlerle analiz sonucu aleyhinize bir sonuç doğmasına itiraz etme</li>
        <li>Kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde tazminat talep etme</li>
      </ul>
      <p>
        Başvurularınızı <a href="mailto:kvkk@ohaaaa.com">kvkk@ohaaaa.com</a> adresine
        iletebilirsiniz. Mevzuat gereği <strong>en geç 30 gün</strong> içinde yanıtlarız.
        Yanıtımızı yetersiz bulursanız Kişisel Verileri Koruma Kurulu’na şikâyette
        bulunabilirsiniz.
      </p>

      <h2>8. Güvenlik</h2>
      <p>
        Veriler şifreli bağlantı (HTTPS) üzerinden aktarılır. Veritabanında satır
        seviyesinde erişim denetimi uygulanır: bir satıcı yalnızca kendi siparişlerini
        görebilir, başka bir satıcının verisine erişemez. Ödeme kartı bilgileri{' '}
        <strong>sistemimizden hiç geçmez</strong>; ödeme sağlayıcısının kendi güvenli
        alanında işlenir.
      </p>

      <h2>9. Değişiklikler</h2>
      <p>
        Bu metinde değişiklik yaparsak sayfanın üstündeki tarihi güncelleriz. Esaslı bir
        değişiklik olursa sitede duyururuz.
      </p>

      <p className="text-sm">
        İlgili diğer metinler: <Link href="/kosullar">Kullanım Şartları</Link> ·{' '}
        <Link href="/ortaklik-aciklamasi">Ortaklık Açıklaması</Link>
      </p>
    </ContentPage>
  );
}
