import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  affiliateComProvider,
  cozulmemisYerTutucuVar,
  normalizeAffiliateComProduct,
  AFFILIATE_COM_ENDPOINT,
  AFFILIATE_COM_MAX_LIMIT,
} from './affiliateCom.js';
import { normalizeSearchQuery, productSearchCacheKey } from './cacheKey.js';
import { fetchExternalProducts, retryAfterSaniye } from './client.js';
import { ProductSearchError } from './types.js';

// ---------------------------------------------------------------------------
// Normalizasyon
// ---------------------------------------------------------------------------

/** Doğrulanmamış sözleşmenin "en olası" hâli -- yalnızca ÖRNEK, kural değil. */
const ORNEK_URUN = {
  id: 'p-4821',
  barcode: '5 099206 039292',
  name: '  Logitech G Pro X Kulaklık  ',
  description: 'Oyuncu kulaklığı',
  commission_url: 'https://track.affiliate.com/click?pid=9&url=https%3A%2F%2Fmagaza.com%2Fp%2F1',
  direct_url: 'https://magaza.com/p/1',
  image_url: 'https://cdn.magaza.com/1.jpg',
  currency: 'try',
  regular_price: '1.899,00',
  final_price: 1299.9,
  availability: 'in stock',
  stock_quantity: '12',
  sku: 'LG-PROX-1',
  brand: 'Logitech',
  model: 'G Pro X',
  category: 'Kulaklık',
  country: 'tr',
  condition: 'New',
  network: 'affiliate-com',
  merchant: 'Örnek Mağaza',
  updated_at: '2026-09-01T10:00:00Z',
  added_at: '2026-08-01T10:00:00.000Z',
};

test('ham ürün Ohaaaa modeline normalize edilir', () => {
  const urun = normalizeAffiliateComProduct(ORNEK_URUN);
  assert.ok(urun);

  assert.equal(urun.providerId, 'p-4821');
  assert.equal(urun.name, 'Logitech G Pro X Kulaklık');
  // Barkod yalnızca rakamlara indirgenir: 14 haneye DOLDURULMAZ, kontrol
  // basamağı burada doğrulanmaz (o kural ingest ve veritabanında).
  assert.equal(urun.barcode, '5099206039292');
  assert.equal(urun.sku, 'LG-PROX-1');
  assert.equal(urun.currency, 'TRY');
  assert.equal(urun.country, 'TR');
  assert.equal(urun.availability, 'in_stock');
  assert.equal(urun.condition, 'new');
  assert.equal(urun.stockQuantity, 12);
  assert.equal(urun.source, 'affiliate-com');
  assert.equal(urun.unresolvedLinkPlaceholders, false);
});

test('fiyatlar KURUŞA çevrilir -- hem metin hem sayı biçiminden', () => {
  const urun = normalizeAffiliateComProduct(ORNEK_URUN);
  assert.ok(urun);

  // "1.899,00" -> Türkçe biçim, binlik nokta / ondalık virgül.
  assert.equal(urun.regularPriceCents, 189_900);
  // 1299.9 -> kayan nokta; 129_989.99... değil 129_990 olmalı.
  assert.equal(urun.finalPriceCents, 129_990);
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
  assert.equal(urun.country, null);
  assert.equal(urun.merchant, null);
  // "Bilmiyoruz" ile "stokta yok" ayrı: tanınmayan/eksik değer `unknown`.
  assert.equal(urun.availability, 'unknown');
  assert.equal(urun.condition, 'unknown');
});

test('tanınmayan stok etiketi out_of_stock SAYILMAZ', () => {
  const urun = normalizeAffiliateComProduct({ id: '1', name: 'Ürün', availability: 'kismen' });
  assert.equal(urun?.availability, 'unknown');
});

test('boolean stok alanı da okunur', () => {
  assert.equal(
    normalizeAffiliateComProduct({ id: '1', name: 'Ü', in_stock: true })?.availability,
    'in_stock',
  );
  assert.equal(
    normalizeAffiliateComProduct({ id: '1', name: 'Ü', in_stock: false })?.availability,
    'out_of_stock',
  );
});

