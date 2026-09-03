import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage } from '@/components/ContentPage';

/**
 * Fiyat takibinin nasıl işlediğini anlatan sayfa (madde 13'teki
 * /fiyat-takip yolu).
 *
 * Bu sayfa fırsat sayfalarının dayanağıdır: orada "%30 düştü" yazıyorsa,
 * burada o sayının nereden geldiği yazmalı. Yöntemi gizleyen bir fırsat
 * listesi, ölçüm değil reklamdır.
 *
 * SAYFADA SAYI YOK.
 * "Günde 2 milyon fiyat ölçüyoruz" gibi bir cümle kurmuyoruz: o rakamı
 * ölçen bir telemetri yok ve olmadan yazmak uydurma olur. Anlatılan şey
 * yöntemin kendisi.
 */

export const metadata: Metadata = {
  title: 'Fiyat Takibi Nasıl İşliyor?',
  description:
    'Ohaaaa fiyat düşüşünü nasıl ölçüyor: kendi gözlemlerimiz, en az iki ölçüm kuralı ' +
    've mağazanın üstü çizili fiyatını neden kullanmadığımız.',
  alternates: { canonical: '/fiyat-takip' },
  openGraph: {
    title: 'Fiyat Takibi Nasıl İşliyor? · Ohaaaa',
    description: 'Düşüşü mağaza değil, biz ölçüyoruz. Yöntemin tamamı bu sayfada.',
  },
};

export default function PriceTrackingPage() {
  return (
    <ContentPage
      title="Fiyat Takibi Nasıl İşliyor?"
      description="Bir ürünün ucuzladığını söylemeden önce onu birkaç kez ölçüyoruz. Yöntemin tamamı burada."
      updatedAt="2026-09-03"
      breadcrumb="Fiyat takibi"
    >
      <h2>Fiyatı biz ölçüyoruz</h2>
      <p>
        Bir ürünün fiyatı her değiştiğinde, o değişikliği tarih damgasıyla birlikte
        kaydediyoruz. Bir üründe zamanla biriken bu kayıtlar o ürünün{' '}
        <strong>fiyat geçmişi</strong> oluyor. Ürün sayfasındaki fiyat grafiği ve{' '}
        <Link href="/firsatlar">Fırsatlar</Link> sayfasındaki düşüş oranları, aynı
        kayıtlardan çıkıyor.
      </p>

      <h2>Mağazanın üstü çizili fiyatını kullanmıyoruz</h2>
      <p>
        Çoğu sitede gördüğünüz “₺2.999 <s>₺5.999</s>” gösterimindeki ikinci sayı,
        mağazanın kendi beyanıdır. Ürün o fiyattan hiç satılmamış olabilir. Biz bu
        alanı bir indirim kanıtı saymıyoruz.
      </p>
      <p>
        Bir düşüş oranı yazdığımızda karşılaştırdığımız şey şudur:{' '}
        <strong>bugünkü en düşük teklif</strong> ile{' '}
        <strong>gözlem penceresi içinde kendi ölçtüğümüz en yüksek fiyat</strong>. İkisi de
        gerçekten görülmüş fiyatlardır.
      </p>

      <h2>En az iki ölçüm kuralı</h2>
      <p>
        Bir ürünü yalnızca bir kez ölçmüşsek, o ürün fırsat listesine{' '}
        <strong>girmez</strong>. Karşılaştırılacak önceki bir değer yokken “düştü” demek,
        hiç ölçmeden demekle aynı şeydir.
      </p>
      <p>
        Aynı sebeple, gözlem birkaç güne yayılmışsa bunu kartın üzerinde{' '}
        <strong>“kısa gözlem”</strong> notuyla belirtiyoruz. Üç günlük ölçümü otuz günlük
        gibi sunmuyoruz.
      </p>

      <h2>Kendi takibinizi kurun</h2>
      <p>
        Bir ürünü favorilerinize eklediğinizde, o andaki fiyatını kaydediyoruz. Fiyat
        belirgin biçimde düşerse size e-posta gönderiyoruz. Bildirimi favori listenizden
        tek tıkla kapatabilirsiniz.
      </p>
      <p>
        Takip için gereken tek veri e-posta adresinizdir; başka kişisel bilgi
        istemiyoruz. Ayrıntısı{' '}
        <Link href="/kvkk">KVKK Aydınlatma Metni’nde</Link> yazılı.
      </p>

      <h2>Ölçemediğimiz şeyi yazmıyoruz</h2>
      <p>
        Yeterli fiyat geçmişi birikmemiş bir ürün için düşüş oranı üretmiyoruz ve fırsat
        sayfası boş kalabiliyor. Boş bir liste, uydurma bir indirimden iyidir. Aynı ilke
        sitenin geri kalanı için de geçerli:{' '}
        <Link href="/hakkimizda">nasıl çalıştığımızı</Link> ve neyi göstermediğimizi
        açık yazıyoruz.
      </p>
    </ContentPage>
  );
}
