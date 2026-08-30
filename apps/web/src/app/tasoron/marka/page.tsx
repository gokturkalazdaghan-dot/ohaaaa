import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage } from '@/components/ContentPage';

export const metadata: Metadata = {
  title: 'Marka kullanım kılavuzu',
  description:
    'Ohaaaa satıcıları için koli bandı baskı dosyası, arma dosyaları ve kullanım kuralları.',
};

/*
 * Satici marka kiti.
 *
 * Is modeli su: listeleme ucretsiz, karsiliginda satici gonderilerinde
 * Ohaaaa markasini kullaniyor. Bu modelin ayakta durmasi saticinin elinde
 * KULLANILABILIR dosya ve NET kural olmasina bagli. "Logomuzu kullanin"
 * demek yeterli degil; matbaaya gidecek dosya, olcu ve sinirlar lazim.
 */

const ASSETS = [
  {
    name: 'Koli bandı baskı dosyası',
    file: '/marka/ohaaaa-koli-bandi.png',
    spec: '200 × 48 mm · 300 dpi · siyah zemin, beyaz baskı',
    note: 'Standart 48 mm koli bandı içindir. Matbaaya olduğu gibi verin; ölçeklemeyin. Desen yatayda kusursuz tekrarlar.',
  },
  {
    name: 'Arma — baskı',
    file: '/marka/ohaaaa-arma.png',
    spec: '1024 × 1024 px · saydam zemin',
    note: 'Etiket, kutu ve broşür için. Küçültülebilir, büyütülemez.',
  },
  {
    name: 'Arma — ekran',
    file: '/marka/ohaaaa-arma-512.png',
    spec: '512 × 512 px · saydam zemin',
    note: 'Web sitesi, e-posta imzası ve sosyal medya için.',
  },
];

const RULES_OK = [
  'Koli bandını ve armayı gönderi ambalajınızda kullanın.',
  'Armayı web sitenizde ve ürün sayfalarınızda "Ohaaaa’da yayındayız" anlamında kullanın.',
  'Arma en az 16 mm (baskıda) veya 32 piksel (ekranda) genişlikte olsun.',
  'Armanın çevresinde, kendi yüksekliğinin en az dörtte biri kadar boşluk bırakın.',
];

const RULES_NO = [
  'Armanın renklerini, oranlarını veya yazısını değiştirmeyin.',
  'Armayı kendi logonuzla birleştirip yeni bir işaret üretmeyin.',
  'Ohaaaa adını kendi ürün adınızın veya firma adınızın parçası yapmayın.',
  'Ohaaaa’nın ürünü onayladığı, test ettiği veya garanti verdiği izlenimini oluşturmayın.',
  'Armayı fatura, garanti belgesi ve iade formu gibi hukuki belgelerde kullanmayın — satış sözleşmesi sizinle alıcı arasındadır.',
];

export default function BrandKitPage() {
  return (
    <ContentPage
      title="Marka Kullanım Kılavuzu"
      description="Gönderilerinizde Ohaaaa markasını nasıl kullanacağınız."
      breadcrumb="Marka kılavuzu"
    >
      <p>
        Ohaaaa’da listeleme ücretsizdir. Karşılığında tek beklentimiz,
        gönderilerinizde markamızı taşımanız. Aşağıdaki dosyalar bunun için
        hazırlandı; kurallar hem sizi hem bizi korur.
      </p>

      <h2>Dosyalar</h2>
      <ul className="not-prose mt-4 grid gap-3 sm:grid-cols-3">
        {ASSETS.map((a) => (
          <li key={a.file} className="card flex flex-col p-4">
            <h3 className="text-sm font-bold text-fg">{a.name}</h3>
            <p className="mt-1 text-xs text-muted">{a.spec}</p>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-muted">{a.note}</p>
            <a
              href={a.file}
              download
              className="btn mt-3 inline-flex w-fit rounded-full bg-brand px-4 py-2 text-xs font-bold text-[#fffaf5] transition-colors hover:bg-brand-strong"
            >
              İndir
            </a>
          </li>
        ))}
      </ul>

      <h2>Bant siparişi verirken</h2>
      <p>
        Bant <strong>siyah zemin üzerine beyaz baskı</strong>. Bu, matbaaya
        özellikle söylemeniz gereken bir ayrıntı: beyaz mürekkep ayrı bir
        baskı ünitesi ister ve her tesiste yoktur. Sipariş öncesi
        &ldquo;siyah bant üzerine beyaz flekso baskı&rdquo; yapıp yapmadıklarını
        sorun; yapmıyorlarsa beyaz bant üzerine siyah baskı alternatifini
        konuşalım, dosyayı ona göre hazırlarız.
      </p>
      <p>
        Zemin tek renk siyahtır, dört renkten oluşan &ldquo;zengin siyah&rdquo;
        değil. Bant makinesinde dört rengin üst üste tam oturması zordur;
        kayma olursa beyaz yazının kenarında renkli hayalet çıkar.
      </p>

      <h2>Yapabilecekleriniz</h2>
      <ul>
        {RULES_OK.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      <h2>Yapamayacaklarınız</h2>
      <ul>
        {RULES_NO.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      <h2>Neden sınır koyuyoruz</h2>
      <p>
        Marka, üzerinde göründüğü her gönderinin sorumluluğunu bir ölçüde
        üstlenir. Alıcı geç gelen ya da hasarlı gelen bir kutuda bizim armamızı
        görürse bizi de sorumlu tutar. Bu yüzden kurallar dar: armanın nerede
        görüneceği bellidir ve <strong>satışın tarafı olduğumuz izlenimini
        veremez</strong>. Satış sözleşmesi sizinle alıcı arasındadır;
        fatura, garanti ve iade süreçleri de size aittir.
      </p>

      <h2>Kullanım izni</h2>
      <p>
        Bu izin, satıcı hesabınız yayında olduğu sürece geçerlidir ve
        devredilemez. Hesabınız kapandığında yeni baskı yapmayı durdurmanız,
        elinizdeki ambalajı ise tükenene kadar kullanmanız beklenir. Kuralların
        dışına çıkan kullanımlarda izni geri alabiliriz.
      </p>

      <p>
        Sorunuz varsa <Link href="/iletisim">bize yazın</Link>. Farklı bir
        ambalaj ölçüsü için dosya gerekiyorsa hazırlayabiliriz.
      </p>
    </ContentPage>
  );
}
