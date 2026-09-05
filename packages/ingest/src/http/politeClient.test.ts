/**
 * Nezaket davranışının testleri.
 *
 * Sahte bir saat ve sahte bir fetch kullanılır: gerçek bekleme yapılmaz ama
 * BEKLEMENİN İSTENDİĞİ doğrulanır. Aksi halde test ya çok yavaş olurdu ya da
 * hiçbir şey kanıtlamazdı.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  CircuitOpenError,
  RobotsDisallowedError,
  createPoliteClient,
} from './politeClient.js';

/** Zamanı elle ilerleten sahte saat; sleep anında "geçmiş" sayılır. */
function fakeClock(start = 1_700_000_000_000) {
  let current = start;
  const sleeps: number[] = [];

  return {
    now: () => current,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

interface RouteResponse {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

/** Adres → yanıt eşlemesi olan sahte fetch. İstek günlüğü tutar. */
function fakeFetch(routes: Record<string, RouteResponse | RouteResponse[]>) {
  const calls: string[] = [];
  const cursors = new Map<string, number>();

  const impl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);

    const route = routes[url];

    if (route === undefined) {
      return new Response('bulunamadı', { status: 404 });
    }

    // Dizi verildiyse çağrı sırasına göre ilerlenir (yeniden deneme testleri).
    const spec = Array.isArray(route)
      ? route[Math.min(cursors.set(url, (cursors.get(url) ?? 0) + 1).get(url)! - 1, route.length - 1)]!
      : route;

    return new Response(spec.body ?? '', {
      status: spec.status ?? 200,
      headers: spec.headers,
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const UA = 'OhaaaaBot/1.0 (+https://ohaaaa.com/bot)';

/**
 * Sahte ad çözücü.
 *
 * Adres kapısı (`guard.ts`) her istekte adı çözüp çıkan IP'leri denetliyor.
 * Testlerdeki `*.example` adları KASITLI olarak çözülmez (ayrılmış TLD), yani
 * gerçek DNS kullanılsaydı bu testler ağa çıkar ve "çözülemedi" gerekçesiyle
 * düşerdi. Sahte çözücü herkese genel bir adres verir; kapının kendisi
 * `guard.test.ts` içinde ayrıca sınanıyor.
 */
const fakeResolve = async () => ['93.184.216.34'];

test('robots.txt yasakladığı adresi çekmez', async () => {
  const { impl, calls } = fakeFetch({
    'https://site.example/robots.txt': {
      body: 'User-agent: *\nDisallow: /gizli',
    },
  });

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    ...{ minDelayMs: 1000, timeoutMs: 5000, maxRetries: 1, circuitBreakerThreshold: 5 },
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await assert.rejects(
    () => client.get('https://site.example/gizli/urun'),
    RobotsDisallowedError,
  );

  // KRİTİK: yasaklı adrese hiç istek gitmemeli, yalnızca robots.txt çekilmeli.
  assert.deepEqual(calls, ['https://site.example/robots.txt']);
});

test('robots.txt alınamazsa güvenli varsayım yasaktır', async () => {
  const { impl } = fakeFetch({
    'https://site.example/robots.txt': { status: 500 },
  });

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 1000,
    timeoutMs: 5000,
    maxRetries: 1,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await assert.rejects(
    () => client.get('https://site.example/urun'),
    RobotsDisallowedError,
  );
});

test('robots.txt yoksa (404) erişim serbesttir', async () => {
  const { impl } = fakeFetch({
    'https://site.example/veri.csv': { body: 'id,title\n1,Ürün' },
  });

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 1000,
    timeoutMs: 5000,
    maxRetries: 1,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  const result = await client.get('https://site.example/veri.csv');
  assert.equal(result.status, 200);
  assert.match(result.body, /Ürün/);
});

test('alan adı başına en az bekleme uygulanır', async () => {
  const { impl } = fakeFetch({
    'https://site.example/robots.txt': { body: '' },
    'https://site.example/a': { body: 'a' },
    'https://site.example/b': { body: 'b' },
  });

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 2000,
    timeoutMs: 5000,
    maxRetries: 1,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await client.get('https://site.example/a');
  await client.get('https://site.example/b');

  // İkinci istek 2 sn beklemek zorunda kalmalı.
  assert.ok(
    clock.sleeps.some((ms) => ms >= 1900 && ms <= 2000),
    `beklenen ~2000 ms bekleme yok: ${JSON.stringify(clock.sleeps)}`,
  );
});

test('robots crawl-delay bizim ayarımızdan büyükse o kazanır', async () => {
  const { impl } = fakeFetch({
    'https://yavas.example/robots.txt': { body: 'User-agent: *\nCrawl-delay: 10' },
    'https://yavas.example/a': { body: 'a' },
    'https://yavas.example/b': { body: 'b' },
  });

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 1000, // bizim ayarımız daha hızlı
    timeoutMs: 5000,
    maxRetries: 1,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await client.get('https://yavas.example/a');
  await client.get('https://yavas.example/b');

  // Site 10 sn istiyor; bizim 1 sn'lik ayarımız onu HIZLANDIRMAMALI.
  assert.ok(
    clock.sleeps.some((ms) => ms >= 9000),
    `site ayarı uygulanmadı: ${JSON.stringify(clock.sleeps)}`,
  );
});

test('429 yanıtında Retry-After değerine uyulur', async () => {
  const { impl } = fakeFetch({
    'https://site.example/robots.txt': { body: '' },
    'https://site.example/a': [
      { status: 429, headers: { 'retry-after': '30' } },
      { status: 200, body: 'tamam' },
    ],
  });

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 1000,
    timeoutMs: 5000,
    maxRetries: 3,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  const result = await client.get('https://site.example/a');
  assert.equal(result.body, 'tamam');

  // 30 saniyelik istek dikkate alınmalı (üstel geri çekilme 2 sn olurdu).
  assert.ok(
    clock.sleeps.some((ms) => ms >= 29_000),
    `Retry-After uygulanmadı: ${JSON.stringify(clock.sleeps)}`,
  );
});

test('kalıcı 4xx yeniden denenmez', async () => {
  const { impl, calls } = fakeFetch({
    'https://site.example/robots.txt': { body: '' },
    'https://site.example/yok': { status: 404 },
  });

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 1000,
    timeoutMs: 5000,
    maxRetries: 3,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await assert.rejects(() => client.get('https://site.example/yok'), /HTTP 404/);

  // robots.txt + tek deneme = 2 istek. Yeniden denemek sunucuyu boşuna yorardı.
  assert.equal(calls.filter((c) => c.endsWith('/yok')).length, 1);
});

test('ardışık hatalarda devre kesici açılır', async () => {
  const { impl } = fakeFetch({
    'https://kirik.example/robots.txt': { body: '' },
    'https://kirik.example/a': { status: 404 },
  });

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 100,
    timeoutMs: 5000,
    maxRetries: 0,
    circuitBreakerThreshold: 3,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(() => client.get('https://kirik.example/a'));
  }

  // Eşik aşıldı: artık istek bile denenmemeli.
  await assert.rejects(
    () => client.get('https://kirik.example/a'),
    CircuitOpenError,
  );
});

test('User-Agent her istekte gönderilir ve iletişim adresi içerir', async () => {
  const seen: string[] = [];

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(
      new Headers(init?.headers).get('user-agent') ?? '(yok)',
    );
    return new Response('', { status: 200 });
  }) as unknown as typeof fetch;

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await client.get('https://site.example/a');

  assert.ok(seen.length >= 2, 'robots.txt ve asıl istek');
  for (const ua of seen) {
    assert.equal(ua, UA);
    assert.match(ua, /https?:\/\//, 'UA iletişim adresi içermeli');
  }
});

// --- Kimlik bilgisi sızıntısı (HTTP katmanı) ------------------------------

/*
 * §18'in istediği test: BAŞARISIZ istek sırasında jeton hata metnine
 * girmemeli. Hattın üst katmanında (pipeline) zaten sınanıyor; burada
 * hatanın ÜRETİLDİĞİ yerde sınanıyor -- üst katman maskelemesi bir gün
 * kaldırılsa bile bu hat tutmalı.
 *
 * Jeton UYDURMADIR. Testin iddiası tek: bu dizgi çıktıda yok.
 */
const HTTP_JETONU = 'tk_ornek_9f4c2b7e51a08d63';

function jetonluIstemci(routes: Record<string, RouteResponse | RouteResponse[]>) {
  const { impl } = fakeFetch(routes);
  const clock = fakeClock();
  return createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });
}

const JETONLU_ADRES = `https://feed.example/export.csv?token=${HTTP_JETONU}`;

for (const durum of [401, 403, 404] as const) {
  test(`HTTP ${durum} hatasında jeton mesaja girmez`, async () => {
    const client = jetonluIstemci({
      'https://feed.example/robots.txt': { body: '' },
      [JETONLU_ADRES]: { status: durum },
    });

    const hata = await client.get(JETONLU_ADRES).then(
      () => null,
      (e: unknown) => e as Error,
    );

    assert.ok(hata, `${durum} hata fırlatmalıydı`);
    assert.ok(!hata!.message.includes(HTTP_JETONU), `jeton sızdı: ${hata!.message}`);
    // Teşhis korunur: durum kodu ve alan adı görünür.
    assert.ok(hata!.message.includes(String(durum)), hata!.message);
    assert.ok(hata!.message.includes('feed.example'), hata!.message);
  });
}

test('robots.txt yasağında jeton mesaja girmez', async () => {
  const client = jetonluIstemci({
    'https://feed.example/robots.txt': { body: 'User-agent: *\nDisallow: /export.csv' },
  });

  const hata = await client.get(JETONLU_ADRES).then(
    () => null,
    (e: unknown) => e as Error,
  );

  assert.ok(hata);
  assert.ok(!hata!.message.includes(HTTP_JETONU), `jeton sızdı: ${hata!.message}`);
});

/*
 * robots.txt ALINAMADIĞINDA mesaj adres + açıklama taşır. Bu iki parça
 * ayrı ayrı birleştiriliyor; tek dizgi olarak birleştirilseydi maskeleme
 * ya tamamını silerdi ya da açıklamayı sorgu dizisine karıştırırdı.
 */
test('robots.txt alınamadığında jeton mesaja girmez, açıklama korunur', async () => {
  const client = jetonluIstemci({
    'https://feed.example/robots.txt': { status: 500 },
  });

  const hata = await client.get(JETONLU_ADRES).then(
    () => null,
    (e: unknown) => e as Error,
  );

  assert.ok(hata);
  assert.ok(!hata!.message.includes(HTTP_JETONU), `jeton sızdı: ${hata!.message}`);
  assert.ok(hata!.message.includes('güvenli varsayım'), hata!.message);
});

test('ağ hatası tükendiğinde jeton son hata metnine girmez', async () => {
  const { impl } = fakeFetch({ 'https://feed.example/robots.txt': { body: '' } });
  const clock = fakeClock();

  // Her denemede ağ seviyesinde çöken getirici: son hata `İstek başarısız`
  // dalına düşer ve o dal adresi metne yazıyordu.
  const patlayan = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/robots.txt')) return impl(url);
    throw new Error('ECONNRESET');
  }) as unknown as typeof fetch;

  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 50,
    maxRetries: 1,
    circuitBreakerThreshold: 5,
    fetchImpl: patlayan,
    now: clock.now,
    sleep: clock.sleep,
  });

  const hata = await client.get(JETONLU_ADRES).then(
    () => null,
    (e: unknown) => e as Error,
  );

  assert.ok(hata);
  assert.ok(!hata!.message.includes(HTTP_JETONU), `jeton sızdı: ${hata!.message}`);
});

