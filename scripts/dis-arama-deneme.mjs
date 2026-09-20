#!/usr/bin/env node
/**
 * AFFILIATE.COM UCU GERÇEKTEN ÇALIŞIYOR MU?
 *
 * Bu betik, `POST https://api.affiliate.com/v1/products` çağrısını GERÇEK
 * bir anahtarla bir kez yapar ve dönen ürünü Ohaaaa'nın normalize
 * edilmiş modeline çevirip yazdırır.
 *
 * NEDEN AYRI BİR BETİK, NEDEN TEST DEĞİL
 * Birim testleri (packages/shared/src/productSearch/productSearch.test.ts)
 * normalizasyonu ve 429/422/503/zaman aşımı yollarını sahte bir `fetch`
 * ile doğruluyor; anahtar gerektirmedikleri için CI'da çalışıyorlar.
 * Ama hiçbir sahte yanıt "sözleşme doğru mu" sorusunu cevaplayamaz -- o
 * soruyu ancak gerçek uç cevaplar ve gerçek uç KİMLİK BİLGİSİ ister. CI
 * bu betiği çalıştırmaz ve çalıştırmamalıdır: iş akışında sır yok
 * (bkz. .github/workflows/ci.yml) ve bu korunması gereken bir özellik.
 *
 * KULLANIM
 *   AFFILIATE_COM_API_KEY=... npm run dis-arama:deneme -- "oyuncu kulaklık"
 *
 * NE YAZDIRIR, NE YAZDIRMAZ
 * Anahtar HİÇBİR koşulda çıktıya girmez: ne başlık, ne hata metni, ne de
 * istek dökümü. Yazdırılan şey istek gövdesi, HTTP durumu ve normalize
 * edilmiş ilk birkaç üründür.
 */

import { readFileSync } from 'node:fs';

const KOK = new URL('..', import.meta.url).pathname;
const DIST = `${KOK}packages/shared/dist/productSearch/index.js`;

function cik(mesaj, kod = 1) {
  console.error(`\n  ${mesaj}\n`);
  process.exit(kod);
}

try {
  readFileSync(DIST);
} catch {
  cik(
    [
      '@ohaaaa/shared derlenmemiş.',
      '',
      '  Çözüm: npm run build --workspace @ohaaaa/shared',
    ].join('\n'),
  );
}

const { affiliateComProvider, fetchExternalProducts, productSearchCacheKey, ProductSearchError } =
  await import(DIST);

const apiKey = (process.env.AFFILIATE_COM_API_KEY ?? '').trim();

if (apiKey === '') {
  cik(
    [
      'AFFILIATE_COM_API_KEY tanımlı değil.',
      '',
      '  Bu betik GERÇEK bir çağrı yapar; sahte veriyle çalışmaz.',
      '  Anahtar olmadan Ohaaaa tarafında da dış arama KAPALIDIR ve',
      '  katalog araması bundan etkilenmez.',
    ].join('\n'),
  );
}

const sorguMetni = process.argv.slice(2).join(' ').trim() || 'kulaklık';

const sorgu = {
  query: sorguMetni,
  market: process.env.DENEME_PAZAR?.trim() || undefined,
  country: process.env.DENEME_ULKE?.trim() || undefined,
  currency: process.env.DENEME_PARA_BIRIMI?.trim() || undefined,
  limit: 5,
};

console.log('\nAffiliate.com ürün arama denemesi');
console.log('─'.repeat(60));
console.log(`  Uç nokta      : ${process.env.AFFILIATE_COM_ENDPOINT?.trim() || affiliateComProvider.endpoint}`);
console.log(`  Yetkilendirme : Bearer *** (${apiKey.length} karakter)`);
console.log(`  İstek gövdesi : ${JSON.stringify(affiliateComProvider.buildRequest(sorgu))}`);
console.log(`  Önbellek anah.: ${productSearchCacheKey(affiliateComProvider.id, sorgu)}`);
console.log('─'.repeat(60));

let sonuc;
try {
  sonuc = await fetchExternalProducts({
    provider: affiliateComProvider,
    apiKey,
    query: sorgu,
    endpoint: process.env.AFFILIATE_COM_ENDPOINT?.trim() ?? '',
    timeoutMs: 10_000,
  });
} catch (error) {
  if (error instanceof ProductSearchError) {
    console.error(`\n  BAŞARISIZ  kod=${error.code} durum=${error.status ?? '-'}`);
    console.error(`  ${error.message}`);

    if (error.code === 'invalid_request') {
      console.error(
        [
          '',
          '  422/400 = isteğimiz sağlayıcının sözleşmesine uymadı.',
          '  Bu BEKLENEN bir sonuçtur: istek gövdesinin alan adları resmî',
          '  dokümanla doğrulanmadı (bkz. affiliateCom.ts dosya başlığı).',
          '  Doğru gövde öğrenildiğinde yapılacak iş buildRequest içinde',
          '  tek bir satırdır.',
        ].join('\n'),
      );
    }

    process.exit(1);
  }

  throw error;
}

console.log(`\n  BAŞARILI — ${sonuc.products.length} ürün normalize edildi.\n`);

for (const urun of sonuc.products.slice(0, 3)) {
  console.log(JSON.stringify(urun, null, 2));
  console.log('');
}

const yerTutuculu = sonuc.products.filter((u) => u.unresolvedLinkPlaceholders);

if (yerTutuculu.length > 0) {
  console.log('─'.repeat(60));
  console.log(
    [
      `  DİKKAT: ${yerTutuculu.length} üründe çözülmemiş yer tutucu (@@@ / ### / {…})`,
      '  bulundu ve o adresler DÜŞÜRÜLDÜ.',
      '',
      '  Bu bir hata değil, bilinçli bir karar: yer tutucunun gerçek API',
      '  kullanımında nasıl doldurulduğu doğrulanmadan link üretmek,',
      '  geçerli GÖRÜNEN ama atıfsız kalan tıklamalar demektir.',
      '',
      '  Doldurma kuralı sağlayıcıdan teyit alındığında affiliateCom.ts',
      '  içindeki `adres()` okuyucusuna eklenir.',
    ].join('\n'),
  );
}
