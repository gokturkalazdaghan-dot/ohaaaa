export type {
  AffiliateProvider,
  ConversionSource,
  ConversionStatus,
  DeeplinkContext,
  NormalizedConversion,
  PostbackContext,
  ProviderErrorCode,
  PulledConversion,
} from './types.js';
export { ProviderError } from './types.js';

export { directProvider, verifyHmacSha256 } from './direct.js';
export {
  awinProvider,
  awinClickrefToSubid,
  awinTransactionToConversion,
  awinTransactionsUrl,
  awinMagazaEslemesi,
  awinmidCikar,
  AWIN_API_BASE,
  AWIN_MAX_RANGE_DAYS,
  AWIN_PUBLISHER_ID,
  AWIN_RATE_LIMIT_PER_MINUTE,
  AWIN_DEEPLINK_TEMPLATE_SHAPE,
} from './awin.js';
export { getProvider, isKnownNetwork, knownNetworks } from './registry.js';

/*
 * ÖDÜNÇ TEKLİF ARAMA — ayrı sözleşme, aynı klasör.
 *
 * Yukarıdaki her şey PARANIN yolu (postback, dönüşüm, deeplink).
 * Aşağıdaki her şey ÜRÜNÜN yolu (istek anında partner araması).
 *
 * `registry.ts` bu tipleri TANIMAZ ve tanımamalı: bir partner ikisinden
 * yalnızca birini destekleyebilir (Awin'in ürün arama API'si yok, Amazon
 * ve eBay'in dönüşüm çekmesi bizde yok). Tek kayda toplamak, her
 * partner'ın yarısını boş metotla doldurması demekti.
 *
 * Karar belgesi: `docs/odunc-teklif-karari.md`.
 */
export type {
  BorrowedCacheKeyInput,
  BorrowedFreshness,
  BorrowedOffer,
  BorrowedOfferQuery,
  ProductSearchErrorCode,
  ProductSearchProvider,
} from './search.js';
export {
  BORROWED_CACHE_KEY_VERSION,
  BORROWED_FRESH_SECONDS,
  BORROWED_MAX_PAGE,
  BORROWED_MIN_QUERY_LENGTH,
  BORROWED_STALE_CEILING_SECONDS,
  ProductSearchError,
  borrowedFreshness,
  buildBorrowedCacheKey,
  normalizeSearchQuery,
} from './search.js';
