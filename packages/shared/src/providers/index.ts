export type {
  ApplicationResult,
  ApplicationState,
  DiscoveredFeed,
  NormalizedProgram,
  ProviderContext,
  ProviderFetcher,
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
export {
  getProvider,
  isKnownNetwork,
  knownNetworks,
  supportsCapability,
  networksWithCapability,
  callCapability,
} from './registry.js';
export type {
  CapabilityMatrix,
  CapabilitySupport,
  ProviderCapability,
} from './capabilities.js';
export {
  PROVIDER_CAPABILITIES,
  allCapabilities,
  requireCapability,
} from './capabilities.js';
export {
  APPLICATION_STATES,
  APPLICATION_TRANSITIONS,
  canTransition,
  isApprovalFinal,
} from './applicationTransitions.js';
