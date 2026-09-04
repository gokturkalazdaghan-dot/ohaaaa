/**
 * Sağlayıcı kaydı.
 *
 * TEK KURAL: bilinmeyen ağ sessizce `direct` sayılmaz.
 *
 * Sebep doğrudan paradır. `merchants.network` yanlış yazılmış bir mağazayı
 * varsayılana düşürmek, o mağazanın bildirimlerini YANLIŞ imza şemasıyla
 * doğrulamak demektir. İki sonuçtan biri olur: ya doğrulama hep başarısız
 * olur (gelir kaybolur), ya da yanlışlıkla geçer (doğrulama anlamsızlaşır).
 * İkisi de sessizce olur. Bu yüzden bilinmeyen ağ HATA fırlatır.
 */

import { awinProvider } from './awin.js';
import { directProvider } from './direct.js';
import { ProviderError, type AffiliateProvider } from './types.js';

/**
 * Kayıtlı sağlayıcılar.
 *
 * Yeni bir ağ eklemek (Amazon, Impact, CJ …) = bir dosya + buraya bir satır
 * + `merchants.network` kısıtına bir değer. `/git/:offerId`, `clicks`,
 * `conversions` ve open-redirect savunması değişmez.
 */
const PROVIDERS: readonly AffiliateProvider[] = [directProvider, awinProvider];

const BY_NETWORK = new Map<string, AffiliateProvider>(
  PROVIDERS.map((provider) => [provider.network, provider]),
);

/** Veritabanı kısıtıyla kodun aynı listeyi tanıdığını sınamak için. */
export function knownNetworks(): string[] {
  return [...BY_NETWORK.keys()].sort();
}

export function isKnownNetwork(network: string): boolean {
  return BY_NETWORK.has(network);
}

/**
 * Ağ adına göre sağlayıcıyı getirir.
 *
 * Bulunamazsa `ProviderError('unknown_network')` fırlatır — varsayılana
 * DÜŞMEZ.
 */
export function getProvider(network: string | null | undefined): AffiliateProvider {
  if (!network) {
    throw new ProviderError(
      'Magazanin network alani bos; saglayici secilemez.',
      'unknown_network',
    );
  }

  const provider = BY_NETWORK.get(network);

  if (!provider) {
    throw new ProviderError(
      `Taninmayan ortaklik agi: ${network}. Kayitli aglar: ${knownNetworks().join(', ')}.`,
      'unknown_network',
    );
  }

  return provider;
}