// --- Çağıran başlıkları ---------------------------------------------------

test('çağıranın başlıkları isteğe eklenir', async () => {
  let gorulen: Record<string, string> = {};

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    gorulen = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    if (url.endsWith('/robots.txt')) return new Response('', { status: 200 });
    return new Response('id,title\n1,X', { status: 200 });
  }) as unknown as typeof fetch;

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await client.get('https://feed.example/x.csv', {
    headers: { authorization: 'Bearer sahte-deger-testte' },
  });

  assert.equal(gorulen.authorization, 'Bearer sahte-deger-testte');
});

/*
 * KİMLİĞİMİZ EZİLEMEZ.
 *
 * Çağıran user-agent gönderirse istek kimliğimizi gizleyebilirdi; bu,
 * robots.txt uyumunu anlamsız kılar ve bot kimliği bu projede pazarlık
 * konusu değil. Bu yüzden user-agent çağıranın başlıklarından SONRA
 * yazılıyor.
 */
test('çağıran user-agent başlığını EZEMEZ', async () => {
  let gorulen: Record<string, string> = {};

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    gorulen = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    if (url.endsWith('/robots.txt')) return new Response('', { status: 200 });
    return new Response('x', { status: 200 });
  }) as unknown as typeof fetch;

  const clock = fakeClock();
  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await client.get('https://feed.example/x.csv', {
    headers: { 'user-agent': 'Mozilla/5.0 (gizlenmis)' },
  });

  assert.equal(gorulen['user-agent'], UA);
});

