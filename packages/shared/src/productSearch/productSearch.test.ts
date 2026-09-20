import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  affiliateComProvider,
  cozulmemisYerTutucuVar,
  normalizeAffiliateComProduct,
  AFFILIATE_COM_DEFAULT_PER_PAGE,
  AFFILIATE_COM_ENDPOINT,
  AFFILIATE_COM_MAX_PER_PAGE,
} from './affiliateCom.js';
import { normalizeSearchQuery, productSearchCacheKey } from './cacheKey.js';
import { fetchExternalProducts, retryAfterSaniye } from './client.js';
import { ProductSearchError } from './types.js';

/**
 * Resmî doküman (`/concepts/products`, `/api-reference/products/search`)
 * alan alan takip edilerek kurulmuş ham ürün.
 *
 * CANLI YANIT DEĞİLDİR -- gerçek kimlik bilgisi yok, 200 dönen bir yanıt
 * hiç görülmedi. Testler sözleşmeye uyumu ölçer, gerçeği değil.
 */
const ORNEK_URUN = {
  id: 'prd_01hxyz',
  barcode: '5099206039292',
  name: '  Logitech G Pro X Kulaklık  ',
  description: 'Oyuncu kulaklığı',
  commissionable_status: 'commissionable',
  urls: {
    outclick: 'https://outclick.co/a/ENCRYPTED_TOKEN',
    direct: 'https://magaza.com/p/1',
    affiliate: 'https://partners.ornek-ag.com/click?merchant=12345&aff=@@@',
  },
  commission_url: 'https://partners.ornek-ag.com/click?merchant=12345&aff=@@@&sub=###',
  direct_url: 'https://magaza.com/p/1',
  image_url: 'https://cdn.magaza.com/1.jpg',
  currency: 'try',
  regular_price: 1899.0,
  final_price: 1299.9,
  on_sale: true,
  availability: 'InStock',
  stock_quantity: 12,
  sku: 'LG-PROX-1',
  mpn: 'MPN-991',
  identifiers: { barcode: '5099206039292', ean: '5099206039292', sku: 'LG-PROX-1' },
  brand: 'Logitech',
  model: 'G Pro X',
  category: 'Electronics > Audio > Headphones',
  country: 'China',
  condition: 'new',
  network: { id: 329, name: 'Awin UK', logo_url: 'https://img.affiliate.com/n.png' },
  merchant: { id: 54419, name: 'Örnek Mağaza', logo_url: 'https://img.affiliate.com/m.png' },
  updated_at: '2026-09-01T10:00:00Z',
  started_at: '2026-08-01T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Normalizasyon
// ---------------------------------------------------------------------------

test('ham ürün Ohaaaa modeline normalize edilir', () => {
  const urun = normalizeAffiliateComProduct(ORNEK_URUN);
  assert.ok(urun);

  assert.equal(urun.providerId, 'prd_01hxyz');
  assert.equal(urun.name, 'Logitech G Pro X Kulaklık');
  assert.equal(urun.sku, 'LG-PROX-1');
  assert.equal(urun.currency, 'TRY');
  assert.equal(urun.availability, 'in_stock');
  assert.equal(urun.condition, 'new');
  assert.equal(urun.stockQuantity, 12);
  assert.equal(urun.category, 'Electronics > Audio > Headphones');
  assert.equal(urun.source, 'affiliate-com');
});

test('network ve merchant OBJE olarak gelir; adları okunur', () => {
  /*
   * GERİLEME TESTİ. Önceki sürümde ortak bir "ilk dolu değer" yardımcısı
   * `network` adayını görüp OBJEYİ döndürüyor, metin okuyucusu objeyi
   * okuyamayıp null veriyor ve `network.name` adayına HİÇ ulaşılmıyordu.
   * Gerçek yanıtta ağ ve satıcı adı daima boş çıkardı.
   */
  const urun = normalizeAffiliateComProduct(ORNEK_URUN);

  assert.equal(urun?.network, 'Awin UK');
  assert.equal(urun?.merchant, 'Örnek Mağaza');
});

test('addedAt kaynağı started_at; added_at diye bir alan YOK', () => {
  const urun = normalizeAffiliateComProduct(ORNEK_URUN);
  assert.equal(urun?.addedAt, '2026-08-01T10:00:00.000Z');
  assert.equal(urun?.updatedAt, '2026-09-01T10:00:00.000Z');

  // `added_at` gönderilse bile okunmaz: sözleşmede yanıt alanı değil.
  const sadeceAddedAt = normalizeAffiliateComProduct({
    id: '1',
    name: 'Ü',
    added_at: '2026-01-01T00:00:00Z',
  });
  assert.equal(sadeceAddedAt?.addedAt, null);
});

test('fiyatlar KURUŞA çevrilir', () => {
  const urun = normalizeAffiliateComProduct(ORNEK_URUN);
  assert.equal(urun?.regularPriceCents, 189_900);
  // 1299.9 -> kayan nokta; 129_989.99... değil 129_990 olmalı.
  assert.equal(urun?.finalPriceCents, 129_990);
});

test('sale_discount BİLEREK okunmuyor -- doküman kendi içinde çelişiyor', () => {
  /*
   * /concepts/products      : "para birimi cinsinden indirim TUTARI" (float)
   * /api-reference/.../search: "regular_price'a uygulanan YÜZDE" (integer)
   *
   * Birini seçmek varsayım olurdu; ₺150 indirimi %150 diye basmak
   * kullanıcıya doğrudan yanlış bilgi vermektir. Alan modele hiç girmiyor.
   */
  const urun = normalizeAffiliateComProduct({ ...ORNEK_URUN, sale_discount: 150 });
  assert.equal('saleDiscount' in (urun ?? {}), false);
  assert.equal('saleDiscountPercent' in (urun ?? {}), false);
});

test('kimlik ya da ad yoksa ürün düşürülür -- uydurulmaz', () => {
  assert.equal(normalizeAffiliateComProduct({ name: 'Adı var, kimliği yok' }), null);
  assert.equal(normalizeAffiliateComProduct({ id: 'x' }), null);
  assert.equal(normalizeAffiliateComProduct(null), null);
  assert.equal(normalizeAffiliateComProduct('metin'), null);
});

test('eksik alanlar null kalır; varsayılan DEĞER konmaz', () => {
  const urun = normalizeAffiliateComProduct({ id: '1', name: 'Ürün' });
  assert.ok(urun);

  assert.equal(urun.currency, null);
  assert.equal(urun.finalPriceCents, null);
  assert.equal(urun.regularPriceCents, null);
  assert.equal(urun.originCountry, null);
  assert.equal(urun.merchant, null);
  assert.equal(urun.network, null);
  // "Bilmiyoruz" ile "stokta yok" ayrı: eksik değer `unknown`.
  assert.equal(urun.availability, 'unknown');
  assert.equal(urun.condition, 'unknown');
});

// ---------------------------------------------------------------------------
// Sözleşmenin sabit değer kümeleri
// ---------------------------------------------------------------------------

test('availability: InStock / OutOfStock / Unknown açık eşleme', () => {
  const durum = (value: unknown) =>
    normalizeAffiliateComProduct({ id: '1', name: 'Ü', availability: value })?.availability;

  assert.equal(durum('InStock'), 'in_stock');
  assert.equal(durum('OutOfStock'), 'out_of_stock');
  assert.equal(durum('Unknown'), 'unknown');
  assert.equal(durum(null), 'unknown');
  // Tanınmayan etiket out_of_stock SAYILMAZ -- satılabilir ürün gizlenmez.
  assert.equal(durum('kismen'), 'unknown');
});

test('condition: open-box kendi adıyla taşınır, used a katlanmaz', () => {
  const durum = (value: string) =>
    normalizeAffiliateComProduct({ id: '1', name: 'Ü', condition: value })?.condition;

  assert.equal(durum('new'), 'new');
  assert.equal(durum('used'), 'used');
  assert.equal(durum('refurbished'), 'refurbished');
  assert.equal(durum('open-box'), 'open-box');
  assert.equal(durum('Open-Box'), 'open-box');
  assert.equal(durum('tasnif-disi'), 'unknown');
});

test('country MENŞE ülkedir; biçim dayatılmaz', () => {
  // "China" gibi bir ülke ADI da geçerli veridir. İki harf dayatmak onu
  // sessizce silerdi -- doküman biçimi söylemiyor.
  assert.equal(normalizeAffiliateComProduct(ORNEK_URUN)?.originCountry, 'China');
  assert.equal(
    normalizeAffiliateComProduct({ id: '1', name: 'Ü', country: 'TR' })?.originCountry,
    'TR',
  );
});

// ---------------------------------------------------------------------------
// Barkod -- ham değer korunur
// ---------------------------------------------------------------------------

test('barkod HAM hâliyle korunur; rakam süzgecinden geçirilmez', () => {
  const urun = normalizeAffiliateComProduct(ORNEK_URUN);
  assert.equal(urun?.barcode, '5099206039292');
  assert.equal(urun?.barcodeDigits, '5099206039292');
});

test('ISBN-10 un X kontrol basamağı SİLİNMEZ', () => {
  /*
   * Doküman `barcode` alanının ISBN de olabileceğini ve büyük/küçük harfe
   * DUYARLI olduğunu söylüyor. Rakam süzgeci `X`'i silip geçersiz, hiçbir
   * şeyle eşleşmeyen bir kod üretirdi.
   */
  const urun = normalizeAffiliateComProduct({ id: '1', name: 'Kitap', barcode: '043970818X' });

  assert.equal(urun?.barcode, '043970818X');
  // Rakam dışı karakter var: kolaylık alanı boş kalır, YARIM kod üretmez.
  assert.equal(urun?.barcodeDigits, null);
});

// ---------------------------------------------------------------------------
// Adres önceliği ve yer tutucular
// ---------------------------------------------------------------------------

test('çözülmemiş yer tutucu kalıbı tanınır', () => {
  assert.equal(cozulmemisYerTutucuVar('https://x.com/c?sub=@@@'), true);
  assert.equal(cozulmemisYerTutucuVar('https://x.com/c?sub=###'), true);
  assert.equal(cozulmemisYerTutucuVar('https://x.com/c?sub={SUB_ID}'), true);
  // Tek `#` gerçek bir adres parçasıdır (fragment); yanlış alarm vermez.
  assert.equal(cozulmemisYerTutucuVar('https://magaza.com/p/1#aciklama'), false);
});

test('URL önceliği: outclick > affiliate; direct ASLA tracking olmaz', () => {
  const urun = normalizeAffiliateComProduct(ORNEK_URUN);
  assert.ok(urun);

  // outclick yer tutucu taşımaz ve tıklamayı kaydeden tek adrestir.
  assert.equal(urun.trackingUrl, 'https://outclick.co/a/ENCRYPTED_TOKEN');
  assert.equal(urun.trackingUrlKind, 'outclick');
  assert.equal(urun.outclickUrl, 'https://outclick.co/a/ENCRYPTED_TOKEN');
  // urls.affiliate `@@@` taşıyordu: düşürüldü ve işaretlendi.
  assert.equal(urun.affiliateUrl, null);
  assert.equal(urun.unresolvedLinkPlaceholders, true);
  assert.equal(urun.directUrl, 'https://magaza.com/p/1');
});

test('outclick yoksa temiz affiliate adresi kullanılır', () => {
  const urun = normalizeAffiliateComProduct({
    id: '1',
    name: 'Ü',
    urls: { affiliate: 'https://partners.ornek-ag.com/click?aff=3074081&sub=abc' },
  });

  assert.equal(urun?.trackingUrl, 'https://partners.ornek-ag.com/click?aff=3074081&sub=abc');
  assert.equal(urun?.trackingUrlKind, 'affiliate');
  assert.equal(urun?.unresolvedLinkPlaceholders, false);
});

test('legacy commission_url yalnızca urls.affiliate yoksa okunur', () => {
  const urun = normalizeAffiliateComProduct({
    id: '1',
    name: 'Ü',
    commission_url: 'https://legacy.ornek-ag.com/click?aff=3074081',
  });

  assert.equal(urun?.affiliateUrl, 'https://legacy.ornek-ag.com/click?aff=3074081');
  assert.equal(urun?.trackingUrlKind, 'affiliate');
});

test('YER TUTUCULU ADRES HİÇBİR KOŞULDA DIŞARI VERİLMEZ', () => {
  /*
   * Resmî rapor dokümanı: doldurulmamış @@@ / ### tıklama kaydına HARFİ
   * HARFİNE geçer ve hiçbir raporla eşleşmez. Link geçerli GÖRÜNÜR ama
   * tıklama atıfsız kalır -- sessiz gelir kaybı.
   */
  const urun = normalizeAffiliateComProduct({
    id: '1',
    name: 'Ürün',
    urls: { affiliate: 'https://partners.ornek-ag.com/click?aff=@@@&sub=###' },
    commission_url: 'https://legacy.ornek-ag.com/click?aff=@@@',
    direct_url: 'https://magaza.com/p/1',
  });

  assert.ok(urun);
  assert.equal(urun.affiliateUrl, null);
  assert.equal(urun.trackingUrl, null);
  assert.equal(urun.trackingUrlKind, null);
  assert.equal(urun.unresolvedLinkPlaceholders, true);

  // Hiçbir alan yer tutucu taşımamalı.
  for (const deger of [urun.trackingUrl, urun.affiliateUrl, urun.outclickUrl, urun.directUrl]) {
    if (deger !== null) assert.equal(cozulmemisYerTutucuVar(deger), false);
  }

  // Doğrudan adres etkilenmez: ürün yine gösterilebilir.
  assert.equal(urun.directUrl, 'https://magaza.com/p/1');
});

test('http/https dışındaki şema reddedilir', () => {
  const urun = normalizeAffiliateComProduct({
    id: '1',
    name: 'Ürün',
    direct_url: 'javascript:alert(1)',
  });

  assert.equal(urun?.directUrl, null);
  assert.equal(urun?.unresolvedLinkPlaceholders, false);
});

// ---------------------------------------------------------------------------
// İstek gövdesi -- resmî sözleşme
// ---------------------------------------------------------------------------

test('istek gövdesi search[] + per_page biçimindedir', () => {
  const govde = affiliateComProvider.buildRequest({ query: '  oyuncu kulaklık ' });

  assert.deepEqual(govde, {
    search: [{ field: 'any', value: 'oyuncu kulaklık', operator: 'LIKE' }],
    per_page: AFFILIATE_COM_DEFAULT_PER_PAGE,
  });

  // Eski (yanlış) biçimden hiçbir iz kalmamalı.
  assert.equal('query' in govde, false);
  assert.equal('limit' in govde, false);
});

test('para birimi ve ağ/satıcı filtreleri search[] içine koşul olarak girer', () => {
  const govde = affiliateComProvider.buildRequest({
    query: 'kulaklık',
    currencies: ['try', 'eur'],
    networkIds: [329, 12],
    merchantIds: [54419],
    perPage: 10,
  });

  assert.deepEqual(govde.search, [
    { field: 'any', value: 'kulaklık', operator: 'LIKE' },
    // Aynı value içinde `||` = VEYA; ayrı objeler = VE.
    { field: 'currency', value: 'TRY||EUR', operator: '=' },
    { field: 'network.id', value: '329||12', operator: '=' },
    { field: 'merchant.id', value: '54419', operator: '=' },
  ]);
  assert.equal(govde.per_page, 10);
});

test('boş filtre dizileri gövdeye koşul EKLEMEZ', () => {
  const govde = affiliateComProvider.buildRequest({
    query: 'kulaklık',
    currencies: [],
    networkIds: [],
    merchantIds: [],
  });

  assert.equal((govde.search as unknown[]).length, 1);
});

test('page yalnızca istendiğinde gönderilir', () => {
  assert.equal('page' in affiliateComProvider.buildRequest({ query: 'a' }), false);
  assert.equal(affiliateComProvider.buildRequest({ query: 'a', page: 3 }).page, 3);
  assert.equal(affiliateComProvider.buildRequest({ query: 'a', page: 0 }).page, 1);
});

test('per_page üst sınıra kırpılır', () => {
  assert.equal(
    affiliateComProvider.buildRequest({ query: 'a', perPage: 5000 }).per_page,
    AFFILIATE_COM_MAX_PER_PAGE,
  );
  assert.equal(affiliateComProvider.buildRequest({ query: 'a', perPage: 0 }).per_page, 1);
});

test('pool_id çıplak ULID olarak geçer; önek sessizce kırpılmaz', () => {
  // `pool_` önekli hâl 422 döndürüyor. Düzeltmek yanlış yapılandırmayı
  // gizlemek olurdu; çağıran doğru değeri verir.
  assert.equal(
    affiliateComProvider.buildRequest({ query: 'a', poolId: '01HXYZ' }).pool_id,
    '01HXYZ',
  );
  assert.equal('pool_id' in affiliateComProvider.buildRequest({ query: 'a' }), false);
});

// ---------------------------------------------------------------------------
// Yanıt ayrıştırma
// ---------------------------------------------------------------------------

test('ürünler data dizisinden okunur', () => {
  const urun = { id: '1', name: 'Ürün' };

  assert.equal(affiliateComProvider.parseResponse({ data: [urun] }).length, 1);
  // Savunma adayları -- sözleşmedeki ad `data`.
  assert.equal(affiliateComProvider.parseResponse({ products: [urun] }).length, 1);
  assert.equal(affiliateComProvider.parseResponse([urun]).length, 1);
  // Hiçbiri tutmazsa BOŞ döner -- fırlatmaz.
  assert.deepEqual(affiliateComProvider.parseResponse({ tuhaf: 1 }), []);
});

test('meta.total okunur; yoksa null', () => {
  assert.equal(affiliateComProvider.parseTotalCount({ meta: { total: 4821 } }), 4821);
  assert.equal(affiliateComProvider.parseTotalCount({ data: [] }), null);
});

test('okunamayan TEK ürün bütün turu düşürmez', () => {
  const sonuc = affiliateComProvider.parseResponse({
    data: [{ id: '1', name: 'İyi' }, null, { adsiz: true }, { id: '2', name: 'İyi 2' }],
  });

  assert.equal(sonuc.length, 2);
});

// ---------------------------------------------------------------------------
// Önbellek anahtarı
// ---------------------------------------------------------------------------

test('aynı arama aynı anahtarı üretir', () => {
  const a = productSearchCacheKey('affiliate-com', {
    query: ' Oyuncu   Kulaklık ',
    currencies: ['TRY'],
  });
  const b = productSearchCacheKey('affiliate-com', {
    currencies: ['TRY'],
    query: 'oyuncu kulaklık',
  });

  assert.equal(a, b);
});

test('küme alanlarında SIRA anahtarı değiştirmez', () => {
  // `[3,1]` ile `[1,3]` aynı aramadır: sözleşmede `||` ile VEYA'lanıyorlar.
  assert.equal(
    productSearchCacheKey('affiliate-com', { query: 'a', networkIds: [3, 1] }),
    productSearchCacheKey('affiliate-com', { query: 'a', networkIds: [1, 3] }),
  );
  assert.equal(
    productSearchCacheKey('affiliate-com', { query: 'a', currencies: ['EUR', 'TRY'] }),
    productSearchCacheKey('affiliate-com', { query: 'a', currencies: ['TRY', 'EUR'] }),
  );
});

test('para birimi / ağ / satıcı / havuz / sayfalama anahtarı DEĞİŞTİRİR', () => {
  const temel = { query: 'kulaklık' };

  const anahtarlar = new Set([
    productSearchCacheKey('affiliate-com', temel),
    productSearchCacheKey('affiliate-com', { ...temel, currencies: ['TRY'] }),
    productSearchCacheKey('affiliate-com', { ...temel, currencies: ['EUR'] }),
    productSearchCacheKey('affiliate-com', { ...temel, networkIds: [329] }),
    productSearchCacheKey('affiliate-com', { ...temel, merchantIds: [54419] }),
    productSearchCacheKey('affiliate-com', { ...temel, poolId: '01HXYZ' }),
    productSearchCacheKey('affiliate-com', { ...temel, perPage: 5 }),
    productSearchCacheKey('affiliate-com', { ...temel, page: 2 }),
  ]);

  assert.equal(anahtarlar.size, 8);
});

test('sağlayıcı kimliği anahtarı ayırır', () => {
  assert.notEqual(
    productSearchCacheKey('affiliate-com', { query: 'a' }),
    productSearchCacheKey('baska', { query: 'a' }),
  );
});

test('anahtar normalizasyonu Türkçe karakteri ASCII yapmaz', () => {
  assert.notEqual(normalizeSearchQuery('kulaklık'), normalizeSearchQuery('kulaklik'));
});

// ---------------------------------------------------------------------------
// HTTP istemcisi
// ---------------------------------------------------------------------------

function sahteFetch(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

function jsonYanit(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

async function hataKodu(fetchImpl: typeof fetch, apiKey = 'gizli-anahtar'): Promise<string> {
  try {
    await fetchExternalProducts({
      provider: affiliateComProvider,
      apiKey,
      query: { query: 'kulaklık' },
      fetchImpl,
    });
  } catch (error) {
    assert.ok(error instanceof ProductSearchError);
    return error.code;
  }

  return 'hata-yok';
}

test('başarılı yanıt ürünleri ve toplamı döndürür', async () => {
  const sonuc = await fetchExternalProducts({
    provider: affiliateComProvider,
    apiKey: 'gizli-anahtar',
    query: { query: 'kulaklık' },
    fetchImpl: sahteFetch(jsonYanit({ meta: { total: 91 }, data: [ORNEK_URUN] })),
  });

  assert.equal(sonuc.source, 'affiliate-com');
  assert.equal(sonuc.totalCount, 91);
  assert.equal(sonuc.products.length, 1);
  assert.equal(sonuc.products[0]?.name, 'Logitech G Pro X Kulaklık');
});

test('anahtar yoksa AĞA HİÇ ÇIKILMAZ', async () => {
  let cagrildi = false;
  const fetchImpl = (async () => {
    cagrildi = true;
    return jsonYanit({});
  }) as unknown as typeof fetch;

  assert.equal(await hataKodu(fetchImpl, '   '), 'not_configured');
  assert.equal(cagrildi, false);
});

test('boş sorgu kota harcamaz', async () => {
  let cagrildi = false;
  const fetchImpl = (async () => {
    cagrildi = true;
    return jsonYanit({});
  }) as unknown as typeof fetch;

  const sonuc = await fetchExternalProducts({
    provider: affiliateComProvider,
    apiKey: 'gizli',
    query: { query: '   ' },
    fetchImpl,
  });

  assert.deepEqual(sonuc.products, []);
  assert.equal(cagrildi, false);
});

test('401 / 403 / 400 / 429 / 5xx ayrı kodlara düşer', async () => {
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 401 }))), 'unauthorized');
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 403 }))), 'unauthorized');
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 400 }))), 'invalid_request');
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 429 }))), 'rate_limited');
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 503 }))), 'unavailable');
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 500 }))), 'unavailable');
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 418 }))), 'bad_response');
});