test('iç içe alanlar (urls.outclick, price.final) okunur', () => {
  const urun = normalizeAffiliateComProduct({
    id: '9',
    name: 'İç içe',
    urls: { outclick: 'https://track.affiliate.com/c/9', direct: 'https://magaza.com/9' },
    price: { final: 49.5, regular: 59.5, currency: 'EUR' },
  });

  assert.ok(urun);
  assert.equal(urun.commissionUrl, 'https://track.affiliate.com/c/9');
  assert.equal(urun.directUrl, 'https://magaza.com/9');
  assert.equal(urun.finalPriceCents, 4950);
  assert.equal(urun.currency, 'EUR');
});

test('biçimi bozuk para birimi taşınmaz', () => {
  const urun = normalizeAffiliateComProduct({ id: '1', name: 'Ü', currency: 'Türk Lirası' });
  assert.equal(urun?.currency, null);
});

// ---------------------------------------------------------------------------
// Yer tutucular -- VARSAYIM YAPILMAZ
// ---------------------------------------------------------------------------

test('çözülmemiş yer tutucu kalıbı tanınır', () => {
  assert.equal(cozulmemisYerTutucuVar('https://track.affiliate.com/c?sub=@@@'), true);
  assert.equal(cozulmemisYerTutucuVar('https://track.affiliate.com/c?sub=###'), true);
  assert.equal(cozulmemisYerTutucuVar('https://track.affiliate.com/c?sub={subid}'), true);
  // Tek `#` gerçek bir adres parçasıdır (fragment); yanlış alarm vermez.
  assert.equal(cozulmemisYerTutucuVar('https://magaza.com/p/1#aciklama'), false);
});

test('yer tutuculu komisyon adresi DÜŞÜRÜLÜR ve işaretlenir', () => {
  /*
   * NEDEN DOLDURMAYA ÇALIŞMIYORUZ: yer tutucunun gerçek API kullanımında
   * nasıl doldurulduğu doğrulanmadı. Tahminle doldurulan bir link geçerli
   * GÖRÜNÜR, yönlendirme çalışır ve tıklama atıfsız kalır -- sessiz gelir
   * kaybı. Boş link ise görünür bir eksiktir.
   */
  const urun = normalizeAffiliateComProduct({
    id: '1',
    name: 'Ürün',
    commission_url: 'https://track.affiliate.com/click?subid=@@@&url=###',
    direct_url: 'https://magaza.com/p/1',
  });

  assert.ok(urun);
  assert.equal(urun.commissionUrl, null);
  assert.equal(urun.unresolvedLinkPlaceholders, true);
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
  // Yer tutucu yoktu; "bozuk" değil "yok" olarak raporlanır.
  assert.equal(urun?.unresolvedLinkPlaceholders, false);
});

// ---------------------------------------------------------------------------
// İstek gövdesi ve yanıt ayrıştırma
// ---------------------------------------------------------------------------

test('istek gövdesi YALNIZCA doğrulanmış alanları taşır', () => {
  const govde = affiliateComProvider.buildRequest({
    query: '  oyuncu kulaklık ',
    market: 'TR',
    country: 'TR',
    currency: 'TRY',
    network: 'x',
    merchant: 'y',
    limit: 10,
  });

  assert.deepEqual(govde, { query: 'oyuncu kulaklık', limit: 10 });
  // Doğrulanmamış filtreler tel üzerine YAZILMAZ (bkz. DOGRULANMAMIS_FILTRELER).
  for (const alan of ['market', 'country', 'currency', 'network', 'merchant']) {
    assert.equal(alan in govde, false, `${alan} gövdeye yazılmamalı`);
  }
});

test('limit üst sınıra kırpılır', () => {
  assert.equal(affiliateComProvider.buildRequest({ query: 'a', limit: 5000 }).limit, AFFILIATE_COM_MAX_LIMIT);
  assert.equal(affiliateComProvider.buildRequest({ query: 'a', limit: 0 }).limit, 1);
  assert.equal(affiliateComProvider.buildRequest({ query: 'a' }).limit, AFFILIATE_COM_MAX_LIMIT);
});

test('yanıt sarmalayıcısının adı bilinmiyor; adaylar denenir', () => {
  const urun = { id: '1', name: 'Ürün' };

  assert.equal(affiliateComProvider.parseResponse({ products: [urun] }).length, 1);
  assert.equal(affiliateComProvider.parseResponse({ data: [urun] }).length, 1);
  assert.equal(affiliateComProvider.parseResponse({ results: [urun] }).length, 1);
  assert.equal(affiliateComProvider.parseResponse([urun]).length, 1);
  // Hiçbiri tutmazsa BOŞ döner -- fırlatmaz. Bir tur sonuçsuz kalır,
  // Ohaaaa katalog araması etkilenmez.
  assert.deepEqual(affiliateComProvider.parseResponse({ tuhaf: 1 }), []);
});