/*
 * ZAMAN AŞIMI
 *
 * `timeoutMs` yapılandırması vardı ve iki yerde uygulanıyordu, ama hiçbir test
 * onu sınamıyordu. Yanıt vermeyen bir sağlayıcı, testsiz bir zaman aşımıyla
 * alım turunu süresiz askıda bırakabilirdi: worker kirası dolar, iş yetim
 * kalır, kaynak saatlerce "çalışıyor" görünürdü.
 *
 * Burada GERÇEK setTimeout kullanılır (withTimeout sahte saati kullanmaz),
 * bu yüzden süre kasten çok kısa tutulmuştur.
 */
test('yanıt vermeyen sunucuda istek zaman aşımına uğrar', async () => {
  const clock = fakeClock();

  // robots.txt çözülür (404 = serbest), asıl istek ASILI KALIR.
  const impl = async (url: string) => {
    if (url.endsWith('/robots.txt')) {
      return new Response('', { status: 404 });
    }
    return new Promise<Response>(() => {
      /* bilerek hiç çözülmüyor */
    });
  };

  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 25,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    fetchImpl: impl as unknown as typeof fetch,
    now: clock.now,
    sleep: clock.sleep,
  });

  await assert.rejects(
    () => client.get('https://yavas.example/feed.csv'),
    (error: unknown) =>
      error instanceof Error && /[Zz]aman aşımı/.test(error.message),
    'zaman aşımı hatası fırlatılmalı, istek süresiz beklememeli',
  );
});

