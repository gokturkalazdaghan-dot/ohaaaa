export type {
  AffiliateProvider,
  ConversionStatus,
  DeeplinkContext,
  NormalizedConversion,
  PostbackContext,
  ProviderErrorCode,
} from './types.js';
export { ProviderError } from './types.js';

export { directProvider, verifyHmacSha256 } from './direct.js';
export {
  awinProvider,
  awinClickrefToSubid,
  AWIN_PUBLISHER_ID,
  AWIN_DEEPLINK_TEMPLATE_SHAPE,
} from './awin.js';
export { getProvider, isKnownNetwork, knownNetworks } from './registry.js';