test('okunamayan TEK ürün bütün turu düşürmez', () => {
  const sonuc = affiliateComProvider.parseResponse({
    products: [{ id: '1', name: 'İyi' }, null, { adsiz: true }, { id: '2', name: 'İyi 2' }],
  });

  assert.equal(sonuc.length, 2);
});

// ---------------------------------------------------------------------------
// Önbellek anahtarı
// ---------------------------------------------------------------------------

test('aynı arama aynı anahtarı üretir', () => {
  const a = productSearchCacheKey('affiliate-com', { query: ' Oyuncu   Kulaklık ', market: 'TR' });
  const b = productSearchCacheKey('affiliate-com', { market: 'TR', query: 'oyuncu kulaklık' });

  assert.equal(a, b);
});

test('pazar/para birimi/satıcı anahtarı DEĞİŞTİRİR', () => {
  const temel = { query: 'kulaklık' };

  const anahtarlar = new Set([
    productSearchCacheKey('affiliate-com', temel),
    productSearchCacheKey('affiliate-com', { ...temel, market: 'TR' }),
    productSearchCacheKey('affiliate-com', { ...temel, market: 'EU' }),
    productSearchCacheKey('affiliate-com', { ...temel, currency: 'EUR' }),
    productSearchCacheKey('affiliate-com', { ...temel, merchant: 'x' }),
    productSearchCacheKey('affiliate-com', { ...temel, network: 'x' }),
    productSearchCacheKey('affiliate-com', { ...temel, limit: 5 }),
  ]);

  assert.equal(anahtarlar.size, 7);
});

test('sağlayıcı kimliği anahtarı ayırır', () => {
  assert.notEqual(
    productSearchCacheKey('affiliate-com', { query: 'a' }),
    productSearchCacheKey('baska', { query: 'a' }),
  );
});

test('anahtar normalizasyonu Türkçe karakteri ASCII yapmaz', () => {
  // "kulaklık" ile "kulaklik" AYNI arama değildir.
  assert.notEqual(normalizeSearchQuery('kulaklık'), normalizeSearchQuery('kulaklik'));
});

// ---------------------------------------------------------------------------
// HTTP istemcisi -- hata yolları
// ---------------------------------------------------------------------------

function sahteFetch(response: Response | (() => never)): typeof fetch {
  return (async () => {
    if (typeof response === 'function') response();
    return response;
  }) as unknown as typeof fetch;
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

test('başarılı yanıt normalize edilmiş ürünleri döndürür', async () => {
  const sonuc = await fetchExternalProducts({
    provider: affiliateComProvider,
    apiKey: 'gizli-anahtar',
    query: { query: 'kulaklık' },
    fetchImpl: sahteFetch(jsonYanit({ products: [ORNEK_URUN] })),
  });

  assert.equal(sonuc.source, 'affiliate-com');
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

test('429 / 422 / 503 / 401 ayrı kodlara düşer', async () => {
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 429 }))), 'rate_limited');
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 422 }))), 'invalid_request');
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 503 }))), 'unavailable');
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 401 }))), 'unauthorized');
  assert.equal(await hataKodu(sahteFetch(jsonYanit({}, { status: 418 }))), 'bad_response');
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
  const fetchImpl = (async () => new Response('<html>hata</html>', { status: 200 })) as unknown as typeof fetch;
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

  for (const durum of [401, 422, 429, 503, 418]) {
    try {
      await fetchExternalProducts({
        provider: affiliateComProvider,
        apiKey: anahtar,
        query: { query: 'kulaklık' },
        fetchImpl: sahteFetch(jsonYanit({ error: `bearer ${anahtar} reddedildi` }, { status: durum })),
      });
      assert.fail('fırlatmalıydı');
    } catch (error) {
      assert.ok(error instanceof Error);
      // Ne mesaj ne yığın izi anahtarı taşımalı; sağlayıcının GÖVDESİ de
      // hataya girmemeli (gövde isteğimizi yankılayabilir).
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
    return jsonYanit({ products: [] });
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
