import type { Metadata } from 'next';

import { FEED_FIELDS } from '@ohaaaa/shared';

import { apiBaseUrl } from '@/lib/env';

export const metadata: Metadata = {
  title: 'API dokümantasyonu',
  description: 'Ohaaaa taşeron entegrasyon API’si: ürün beslemesi ve sipariş yönetimi.',
  alternates: { canonical: '/tasoron/api' },
};

interface Endpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  scope: string;
  summary: string;
  body?: string;
  response?: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/v1/me',
    scope: '—',
    summary:
      'Anahtarınızın hangi taşerona ait olduğunu ve yetkilerini döner. ' +
      'Entegrasyonu doğrulamak için ilk çağıracağınız uç nokta.',
    response: `{
  "data": {
    "vendor_id": "a0000000-…",
    "vendor_name": "Teknomarkt",
    "scopes": ["products:read", "products:write", "orders:read"],
    "rate_limit_per_minute": 600
  }
}`,
  },
  {
    method: 'POST',
    path: '/api/v1/products',
    scope: 'products:write',
    summary:
      'Toplu ürün beslemesi (en fazla 500 kalem). İdempotenttir: aynı external_id ' +
      'ile tekrar gönderim mevcut kaydı günceller, yenisini oluşturmaz. ' +
      'archive_missing:true gönderirseniz bu istekte yer almayan ürünler arşivlenir.',
    body: `{
  "products": [
    {
      "external_id": "SKU-12345",
      "title": "Apple iPhone 15 128GB Siyah",
      "gtin": "0195949038204",
      "brand": "Apple",
      "category_slug": "telefon",
      "price_cents": 5499900,
      "compare_at_price_cents": 6299900,
      "stock": 42,
      "shipping_fee_cents": 0,
      "free_shipping_threshold_cents": 50000,
      "estimated_delivery_days": 1,
      "image_urls": ["https://cdn.magazaniz.com/iphone15.jpg"],
      "status": "active"
    }
  ],
  "archive_missing": false
}`,
    response: `{
  "data": {
    "received": 1,
    "created": 0,
    "updated": 1,
    "archived": 0,
    "failed": []
  }
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/products',
    scope: 'products:read',
    summary: 'Kataloğunuzu sayfalayarak listeler. limit, offset, status ve q parametrelerini alır.',
  },
  {
    method: 'PATCH',
    path: '/api/v1/products/{external_id}',
    scope: 'products:write',
    summary:
      'Tek ürünü kısmi günceller. Yalnızca fiyat ve stok değiştiğinde tüm beslemeyi ' +
      'göndermek yerine bu uç noktayı kullanın.',
    body: `{ "price_cents": 5299900, "stock": 37 }`,
  },
  {
    method: 'DELETE',
    path: '/api/v1/products/{external_id}',
    scope: 'products:write',
    summary:
      'Ürünü arşivler. Fiziksel silme yapılmaz: geçmiş siparişlerin kalem kayıtları korunur ' +
      've yanlışlıkla silinen ürün geri alınabilir.',
  },
  {
    method: 'GET',
    path: '/api/v1/orders',
    scope: 'orders:read',
    summary:
      'Size düşen alt siparişleri kalemleriyle döner. Müşterinin diğer mağazalardan aldığı ' +
      'ürünler görünmez. since parametresiyle artımlı çekim yapabilirsiniz.',
  },
  {
    method: 'PATCH',
    path: '/api/v1/orders/{id}',
    scope: 'orders:write',
    summary:
      'Sipariş durumunu ve kargo bilgisini günceller. Durum geçişleri tek yönlüdür; ' +
      '“shipped” için takip numarası zorunludur.',
    body: `{
  "status": "shipped",
  "carrier": "Yurtiçi Kargo",
  "tracking_number": "1234567890"
}`,
  },
];

const METHOD_STYLES = {
  GET: 'bg-brand/12 text-brand',
  POST: 'bg-success/12 text-success',
  PATCH: 'bg-warning/12 text-warning',
  DELETE: 'bg-danger/12 text-danger',
} as const;

export default function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Taşeron API’si</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-muted">
        REST, JSON ve tek bir başlık. Kataloğunuzu beslemek ve siparişlerinizi yönetmek için
        ihtiyacınız olan her şey aşağıda.
      </p>

      <section className="card mt-10 p-6">
        <h2 className="text-lg font-bold">Kimlik doğrulama</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Her isteğe <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">x-api-key</code>{' '}
          başlığını ekleyin. Alternatif olarak{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">Authorization: Bearer</code>{' '}
          de kabul edilir.
        </p>

        <CodeBlock>{`curl ${apiBaseUrl}/api/v1/me \\
  -H "x-api-key: ohk_live_9f2c1a7b3d4e5f60_…"`}</CodeBlock>

        <p className="mt-4 rounded-xl border border-warning/25 bg-warning/8 p-3 text-xs leading-relaxed text-warning">
          Anahtarınız yalnızca oluşturulduğu anda gösterilir; veritabanında yalnızca SHA-256
          özeti saklanır. Kaybederseniz kurtarılamaz — panelden yenisini üretin ve eskisini
          iptal edin.
        </p>
      </section>

      <section className="card mt-6 p-6">
        <h2 className="text-lg font-bold">Hız sınırı</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Varsayılan sınır anahtar başına dakikada 600 istektir. Her yanıt{' '}
          <code className="font-mono text-xs">x-ratelimit-limit</code>,{' '}
          <code className="font-mono text-xs">x-ratelimit-remaining</code> ve{' '}
          <code className="font-mono text-xs">x-ratelimit-reset</code> başlıklarını taşır.
          Sınır aşıldığında <strong>429</strong> ve <code className="font-mono text-xs">retry-after</code>{' '}
          döner — bu süreyi bekleyip yeniden deneyin.
        </p>
      </section>

      <section className="card mt-6 p-6">
        <h2 className="text-lg font-bold">Hata biçimi</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Tüm hatalar aynı gövdeyi döner. Entegrasyonunuzu insan tarafından okunan{' '}
          <code className="font-mono text-xs">message</code> alanına değil, sabit{' '}
          <code className="font-mono text-xs">code</code> alanına göre kurun.
        </p>
        <CodeBlock>{`{
  "error": {
    "code": "validation_failed",
    "message": "İstek gövdesi doğrulanamadı.",
    "details": [
      { "path": "products.0.price_cents", "message": "Tutar negatif olamaz" }
    ],
    "request_id": "3f2a…"
  }
}`}</CodeBlock>
        <p className="mt-3 text-xs text-muted">
          Destek talebi açarken <code className="font-mono">request_id</code> değerini
          iletin: ilgili isteğin tüm yaşam döngüsünü loglardan çekebiliyoruz.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-black tracking-tight">Uç noktalar</h2>

        <div className="mt-6 space-y-4">
          {ENDPOINTS.map((endpoint) => (
            <article key={`${endpoint.method}-${endpoint.path}`} className="card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-lg px-2.5 py-1 font-mono text-xs font-bold ${METHOD_STYLES[endpoint.method]}`}
                >
                  {endpoint.method}
                </span>
                <code className="font-mono text-sm font-semibold">{endpoint.path}</code>
                {endpoint.scope !== '—' && (
                  <span className="ml-auto rounded-md bg-surface-2 px-2 py-1 font-mono text-3xs text-muted">
                    {endpoint.scope}
                  </span>
                )}
              </div>

              <p className="mt-3 text-sm leading-relaxed text-muted">{endpoint.summary}</p>

              {endpoint.body && (
                <>
                  <p className="mt-4 text-xs font-semibold text-muted">İstek gövdesi</p>
                  <CodeBlock>{endpoint.body}</CodeBlock>
                </>
              )}

              {endpoint.response && (
                <>
                  <p className="mt-4 text-xs font-semibold text-muted">Yanıt</p>
                  <CodeBlock>{endpoint.response}</CodeBlock>
                </>
              )}
            </article>
          ))}
        </div>
      </section>

      {/*
        BESLEME ALANLARI TABLOSU.

        Önceden yalnızca tek bir örnek gövde vardı; hangi alanın zorunlu
        olduğu, sınırların ne olduğu ve gönderilmezse ne olacağı hiçbir yerde
        yazmıyordu. Entegrasyoncu bunu 400 hatalarından öğreniyordu.

        Tablo `@ohaaaa/shared` içindeki FEED_FIELDS'tan gelir ve orada bir
        test, tablonun şemayla aynı şeyi söylediğini DAVRANIŞSAL olarak
        doğrular: alan çıkarılır, şema reddediyor mu bakılır. Şemaya alan
        eklenip burası güncellenmezse test düşer.
      */}
      <section className="mt-12">
        <h2 className="text-2xl font-black tracking-tight">Besleme alanları</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          <code className="font-mono text-xs">POST /api/v1/products</code> gövdesindeki{' '}
          <code className="font-mono text-xs">products[]</code> dizisinin her kalemi.
          Tanımlı olmayan bir alan gönderilirse istek reddedilir — yazım hatası
          sessizce yutulmaz.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-4 font-semibold text-fg">Alan</th>
                <th scope="col" className="py-2 pr-4 font-semibold text-fg">Tip</th>
                <th scope="col" className="py-2 pr-4 font-semibold text-fg">Zorunlu</th>
                <th scope="col" className="py-2 font-semibold text-fg">Açıklama</th>
              </tr>
            </thead>
            <tbody>
              {FEED_FIELDS.map((field) => (
                <tr key={field.name} className="border-b border-line align-top">
                  <td className="py-3 pr-4">
                    <code className="font-mono text-xs text-fg">{field.name}</code>
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted">{field.type}</td>
                  <td className="py-3 pr-4 text-xs">
                    {field.required ? (
                      <span className="font-semibold text-brand">evet</span>
                    ) : field.fallback !== undefined ? (
                      <span className="text-muted">
                        hayır — varsayılan{' '}
                        <code className="font-mono text-2xs text-fg">{field.fallback}</code>
                      </span>
                    ) : (
                      <span className="text-muted">hayır</span>
                    )}
                  </td>
                  <td className="py-3 text-xs leading-relaxed text-muted">{field.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card mt-10 p-6">
        <h2 className="text-lg font-bold">Kanonik ürün eşleştirme</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Ohaaaa, farklı mağazaların aynı ürününü tek bir karşılaştırma kartında toplar.
          Eşleştirme şu sırayla yapılır:
        </p>
        <ol className="mt-3 space-y-2 text-sm text-muted">
          <li>
            <strong className="text-fg">1. GTIN / barkod</strong> — küresel olarak benzersizdir,
            en güvenilir sinyaldir. <em>Mümkünse daima gönderin.</em>
          </li>
          <li>
            <strong className="text-fg">2. Marka + normalize başlık</strong> — barkodsuz
            beslemeler için. Muhafazakâr davranır: yalnızca tam imza eşleşmesi kabul edilir.
          </li>
          <li>
            <strong className="text-fg">3. Eşleşme yoksa</strong> — yeni bir kanonik ürün açılır.
          </li>
        </ol>
        <p className="mt-4 rounded-xl border border-brand/25 bg-brand/8 p-3 text-xs leading-relaxed text-brand-soft">
          GTIN göndermek doğrudan satışınıza yansır: barkodlu ürünler karşılaştırma kartında
          rakiplerinizle yan yana görünür ve en iyi toplam fiyatı verdiğinizde ilk sırada
          listelenirsiniz.
        </p>
      </section>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-xl border border-line bg-bg p-4 font-mono text-2xs leading-relaxed text-muted">
      <code>{children}</code>
    </pre>
  );
}
