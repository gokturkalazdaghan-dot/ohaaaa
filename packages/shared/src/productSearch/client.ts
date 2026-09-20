/**
 * Talep-anı arama sağlayıcısına yapılan HTTP isteği.
 *
 * ======================================================================
 * NEDEN BU DOSYA `apps/web` İÇİNDE DEĞİL
 * ======================================================================
 * İki sebep, ikisi de ölçülebilir:
 *
 *   1. TEST EDİLEBİLİRLİK. `fetch` dışarıdan verilebiliyor; 429, 422, 503
 *      ve zaman aşımı yolları GERÇEK bir anahtar olmadan, gerçek bir
 *      istek atmadan birim testiyle doğrulanıyor. Next.js route'unun
 *      içine gömülü bir `fetch` çağrısı bu yolları test edilemez kılardı
 *      -- yani en çok hata barındıran dallar hiç denenmemiş olurdu.
 *
 *   2. KİMLİK BİLGİSİ TEK YERDEN GEÇSİN. Anahtar bu fonksiyona parametre
 *      olarak gelir, modül düzeyinde saklanmaz, hiçbir hata metnine
 *      yazılmaz ve hiçbir günlük satırına girmez. Tek giriş noktası =
 *      denetlenebilir tek nokta.
 *
 * Anahtarın KENDİSİ hâlâ yalnızca sunucudadır: onu ortamdan okuyan sarmal
 * `apps/web/src/lib/dis-arama/` içindedir ve `server-only` ile
 * işaretlidir. Bu dosya `@ohaaaa/shared` altındadır ama paketin ana
 * `index.ts`'inden DIŞA AÇILMAZ; yalnızca `@ohaaaa/shared/product-search`
 * alt yolundan erişilir, böylece istemci paketine kazara girmez.
 *
 * ======================================================================
 * HATA YOLLARI SESSİZ DEĞİL, AMA KONUŞKAN DA DEĞİL
 * ======================================================================
 * Her başarısızlık tipli bir `ProductSearchError`'dır ve durum kodunu
 * ALAN olarak taşır. Çağıran karar verirken metin ayrıştırmaz.
 *
 * Yanıt GÖVDESİ hiçbir hataya girmez. Sağlayıcının hata metni isteğimizi
 * yankılayabilir; isteğimiz de kullanıcının arama metnini taşır. İkisini
 * de günlüğe düşürmemek, hem KVKK hem sır hijyeni açısından gerekli.
 */

import { productSearchCacheKey } from './cacheKey.js';
import {
  ProductSearchError,
  type ProductSearchProvider,
  type ProductSearchQuery,
  type ProductSearchResult,
} from './types.js';

/**
 * VARSAYILAN ZAMAN AŞIMI.
 *
 * Bu çağrı bir ARAMA SAYFASININ önünde durur. Kullanıcı, dış sağlayıcının
 * yavaşlığını Ohaaaa'nın yavaşlığı olarak yaşar. Üst sınır bu yüzden
 * cömert değil: 4 saniyede cevap vermeyen bir kaynak, o tur için yok
 * sayılır ve katalog sonuçları tek başına gösterilir.
 */
export const VARSAYILAN_ZAMAN_ASIMI_MS = 4000;

/**
 * Yanıt gövdesi için kaba üst sınır (bayt).
 *
 * `Content-Length` bunun üstündeyse gövde HİÇ OKUNMAZ. Sınırsız bir
 * gövdeyi belleğe almak, sunucusuz bir işlevde bellek tüketerek
 * çökmenin en kolay yoludur ve bunu tetiklemek için sağlayıcının kötü
 * niyetli olması gerekmez -- yanlış bir sayfalama parametresi yeter.
 */
export const EN_BUYUK_GOVDE_BAYT = 2 * 1024 * 1024;

export interface ProductSearchRequest {
  provider: ProductSearchProvider;
  /** Sunucu tarafı gizli anahtar. Boşsa hiç istek yapılmaz. */
  apiKey: string;
  query: ProductSearchQuery;
  /** Sağlayıcının varsayılan ucunu ezmek için (staging). */
  endpoint?: string;
  timeoutMs?: number;
  /** Test için `fetch` yerine geçen uygulama. */
  fetchImpl?: typeof fetch;
}

