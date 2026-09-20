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

/*
 * PAZAR DARALTMASI: sözleşmede `market`/`country` diye bir arama alanı
 * yok. Kapsam para birimi ve AĞ kimliğiyle kurulur (ağlar bölgeseldir).
 * Ağ kimlikleri UYDURULMAZ; `GET /v1/networks` ile bulunup verilir.
 */
const sayilar = (ham) =>
  (ham ?? '')
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

const paraBirimleri = (process.env.DENEME_PARA_BIRIMLERI ?? '')
  .split(',')
  .map((p) => p.trim().toUpperCase())
  .filter(Boolean);

const sorgu = {
  query: sorguMetni,
  currencies: paraBirimleri,
  networkIds: sayilar(process.env.DENEME_AG_KIMLIKLERI),
  merchantIds: sayilar(process.env.DENEME_SATICI_KIMLIKLERI),
  poolId: process.env.DENEME_HAVUZ?.trim() || undefined,
  perPage: 5,
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
          '  400/422 = isteğimiz sağlayıcının sözleşmesine uymadı.',
          '  Gövde resmî dokümana göre kuruldu (search[] + per_page) ama',
          '  CANLI doğrulanmadı. Yanıttaki alan adını not edip',
          '  affiliateCom.ts -> buildRequest içinde düzeltin.',
        ].join('\n'),
      );
    }

    if (error.code === 'quota_exhausted') {
      console.error(
        [
          '',
          '  422 = ABONELİK KOTASI tükendi — kodda düzeltilecek bir şey YOK.',
          '  Plan yükseltilmeli ya da fatura dönemi beklenmeli.',
          '',
          '  Not: bu ayrım yanıt METNİNDEN çıkarılan bir sezgidir; doküman',
          '  iki durumu aynı kodla anlatıp ayırt edici bir alan vermiyor.',
          '  Yanlış sınıflandırıldıysa client.ts -> KOTA_KALIBI güncellenir.',
        ].join('\n'),
      );
    }

    process.exit(1);
  }

  throw error;
}

console.log(
  `\n  BAŞARILI — ${sonuc.products.length} ürün normalize edildi` +
    ` (toplam eşleşme: ${sonuc.totalCount ?? 'bildirilmedi'}).\n`,
);

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
