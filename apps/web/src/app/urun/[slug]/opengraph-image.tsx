import { ImageResponse } from 'next/og';

import { formatMoney } from '@ohaaaa/shared';

import { getProductGroup } from '@/data/catalog';

/**
 * Paylaşılan ürün bağlantısının önizleme görseli.
 *
 * WhatsApp'ta paylaşılan bir bağlantının kartında ne yazdığı, tıklanıp
 * tıklanmayacağını belirler. Site geneli tek bir görsel her ürün için aynı
 * kartı üretir; burada üretilen kart o ürünün GERÇEK verisini taşır.
 *
 * SAYFADA YALNIZCA ÖLÇÜLMÜŞ DEĞER YAZAR.
 * Fiyat yoksa fiyat satırı hiç çizilmez; "en ucuz", "%X indirim" gibi
 * doğrulanamayan bir cümle kurulmaz. Veri okunamazsa sade bir marka kartı
 * döner — kırık görsel yerine çalışan bir kart.
 */

export const alt = 'Ohaaaa ürün fiyat karşılaştırması';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const group = await getProductGroup(slug).catch(() => null);

  const baslik = group?.title ?? 'Ohaaaa';
  /*
   * ₺ İŞARETİ BURADA KULLANILMAZ.
   * Görsel üretiminin varsayılan yazı tipi U+20BA (Türk lirası) glifini
   * taşımıyor; işaret yerine boş kutu çiziliyordu. Ölçüldü. Sayfanın kendi
   * içinde ₺ doğru görünüyor (oradaki yazı tipi taşıyor), yalnızca bu
   * görselde "TL" yazılıyor.
   */
  const fiyat =
    group?.minPriceCents !== null && group?.minPriceCents !== undefined
      ? `${formatMoney(group.minPriceCents).replace('₺', '').trim()} TL`
      : null;
  const teklif = group?.offerCount ?? 0;

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
          <div style={{ display: 'flex', fontSize: 62, fontWeight: 800, lineHeight: 1.15 }}>
            {baslik.length > 80 ? `${baslik.slice(0, 80)}…` : baslik}
          </div>

          {fiyat && (
            <div style={{ display: 'flex', marginTop: 28, fontSize: 52, fontWeight: 800 }}>
              {fiyat}
              {teklif > 1 && (
                <span style={{ marginLeft: 20, fontSize: 34, fontWeight: 400, color: '#a1a1aa' }}>
                  · {teklif} mağazada
                </span>
              )}
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
