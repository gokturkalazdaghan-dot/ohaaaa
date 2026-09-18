import { ImageResponse } from 'next/og';

import { getCategoryTree } from '@/data/catalog';

/**
 * Paylaşılan kategori bağlantısının önizleme görseli.
 *
 * ÖLÇÜLEN EKSİK: ürün sayfasının kendi kartı vardı, ana sayfanın sabit
 * kartı vardı, kategori sayfasının HİÇBİRİ yoktu -- `og:image` boş
 * dönüyordu. WhatsApp'ta ya da X'te paylaşılan bir kategori bağlantısı
 * görselsiz, dolayısıyla tıklanmayan bir kart olarak çıkıyordu.
 *
 * SAYFADA YALNIZCA ÖLÇÜLMÜŞ DEĞER YAZAR. Ürün sayısı katalogdan gelir;
 * okunamazsa satır hiç çizilmez. "Binlerce ürün" gibi doğrulanamayan bir
 * cümle kurulmaz. Kategori bulunamazsa sade bir marka kartı döner --
 * kırık görsel yerine çalışan bir kart.
 */

export const alt = 'Ohaaaa kategori fiyat karşılaştırması';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  /*
   * Ağaç zaten önbellekli ve şerit için her istekte okunuyor; buradan
   * okumak ek bir sorgu üretmiyor. Ayrıca `groupCount` KENDİ + ÇOCUKLAR
   * toplamı, yani kullanıcının o sayfada gerçekten göreceği sayı.
   */
  const agac = await getCategoryTree().catch(() => []);

  let ad: string | null = null;
  let adet: number | null = null;

  for (const dugum of agac) {
    if (dugum.category.slug === slug) {
      ad = dugum.category.name;
      adet = dugum.groupCount;
      break;
    }
    const cocuk = dugum.children.find((c) => c.category.slug === slug);
    if (cocuk) {
      ad = cocuk.category.name;
      adet = cocuk.groupCount;
      break;
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0b0b0d',
          color: '#f5f5f7',
          padding: 72,
          fontSize: 40,
        }}
      >
        <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, color: '#ff5a1f' }}>
          ohaaaa
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 68, fontWeight: 800, lineHeight: 1.15 }}>
            {ad ?? 'Ohaaaa'}
          </div>

          {adet !== null && adet > 0 && (
            <div style={{ display: 'flex', marginTop: 24, fontSize: 40, color: '#a1a1aa' }}>
              {adet.toLocaleString('tr-TR')} ürün karşılaştırılıyor
            </div>
          )}
        </div>

        <div style={{ display: 'flex', fontSize: 28, color: '#a1a1aa' }}>
          Kargo dahil toplam fiyatı karşılaştırın
        </div>
      </div>
    ),
    size,
  );
}
