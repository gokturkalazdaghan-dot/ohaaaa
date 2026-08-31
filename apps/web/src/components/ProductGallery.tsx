'use client';

import { useState } from 'react';

import { ProductPlaceholder } from './ProductPlaceholder';

/**
 * Ürün görsel galerisi.
 *
 * NEDEN GEREKLİ
 * Ürün sayfası tek bir görsel gösteriyordu; oysa her satıcı teklifi kendi
 * fotoğraf dizisini gönderiyor (`image_urls`) ve bunların hepsi aynı kanonik
 * ürüne ait. Yani veri zaten oradaydı, sayfa yalnızca birini gösterip
 * gerisini çöpe atıyordu. Bir alışveriş sayfasında ürünün ikinci ve üçüncü
 * fotoğrafı süs değildir: kullanıcı arkasını, bağlantı noktalarını,
 * kutu içeriğini oradan görür.
 *
 * TEK GÖRSEL VARSA GALERİ ÇİZİLMEZ. Tek küçük resimden oluşan bir şerit,
 * tıklanacak bir şey varmış izlenimi verir ve kullanıcıyı boşuna uğraştırır.
 *
 * İlk görsel sunucudan gelen sırayla ilk sıradadır; JavaScript yüklenmese de
 * ana görsel görünür (küçük resimler etkileşimlidir, içerik değil).
 *
 * ADRESLER SUNUCUDA ÇÖZÜLÜR ve buraya hazır gelir. Çözümleme `node:fs`
 * kullanıyor (deponun `public/products` klasörünü okuyor); bir istemci
 * bileşeninden çağrılamaz.
 */
export function ProductGallery({
  images,
  title,
  brand,
  slug,
}: {
  /** Sunucuda çözülmüş, doğrudan gösterilebilir adresler. */
  images: string[];
  title: string;
  brand: string | null;
  slug: string;
}) {
  const [index, setIndex] = useState(0);

  // Aralık dışına düşmeyi engelle: dizi değişirse (istemci tarafı bir
  // güncelleme) eski indeks boş bir görsel gösterirdi.
  const current = images[index] ?? images[0] ?? null;

  return (
    <div className="space-y-3">
      {/*
        Görsel zemini AÇIK: ürün fotoğrafları beyaz fonda çekilir, koyu bir
        kutunun içinde ada gibi durur. Kart ızgarasındaki çözümün aynısı.
      */}
      <div className="relative aspect-square overflow-hidden rounded-2xl border border-line bg-surface-photo">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current}
            alt={brand ? `${brand} ${title}` : title}
            // Ürün sayfasının LCP öğesi budur; beklemeye alınmamalı.
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-contain"
          />
        ) : (
          <ProductPlaceholder seed={slug} />
        )}
      </div>

      {images.length > 1 && (
        <ul className="flex flex-wrap gap-2" aria-label="Ürün görselleri">
          {images.map((image, position) => (
            <li key={`${image}-${position}`}>
              <button
                type="button"
                onClick={() => setIndex(position)}
                aria-label={`${position + 1}. görsel`}
                aria-current={position === index ? 'true' : undefined}
                /*
                 * Dokunma hedefi 56px: küçük resim şeridi telefonda parmakla
                 * kullanılır ve 40px'lik kareler ıskalanır (WCAG 2.5.5 tabanı
                 * 44px).
                 */
                className={`h-14 w-14 overflow-hidden rounded-xl border bg-surface-photo transition-colors ${
                  position === index
                    ? 'border-brand'
                    : 'border-line hover:border-brand/50'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
