#!/usr/bin/env node
/**
 * KARŞILAŞTIRMA YÜZEYİNDE PARA BİRİMİSİZ TUTAR OLAMAZ
 *
 * NEDEN BU BETİK VAR
 *
 * `formatMoney(cents)` para birimi verilmediğinde TRY varsayar. Tek pazarlı
 * bir sitede bu doğru bir varsayımdı. Küresel katalogda ise 90 USD'lik bir
 * teklif kullanıcıya "₺90,00" olarak görünür -- yanlış fiyat göstermenin en
 * doğrudan hâli ve kullanıcı o fiyata güvenip tıklar.
 *
 * Ölçüldü: `OfferRow` dört tutarı da para birimsiz basıyordu.
 *
 * Hiçbir tip hatası bunu yakalamaz (`currency` isteğe bağlı bir parametre),
 * hiçbir birim testi de yakalamaz (bileşen render edilse bile TRY'li çıktı
 * "doğru" görünür). Yakalanabilecek tek yer çağrının kendisi.
 *
 * KAPSAM: yalnızca ÇOK PARA BİRİMLİ yüzeyler. Sepet ve yönetim panosu
 * bugün tek pazarlı (TR) ve oradaki varsayım hâlâ geçerli; onları da
 * kapsama almak, gerçek bir riski olmayan yerlerde gürültü üretir ve
 * gürültü kontrolün susturulmasına yol açar.
 *
 * Kullanım: node scripts/verify-money-currency.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Çok para birimli yüzeyler: bir kanonik ürünün farklı mağazalardaki
 * tekliflerini gösteren her şey.
 */
const KAPSAM = [
  'apps/web/src/components/OfferRow.tsx',
  'apps/web/src/components/ProductCard.tsx',
  'apps/web/src/components/PriceHistory.tsx',
  'apps/web/src/components/PriceDropCard.tsx',
  /*
   * Arama sayfası da bir karşılaştırma yüzeyi: filtre şeridindeki "en düşük
   * – en yüksek" aralığı etiketsiz basılıyordu. Kapsama alınmasaydı, aynı
   * hata bir sonraki turda buradan geri gelirdi.
   */
  'apps/web/src/app/arama/page.tsx',
];

const bulgular = [];

for (const rel of KAPSAM) {
  let src;
  try {
    src = readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    bulgular.push(`${rel}: dosya bulunamadı — kontrol kapsamı güncellenmeli.`);
    continue;
  }

  const satirlar = src.split('\n');

  satirlar.forEach((satir, i) => {
    // `formatMoney(` ve `formatMoneyCompact(` çağrıları
    for (const m of satir.matchAll(/formatMoney(?:Compact)?\(([^)]*)\)/g)) {
      const args = m[1];
      // Virgül yoksa tek argüman verilmiş: para birimi YOK.
      if (!args.includes(',')) {
        bulgular.push(
          `${rel}:${i + 1}  formatMoney(${args.trim()}) — para birimi verilmemiş, TRY varsayılacak. ` +
            'Karşılaştırma yüzeyinde bu, kullanıcıya YANLIŞ FİYAT göstermektir.',
        );
      }
    }
  });
}

if (bulgular.length > 0) {
  console.error(`\n✗ ${bulgular.length} para birimsiz tutar bulundu\n`);
  for (const b of bulgular) console.error(`  ${b}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ Karşılaştırma yüzeyindeki tutarlar para birimi taşıyor (${KAPSAM.length} dosya)`);