test('422: PARAMETRE HATASI ile KOTA TÜKENMESİ ayrılır', async () => {
  /*
   * Resmî doküman aynı kodu iki olay için kullanıyor ve ayırt edici bir
   * alan tanımlamıyor. İkisi operatörden bambaşka şey ister: biri kodda
   * düzeltme, diğeri plan yükseltmesi.
   */
  const parametre = jsonYanit({ message: 'The facets must be an array.' }, { status: 422 });
  assert.equal(await hataKodu(sahteFetch(parametre)), 'invalid_request');

  const kota = jsonYanit(
    { message: 'You exceeded the total usage limit for your subscription plan' },
    { status: 422 },
  );
  assert.equal(await hataKodu(sahteFetch(kota)), 'quota_exhausted');
});

test('429 Retry-After saniyeye çevrilir ve hataya taşınır', async () => {
  try {
    await fetchExternalProducts({
      provider: affiliateComProvider,
      apiKey: 'gizli',
      query: { query: 'a' },
      fetchImpl: sahteFetch(jsonYanit({}, { status: 429, headers: { 'retry-after': '30' } })),
    });
    assert.fail('fırlatmalıydı');
  } catch (error) {
    assert.ok(error instanceof ProductSearchError);
    assert.equal(error.code, 'rate_limited');
    assert.equal(error.retryAfterSeconds, 30);
    assert.equal(error.status, 429);
  }
});

