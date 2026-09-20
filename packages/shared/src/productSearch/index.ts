/**
 * Talep-anı ürün arama katmanı.
 *
 * `@ohaaaa/shared` ANA `index.ts`'İNDEN DIŞA AÇILMAZ ve bu kasıtlıdır.
 * Bu modül bir API anahtarı taşıyan HTTP istemcisi içeriyor; ana pakete
 * eklenmesi, `import { ... } from '@ohaaaa/shared'` yazan her istemci
 * bileşeninin onu paketine çekmesi riski demekti. Erişim yalnızca
 * `@ohaaaa/shared/product-search` alt yolundan -- tıpkı `./providers`
 * gibi.
 */

export type {
  ExternalProduct,
  ProductAvailability,
  ProductCondition,
  ProductSearchErrorCode,
  ProductSearchProvider,
  ProductSearchQuery,
  ProductSearchResult,
  TrackingUrlKind,
} from './types.js';
export { ProductSearchError } from './types.js';

export {
  affiliateComProvider,
  cozulmemisYerTutucuVar,
  normalizeAffiliateComProduct,
  AFFILIATE_COM_DEFAULT_PER_PAGE,
  AFFILIATE_COM_ENDPOINT,
  AFFILIATE_COM_ID,
  AFFILIATE_COM_MAX_PER_PAGE,
} from './affiliateCom.js';

export { normalizeSearchQuery, productSearchCacheKey } from './cacheKey.js';

export {
  fetchExternalProducts,
  requestCacheKey,
  retryAfterSaniye,
  EN_BUYUK_GOVDE_BAYT,
  VARSAYILAN_ZAMAN_ASIMI_MS,
  type ProductSearchRequest,
} from './client.js';