/**
 * `Retry-After` başlığını saniyeye çevirir.
 *
 * İki biçim de RFC'de geçerli: saniye sayısı ya da HTTP tarihi. Yalnızca
 * birini desteklemek, sağlayıcı diğerini gönderdiğinde "sınır yok" gibi
 * davranmak demekti.
 */
export function retryAfterSaniye(header: string | null): number | undefined {
  if (!header) return undefined;

  const kirpilmis = header.trim();
  if (kirpilmis === '') return undefined;

  const saniye = Number(kirpilmis);
  if (Number.isFinite(saniye) && saniye >= 0) return Math.trunc(saniye);

  const tarih = Date.parse(kirpilmis);
  if (Number.isNaN(tarih)) return undefined;

  const fark = Math.ceil((tarih - Date.now()) / 1000);
  return fark > 0 ? fark : 0;
}

/**
 * 422'NİN İKİ ANLAMINI AYIRAN SEZGİ.
 *
 * Resmî doküman aynı durum koduna iki ayrı olay yüklüyor:
 *   • parametre doğrulama hatası (`sort_by`, `facets`, `pool_id` …)
 *   • ABONELİK KOTASININ TÜKENMESİ ("You exceeded the total usage limit
 *     for your subscription plan")
 *
 * ...ama ikisini ayıracak bir ALAN tanımlamıyor. Tek ayırt edici işaret
 * yanıt metnidir, dolayısıyla bu bir SEZGİDİR ve gerçek anahtarla
 * doğrulanması gerekir.
 *
 * Ayrım yine de yapılmalı, çünkü iki durum operatörden BAMBAŞKA bir şey
 * ister: biri kodda düzeltme, diğeri plan yükseltmesi. Tek kodda
 * birleştirmek, olmayan bir hatayı aratmak olurdu.
 *
 * GÖVDE SADECE BURADA, BELLEKTE OKUNUR. Hiçbir yere yazılmaz, hiçbir
 * hata metnine girmez, günlüğe düşmez -- yalnızca bu kalıpla eşleştirilir.
 */
const KOTA_KALIBI = /usage limit|subscription|quota|plan limit|exceeded the total/i;

/** HTTP durum kodunu tipli hataya çevirir. */
function durumdanHata(
  status: number,
  retryAfter: number | undefined,
  govdeIpucu = '',
): ProductSearchError {
  if (status === 401 || status === 403) {
    return new ProductSearchError(
      'Dis urun arama saglayicisi kimligi reddetti.',
      'unauthorized',
      status,
    );
  }

  if (status === 422 && KOTA_KALIBI.test(govdeIpucu)) {
    return new ProductSearchError(
      'Dis urun arama saglayicisinin abonelik kotasi tukendi.',
      'quota_exhausted',
      status,
    );
  }

  if (status === 422 || status === 400) {
    /*
     * "Istegimiz sozlesmeye uymadi."
     *
     * Bu, saglayicinin degil BIZIM hatamizdir ve tekrar denemek
     * duzeltmez. Cagiran tarafin bunu 5xx'ten ayirabilmesi gerekir:
     * 5xx beklenir, bu duzeltilir.
     */
    return new ProductSearchError(
      'Dis urun arama istegi saglayicinin sozlesmesine uymadi.',
      'invalid_request',
      status,
    );
  }

  if (status === 429) {
    return new ProductSearchError(
      'Dis urun arama saglayicisinin hiz siniri asildi.',
      'rate_limited',
      status,
      retryAfter,
    );
  }

  if (status >= 500) {
    return new ProductSearchError(
      'Dis urun arama saglayicisi gecici olarak yanit vermiyor.',
      'unavailable',
      status,
      retryAfter,
    );
  }

  return new ProductSearchError(
    'Dis urun arama saglayicisi beklenmeyen bir durum kodu dondurdu.',
    'bad_response',
    status,
  );
}

