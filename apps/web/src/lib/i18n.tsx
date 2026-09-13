import { Fragment, type ReactNode } from 'react';

import { splitMessage, type Locale, type MessageKey } from '@ohaaaa/shared';

/**
 * İÇİNDE VURGU GEÇEN cümleler için çeviri.
 *
 * Ayrıştırmanın kendisi `@ohaaaa/shared` içinde (`splitMessage`) ve orada
 * test ediliyor; burada kalan tek iş, `param` parçalarının yerine çağıranın
 * verdiği React düğümünü koymak.
 *
 * NEDEN CÜMLE BÖLÜNMÜYOR: "34.510 ürünü karşılaştırıyoruz" cümlesinde
 * vurgulanan şey sayıdır. Cümleyi üç anahtara bölmek söz dizimini Türkçeye
 * çivilerdi -- İngilizcesi "We compare {n} products in {ad}" diye başlıyor.
 * Cümle tek anahtar kalıyor, sıra çeviriye bırakılıyor.
 */
export function tRich(
  locale: Locale,
  key: MessageKey,
  params: Readonly<Record<string, ReactNode>>,
): ReactNode {
  return splitMessage(locale, key).map((parca, sira) => {
    if (parca.kind === 'text') return parca.value;

    // Verilmeyen değişken OLDUĞU GİBİ kalır -- `t()` ile aynı davranış:
    // "{ad}" görmek, sessizce boşluk basmaktan iyidir, hata görünür olur.
    const deger = parca.name in params ? params[parca.name] : `{${parca.name}}`;

    // `Fragment`, `<span>` DEĞİL: sarmalayıcı bir etiket cümlenin ortasına
    // satır içi bir kutu sokup sözcük kaydırmasını fark ettirmeden bozardı.
    return <Fragment key={`${parca.name}-${sira}`}>{deger}</Fragment>;
  });
}