/* ===========================================================================
 * YÖNLENDİRME DENETİMİ
 * ---------------------------------------------------------------------------
 * Önceki hâl `redirect: 'follow'` kullanıyordu: adres kapısı yalnızca İLK
 * adrese uygulanırdı ve güvenli görünen bir alan adı 302 ile iç ağa
 * yollayabilirdi. Aşağıdaki testler zincirin TAMAMININ denetlendiğini
 * kanıtlıyor.
 * ======================================================================== */

/** İstenen adrese göre yanıt üreten, yönlendirme kurabilen sahte fetch. */
function yonlendirenFetch(harita: Record<string, Response | (() => Response)>) {
  const cagrilar: string[] = [];
  const impl = (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    cagrilar.push(url);
    const kayit = harita[url];
    if (!kayit) return new Response('bulunamadı', { status: 404 });
    return typeof kayit === 'function' ? kayit() : kayit.clone();
  }) as unknown as typeof fetch;
  return { impl, cagrilar };
}

test('yönlendirme İÇ AĞA giderse reddedilir', async () => {
  const clock = fakeClock();
  const { impl, cagrilar } = yonlendirenFetch({
    'https://feed.example/robots.txt': new Response('', { status: 404 }),
    'https://feed.example/urunler.csv': new Response('', {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    }),
  });

  const client = createPoliteClient({
    // Yalnızca feed.example çözülür; metadata adresi zaten IP olarak yazılı.
    resolveHost: async () => ['93.184.216.34'],
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 1000,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await assert.rejects(
    () => client.get('https://feed.example/urunler.csv'),
    (error: unknown) => (error as Error).name === 'UnsafeUrlError',
  );

  // EN ÖNEMLİ İDDİA: metadata adresine İSTEK HİÇ GİTMEDİ.
  assert.ok(
    !cagrilar.some((u) => u.includes('169.254.169.254')),
    'yasak hedefe istek gönderilmemeliydi',
  );
});

test('yönlendirme zinciri sınırı aşarsa reddedilir', async () => {
  const clock = fakeClock();

  const harita: Record<string, Response | (() => Response)> = {
    'https://feed.example/robots.txt': new Response('', { status: 404 }),
  };
  // 0 → 1 → 2 → ... sonsuza kadar yönlendiren bir zincir.
  for (let i = 0; i < 20; i += 1) {
    harita[`https://feed.example/${i}`] = () =>
      new Response('', { status: 302, headers: { location: `https://feed.example/${i + 1}` } });
  }

  const { impl, cagrilar } = yonlendirenFetch(harita);

  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 1000,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    maxRedirects: 3,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await assert.rejects(
    () => client.get('https://feed.example/0'),
    (error: unknown) => (error as Error).name === 'TooManyRedirectsError',
  );

  // Sınır gerçekten uygulandı: 4 adım (0..3) + robots.txt.
  const feedIstekleri = cagrilar.filter((u) => !u.endsWith('/robots.txt'));
  assert.equal(feedIstekleri.length, 4, 'maxRedirects=3 → en fazla 4 istek');
});

test('GENEL bir adrese yönlendirme İZLENİR — kapı meşru akışı kesmiyor', async () => {
  const clock = fakeClock();
  const { impl } = yonlendirenFetch({
    'https://feed.example/robots.txt': new Response('', { status: 404 }),
    'https://feed.example/urunler.csv': new Response('', {
      status: 301,
      headers: { location: 'https://feed.example/v2/urunler.csv' },
    }),
    'https://feed.example/v2/urunler.csv': new Response('id,title\n1,Ürün', { status: 200 }),
  });

  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 1000,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  const sonuc = await client.get('https://feed.example/urunler.csv');

  assert.equal(sonuc.body, 'id,title\n1,Ürün');
  // Dönen adres SON adres olmalı; çağıran göreli bağlantıları buna göre çözer.
  assert.equal(sonuc.url, 'https://feed.example/v2/urunler.csv');
});

/* ===========================================================================
 * GÖVDE BOYUTU
 * ======================================================================== */

test('beyan edilen content-length sınırı aşarsa gövde HİÇ okunmaz', async () => {
  const clock = fakeClock();
  let cekilenParca = 0;

  const impl = (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });

    /*
     * SAYAÇ, BAYRAK DEĞİL. İlk yazılışta "akış hiç okundu mu" diye bir
     * bayrak vardı ve test düştü -- ama koddan değil, ölçüm hatasından:
     * `ReadableStream` kendi tamponunu doldurmak için `pull`'u kurulum
     * anında BİR KEZ kendiliğinden çağırır. Yani bayrak bizim okumamızı
     * değil, akışın kendi davranışını ölçüyordu.
     *
     * Sayaç bu ikisini ayırır: erken çıkışta yalnızca o kendiliğinden
     * gelen tek çağrı olur; erken çıkış olmasaydı 10 MiB için binlerce.
     */
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        cekilenParca += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'content-length': String(10 * 1024 * 1024) },
    });
  }) as unknown as typeof fetch;

  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 1000,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    maxBodyBytes: 1024,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await assert.rejects(
    () => client.get('https://feed.example/dev.csv'),
    (error: unknown) => (error as Error).name === 'ResponseTooLargeError',
  );

  assert.ok(
    cekilenParca <= 1,
    `content-length yeterliyken gövde indirilmemeli (${cekilenParca} parça çekildi)`,
  );
});

