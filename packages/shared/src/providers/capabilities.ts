/**
 * Ağ yetenekleri (capability) sözleşmesi.
 *
 * ======================================================================
 * NEDEN "DESTEKLİYOR MU" AYRI BİR ALAN
 * ======================================================================
 * Bir ağın bir işi otomatik yapıp yapamadığı ÜÇ farklı durumdur ve ikisini
 * karıştırmak pahalıdır:
 *
 *   supported        API var, doğrulanmış, kod yazılmış.
 *   manual_required  Ağın API'si bunu yapmıyor ya da kullanım şartları
 *                    otomatikleştirmeyi yasaklıyor -> insan yapacak.
 *   unavailable      BİZ BİLMİYORUZ. Sözleşme doğrulanmadı.
 *
 * `manual_required` ile `unavailable` aynı şey DEĞİLDİR. Birincisi bir
 * KARAR ("bu iş elle yapılır"), ikincisi bir BOŞLUK ("henüz bakmadık").
 * Tek bir "desteklenmiyor" değerine indirgemek, boşluğu karar gibi
 * gösterir ve kimse geri dönüp bakmaz.
 *
 * ======================================================================
 * BEYAN İLE KOD AYRIŞAMAZ
 * ======================================================================
 * Bir sağlayıcı `supported` diyip metodu yazmamış olabilir. O zaman çağrı
 * çalışma anında `undefined is not a function` ile düşerdi -- yanlış yerde,
 * anlaşılmaz bir hatayla. `requireCapability` bunu çağrı anında yakalar ve
 * `capability_not_implemented` fırlatır; `providers.test.ts` ise tüm
 * kayıtlı sağlayıcılar için beyan/kod tutarlılığını topluca sınar.
 *
 * Tersi daha da önemli: metot YAZILMIŞ ama beyan `unavailable` ise çağrı
 * yine reddedilir. Yani yanlışlıkla yarım kalmış bir uygulama, beyan
 * güncellenmeden CANLIYA ÇIKAMAZ.
 */

import { ProviderError } from './types.js';

/** Ağ üzerinde otomatikleştirilebilecek işler. */
export type ProviderCapability =
  | 'program_discovery'
  | 'program_lookup'
  | 'application_submit'
  | 'application_status'
  | 'program_metadata'
  | 'feed_discovery'
  | 'deeplink'
  | 'transaction_postback'
  | 'commission_normalization';

export const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  'program_discovery',
  'program_lookup',
  'application_submit',
  'application_status',
  'program_metadata',
  'feed_discovery',
  'deeplink',
  'transaction_postback',
  'commission_normalization',
] as const;

/**
 * Bir yeteneğin durumu.
 *
 * Varsayılan YOK: her sağlayıcı her yetenek için açıkça bir değer yazmak
 * zorunda (`Record<ProviderCapability, CapabilitySupport>`). Varsayılan
 * olsaydı, yeni bir yetenek eklendiğinde tüm sağlayıcılar sessizce o
 * varsayılanı alırdı -- ve `supported` varsayılanı felaket olurdu.
 */
export type CapabilitySupport = 'supported' | 'manual_required' | 'unavailable';

export type CapabilityMatrix = Record<ProviderCapability, CapabilitySupport>;

/** Tüm yetenekleri tek bir değere ayarlar -- sözleşmesi doğrulanmamış ağlar için. */
export function allCapabilities(value: CapabilitySupport): CapabilityMatrix {
  return Object.fromEntries(
    PROVIDER_CAPABILITIES.map((c) => [c, value]),
  ) as CapabilityMatrix;
}

/**
 * Yeteneğin çağrılabilir olduğunu doğrular; değilse KAPALI BAŞARISIZ olur.
 *
 * Üç ayrı hata kodu döner çünkü çağıranın alacağı aksiyon farklıdır:
 *   manual_required            -> operatöre iş düşer, kod değişikliği gerekmez
 *   capability_unavailable     -> ağın sözleşmesi doğrulanmalı
 *   capability_not_implemented -> BİZİM hatamız: beyan var, kod yok
 */
export function requireCapability<T>(
  provider: { network: string; capabilities: CapabilityMatrix },
  capability: ProviderCapability,
  method: T | undefined,
): T {
  const support = provider.capabilities[capability];

  if (support === 'manual_required') {
    throw new ProviderError(
      `${provider.network}: "${capability}" bu agda ELLE yapilir; otomatik cagrilmaz.`,
      'manual_required',
    );
  }

  if (support === 'unavailable') {
    throw new ProviderError(
      `${provider.network}: "${capability}" icin dogrulanmis bir sozlesme yok.`,
      'capability_unavailable',
    );
  }

  if (typeof method !== 'function') {
    throw new ProviderError(
      `${provider.network}: "${capability}" destekleniyor olarak beyan edilmis ama kodu yok.`,
      'capability_not_implemented',
    );
  }

  return method;
}
