import Link from 'next/link';

import { isAffiliateOnly } from '@/lib/env';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-bg">
      {/*
        KURULUM ÇAĞRISI BURADAN TAŞINDI.

        Gerekçe "kararını vermiş kullanıcıya sor" idi ve mantıklıydı; ama
        ÖLÇÜM onu çürüttü: iPhone Safari'de bölüm sayfanın 4.495 pikselinde,
        5.523 piksellik bir sayfanın en dibinde kalıyordu. Oraya inen kimse
        olmadığı için kullanıcı "Safari'de kurulum düğmesi yok" diye
        bildirdi -- bölüm vardı, görünmüyordu.

        Artık ana sayfada, arama kutusunun hemen altında (bkz. `app/page.tsx`).
        Footer'da İKİNCİ bir kopya bırakılmadı: aynı çağrıyı iki kez sormak,
        birinci sefer hayır diyene ısrar etmektir.
      */}
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-10 text-left sm:grid-cols-2 sm:px-6">
        <div>
          <p className="font-semibold text-fg">Ohaaaa.com</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/hakkimizda" className="text-muted hover:text-fg">
                Hakkımızda
              </Link>
            </li>
            <li>
              <Link href="/firsatlar" className="text-muted hover:text-fg">
                Fırsatlar
              </Link>
            </li>
            <li>
              <Link href="/fiyat-takip" className="text-muted hover:text-fg">
                Fiyat takibi
              </Link>
            </li>
            {/*
              Pazar yeri CTA'si yalnizca hybrid kipte gorunur. Ortaklik
              yayincisi olarak konumlanirken "Satici ol" cagrisini vitrinde
              tutmak, ziyaretciye ve ortaklik agi denetcisine celiskili bir
              is modeli gosterir.
            */}
            {isAffiliateOnly ? null : (
              <li>
                <Link href="/tasoron/basvuru" className="text-muted hover:text-fg">
                  Satıcı ol
                </Link>
              </li>
            )}
            <li>
              <Link href="/iletisim" className="text-muted hover:text-fg">
                İletişim
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-fg">Yasal</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/gizlilik" className="text-muted hover:text-fg">
                Gizlilik
              </Link>
            </li>
            <li>
              <Link href="/kosullar" className="text-muted hover:text-fg">
                Kullanım şartları
              </Link>
            </li>
            <li>
              <Link href="/kvkk" className="text-muted hover:text-fg">
                KVKK
              </Link>
            </li>
            {/*
              ORTAKLIK ACIKLAMASI FOOTER'DA OLMAK ZORUNDA.

              Sayfa vardi, sitemap'te vardi, uc yasal metnin icinden
              baglantiliydi ve ana sayfadaki guven bloguna konmustu -- ama
              site GENELINDE erisilebilir degildi. Bir urun sayfasindan ya
              da kategori sayfasindan ulasmanin yolu yoktu.

              Ortaklik iliskisinin aciklanmasi bir nezaket degil yukumluluk:
              ortaklik aglari (Awin dahil) ve reklam duzenlemeleri
              aciklamanin "acik ve kolay ulasilabilir" olmasini sart kosar.
              Footer her sayfada oldugu icin bu sartin karsilandigi tek yer.
            */}
            <li>
              <Link href="/ortaklik-aciklamasi" className="text-muted hover:text-fg">
                Ortaklık açıklaması
              </Link>
            </li>
          </ul>
        </div>
      </div>
      {/*
        TELEFONA AL — KARE KOD, MASAÜSTÜNDE, HER SAYFADA.

        Yukarıdaki nota göre kurulum ÇAĞRISI footer'dan taşındı ve o karar
        geçerli: telefonda footer 4.495 pikselde kalıyor, oraya inen olmuyor.
        Burada çizilen o çağrı DEĞİL.

        Kare kodun işi başka: "bilgisayardayım, bunu telefonuma geçireyim."
        Onu gören kişi zaten masaüstünde ve kendi ekranındaki kodu kendi
        telefonuyla okutuyor. Telefonda hiç çizilmiyor -- insanın kendi
        ekranındaki kodu kendi kamerasıyla okutması anlamsız.

        `lg:` eşiğinden sonra görünüyor ve bu JS'siz: platform tespiti için
        istemci bileşeni yapmak, footer'ı bütün sayfalara istemci yükü
        bindirmek demekti. Görünüm genişliği burada "masaüstü mü" sorusunun
        yeterli vekili.

        `InstallApp` ana sayfada masaüstünde aynı kodu gösteriyor; yani ana
        sayfada masaüstünde iki kod birden görünüyor. Bilinçli bir bedel:
        footer HER sayfada, InstallApp yalnızca ana sayfada. Kategori, ürün
        ve arama sayfalarındaki masaüstü ziyaretçisinin başka yolu yok.
      */}
      <div className="mx-auto hidden max-w-6xl items-center gap-4 px-4 pb-8 lg:flex sm:px-6">
        {/*
          Kare kod SABİT bir dosya: içinde yalnızca ana sayfanın adresi var,
          kişiye özel hiçbir şey yok. Çalışma anında üretmek bir kitaplık
          eklemek demekti.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marka/ohaaaa-qr.svg"
          alt="ohaaaa.com adresini açan kare kod"
          width={72}
          height={72}
          className="h-[72px] w-[72px] shrink-0 rounded-lg border border-line bg-white p-1"
        />
        <p className="text-xs leading-relaxed text-muted">
          <strong className="block text-fg">Ohaaaa’yı telefonuna al</strong>
          Kamerayı koda tut. Tarayıcıdan kurulan bir web uygulaması —
          uygulama mağazasına gerek yok.
        </p>
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-subtle sm:px-6">
        © {new Date().getFullYear()} Armanalabs. Ohaaaa.com, Armanalabs tarafından işletilir.
        Fiyatları satıcı belirler.
      </p>
    </footer>
  );
}