/**
 * Sağlayıcıdan ürün arar.
 *
 * BAŞARISIZLIKTA FIRLATIR. Yutmak burada YANLIŞ olurdu: bu katman,
 * "sağlayıcı ne dedi" sorusunun tek doğru cevabını bilen yerdir. Geri
 * düşüş kararı (katalog sonuçlarıyla devam etmek) çağıranındır ve
 * `apps/web/src/lib/dis-arama/` içinde verilir.
 */
export async function fetchExternalProducts(
  request: ProductSearchRequest,
): Promise<ProductSearchResult> {
  const { provider, apiKey, query } = request;
  const fetchImpl = request.fetchImpl ?? globalThis.fetch;

  if (apiKey.trim() === '') {
    /*
     * ANAHTAR YOKSA AĞA HİÇ ÇIKILMAZ.
     *
     * Bos bir `Bearer` ile denemek 401 uretirdi ve o 401, gunluklerde
     * "anahtar yanlis" gibi gorunurdu -- oysa anahtar hic yok. Iki durumu
     * ayirmak, ilk kurulumda saatler kazandirir.
     */
    throw new ProductSearchError(
      'Dis urun arama saglayicisi yapilandirilmadi (anahtar yok).',
      'not_configured',
    );
  }

  if (query.query.trim() === '') {
    // Bos sorgu kotayi harcar ve anlamli sonuc getirmez.
    return { products: [], source: provider.id, totalCount: 0 };
  }

  const endpoint = request.endpoint?.trim() || provider.endpoint;
  const timeoutMs = request.timeoutMs ?? VARSAYILAN_ZAMAN_ASIMI_MS;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(provider.buildRequest(query)),
      signal: AbortSignal.timeout(timeoutMs),
      // Sunucu tarafi cagri; tarayici cerezi ya da kimligi tasimaz.
      redirect: 'follow',
    });
  } catch (error) {
    /*
     * `AbortSignal.timeout` TimeoutError firlatir; kullanicinin sekmeyi
     * kapatmasi AbortError. Ikisi ayri raporlanir cunku ayri seyi olcerler:
     * biri saglayicinin yavasligi, digeri bizim vazgecmemiz.
     */
    const ad = error instanceof Error ? error.name : '';

    if (ad === 'TimeoutError' || ad === 'AbortError') {
      throw new ProductSearchError('Dis urun arama zaman asimina ugradi.', 'timeout');
    }

    throw new ProductSearchError('Dis urun arama saglayicisina ulasilamadi.', 'network');
  }

  if (!response.ok) {
    /*
     * 422 ICIN -- VE YALNIZCA ONUN ICIN -- GOVDEYE BAKILIR.
     *
     * Sebep `KOTA_KALIBI` basliginda yazili: ayni kod iki ayri olayi
     * anlatiyor ve ayirt edici tek isaret metin. Okunan sey bellekte
     * kalir, hicbir yere yazilmaz. Okuma basarisiz olursa ayrim yapilmaz
     * ve varsayilan `invalid_request` gecerli olur.
     *
     * Kirpma kasitli: kota mesaji kisa; uzun bir govdeyi belleğe almak
     * burada hicbir sey kazandirmaz.
     */
    let govdeIpucu = '';

    if (response.status === 422) {
      try {
        govdeIpucu = (await response.text()).slice(0, 512);
      } catch {
        govdeIpucu = '';
      }
    }

    throw durumdanHata(
      response.status,
      retryAfterSaniye(response.headers.get('retry-after')),
      govdeIpucu,
    );
  }

  const uzunluk = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(uzunluk) && uzunluk > EN_BUYUK_GOVDE_BAYT) {
    throw new ProductSearchError(
      'Dis urun arama yaniti beklenenden buyuk; okunmadi.',
      'bad_response',
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProductSearchError(
      'Dis urun arama yaniti JSON olarak okunamadi.',
      'bad_response',
      response.status,
    );
  }

  return {
    products: provider.parseResponse(payload),
    source: provider.id,
    totalCount: provider.parseTotalCount(payload),
  };
}

/** Bu istek için önbellek anahtarı (`cacheKey.ts` kuralı). */
export function requestCacheKey(request: Pick<ProductSearchRequest, 'provider' | 'query'>): string {
  return productSearchCacheKey(request.provider.id, request.query);
}