test('Retry-After HTTP tarihi biçimini de anlar', () => {
  assert.equal(retryAfterSaniye('30'), 30);
  assert.equal(retryAfterSaniye(null), undefined);
  assert.equal(retryAfterSaniye('cok-yakinda'), undefined);

  const ileri = new Date(Date.now() + 60_000).toUTCString();
  const saniye = retryAfterSaniye(ileri);
  assert.ok(saniye !== undefined && saniye > 50 && saniye <= 61);
});

test('zaman aşımı ayrı bir kod üretir', async () => {
  const fetchImpl = (async () => {
    const hata = new Error('timed out');
    hata.name = 'TimeoutError';
    throw hata;
  }) as unknown as typeof fetch;

  assert.equal(await hataKodu(fetchImpl), 'timeout');
});

test('ağ hatası zaman aşımından ayrılır', async () => {
  const fetchImpl = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;

  assert.equal(await hataKodu(fetchImpl), 'network');
});

test('JSON olmayan gövde bad_response', async () => {
  const fetchImpl = (async () =>
    new Response('<html>hata</html>', { status: 200 })) as unknown as typeof fetch;
  assert.equal(await hataKodu(fetchImpl), 'bad_response');
});

test('aşırı büyük gövde OKUNMAZ', async () => {
  const fetchImpl = (async () =>
    new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': String(50 * 1024 * 1024) },
    })) as unknown as typeof fetch;

  assert.equal(await hataKodu(fetchImpl), 'bad_response');
});