test('content-length YOKKEN (chunked) gerçek bayt sayısı sınırlanır', async () => {
  const clock = fakeClock();
  let uretilenParca = 0;

  const impl = (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });

    /*
     * content-length YOK. Yalnızca başlığa bakan bir denetim burada
     * hiçbir şey yapmaz; sınır gerçek baytlar üzerinden uygulanmalı.
     * Akış sonsuz: koruma çalışmazsa test asılır.
     */
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        uretilenParca += 1;
        controller.enqueue(new Uint8Array(256));
      },
    });

    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;

  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 2000,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    maxBodyBytes: 1024,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await assert.rejects(
    () => client.get('https://feed.example/sonsuz.csv'),
    (error: unknown) => (error as Error).name === 'ResponseTooLargeError',
  );

  // Sınırın hemen ötesinde durdu; sonsuza kadar indirmedi.
  assert.ok(uretilenParca <= 8, `akış erken kesilmeliydi (${uretilenParca} parça)`);
});

test('sınırın altındaki normal feed AYNEN döner — davranış korunuyor', async () => {
  const clock = fakeClock();
  const govde = 'id,title,price\n1,Ürün,100\n2,Başka,200';

  const { impl } = yonlendirenFetch({
    'https://feed.example/robots.txt': new Response('', { status: 404 }),
    'https://feed.example/urunler.csv': new Response(govde, {
      status: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8' },
    }),
  });

  const client = createPoliteClient({
    resolveHost: fakeResolve,
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 1000,
    maxRetries: 0,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  const sonuc = await client.get('https://feed.example/urunler.csv');

  assert.equal(sonuc.body, govde, 'gövde bozulmadan dönmeli (UTF-8 dahil)');
  assert.equal(sonuc.status, 200);
  assert.equal(sonuc.contentType, 'text/csv; charset=utf-8');
});

test('özel adrese ÇÖZÜLEN feed adresi istemci seviyesinde de reddedilir', async () => {
  const clock = fakeClock();
  const { impl, cagrilar } = yonlendirenFetch({});

  const client = createPoliteClient({
    resolveHost: async () => ['10.0.0.7'],
    userAgent: UA,
    minDelayMs: 0,
    timeoutMs: 1000,
    maxRetries: 3,
    circuitBreakerThreshold: 5,
    fetchImpl: impl,
    now: clock.now,
    sleep: clock.sleep,
  });

  await assert.rejects(
    () => client.get('https://ic-ag.example/feed.csv'),
    (error: unknown) => (error as Error).name === 'UnsafeUrlError',
  );

  /*
   * Güvenlik hatası KALICI: robots.txt dahil hiçbir istek gitmemeli ve
   * `maxRetries: 3` olmasına rağmen yeniden denenmemeli.
   */
  assert.equal(cagrilar.length, 0, 'yasak hedefe hiç istek gitmemeli');
});