test('API ANAHTARI HATA METİNLERİNE SIZMAZ', async () => {
  const anahtar = 'cok-gizli-anahtar-123456';

  for (const durum of [401, 403, 400, 422, 429, 503, 418]) {
    try {
      await fetchExternalProducts({
        provider: affiliateComProvider,
        apiKey: anahtar,
        query: { query: 'kulaklık' },
        fetchImpl: sahteFetch(
          jsonYanit({ error: `bearer ${anahtar} reddedildi` }, { status: durum }),
        ),
      });
      assert.fail('fırlatmalıydı');
    } catch (error) {
      assert.ok(error instanceof Error);
      // 422 yolunda gövde OKUNUYOR (kota ayrımı için) -- ama hiçbir yere
      // yazılmamalı: ne mesaja, ne yığın izine.
      assert.equal(error.message.includes(anahtar), false);
      assert.equal(String(error.stack ?? '').includes(anahtar), false);
    }
  }
});

test('anahtar Authorization başlığına Bearer olarak yazılır', async () => {
  let gorulenBaslik: string | null = null;
  let gorulenUrl = '';
  let gorulenYontem = '';

  const fetchImpl = (async (url: string, init: RequestInit) => {
    gorulenUrl = String(url);
    gorulenYontem = String(init.method);
    gorulenBaslik = (init.headers as Record<string, string>).authorization ?? null;
    return jsonYanit({ data: [] });
  }) as unknown as typeof fetch;

  await fetchExternalProducts({
    provider: affiliateComProvider,
    apiKey: 'anahtar',
    query: { query: 'kulaklık' },
    fetchImpl,
  });

  assert.equal(gorulenYontem, 'POST');
  assert.equal(gorulenUrl, AFFILIATE_COM_ENDPOINT);
  assert.equal(gorulenBaslik, 'Bearer anahtar');
});
