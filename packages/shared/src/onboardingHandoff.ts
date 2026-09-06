/**
 * Onay → onboarding devir sözleşmesi. Saf, belirlenimci, ağdan bağımsız.
 *
 * ======================================================================
 * ONAY BİR MAĞAZA KAYDI DEĞİLDİR
 * ======================================================================
 * Ağın bizi kabul etmesi, o mağazaya trafik gönderebileceğimiz anlamına
 * GELMEZ. `merchants` kanıtlı kayıt tablosudur: her satırın bir ana
 * sayfası, bir ülkesi, doğrulanmış şartları vardır ve `/git/:offerId`
 * yönlendirmesi ile dönüşüm hattı bu alanlara bakar.
 *
 * Onaylanır onaylanmaz merchant açmak, o kanıt kuralını sessizce delerdi:
 * ana sayfası bilinmeyen bir mağaza için deeplink üretilemez, komisyonu
 * bilinmeyen bir program için gelir hesaplanamaz. İkisi de çalışma anında,
 * gerçek trafikte patlar.
 *
 * Bu yüzden devir bir KARAR değil bir ÖLÇÜMDÜR: neyin hazır olduğunu ve
 * neyin EKSİK olduğunu söyler. Merchant satırını bu modül AÇMAZ.
 *
 * ======================================================================
 * EKSİK VERİ HAZIR SAYILMAZ (KAPALI BAŞARISIZ)
 * ======================================================================
 * Bilinmeyen bir alan "muhtemelen tamamdır" diye geçilmiyor. Puanlamada
 * bilinmeyen CEZA değildi -- orada bir sıralama vardı ve eksik veri
 * programı haksızca dibe çekerdi. Burada ise bir KAPI var: eksik veriyle
 * açılan bir mağaza kaydı gerçek parayı yanlış hesaplar. İki yerde iki
 * farklı kural olması bilinçli.
 *
 * ======================================================================
 * İDEMPOTENT
 * ======================================================================
 * `handoffKey` yalnızca ağ ve program kimliğinden türer. Aynı program her
 * turda aynı anahtarı üretir; devir kaydı iki kez açılamaz.
 */

import type { ApplicationState } from './providers/types.js';

/** Devir için gereken kanıt kalemleri. */
export type OnboardingRequirement =
  | 'approved_state'
  | 'homepage_url'
  | 'country_code'
  | 'commission_rate'
  | 'cookie_window_days'
  | 'verified_terms';

export const ONBOARDING_REQUIREMENTS: readonly OnboardingRequirement[] = [
  'approved_state',
  'homepage_url',
  'country_code',
  'commission_rate',
  'cookie_window_days',
  'verified_terms',
] as const;

/**
 * Devir girdisi — `programs` satırının ağ bağımsız görünümü.
 *
 * Bilinmeyen alan `null`. Boş string ya da 0 KULLANILMAZ: `commissionRate`
 * için 0 geçerli bir orandır (komisyonsuz program) ve "bilmiyoruz" ile
 * aynı hücreye yazılamaz.
 */
export interface HandoffInput {
  programId: string;
  network: string;
  networkProgramId: string;
  applicationState: ApplicationState;
  homepageUrl: string | null;
  countryCode: string | null;
  commissionRate: number | null;
  cookieWindowDays: number | null;
  /** Şartların operatörce doğrulandığı an. NULL = doğrulanmamış. */
  termsVerifiedAt: string | null;
  /** Zaten bağlanmış merchant. NULL = henüz onboarding yapılmamış. */
  merchantId: string | null;
}

export interface OnboardingHandoff {
  programId: string;
  network: string;
  networkProgramId: string;
  /** Belirlenimci ve tekil: aynı program her turda aynı anahtarı üretir. */
  handoffKey: string;
  /** Merchant kaydı AÇILABİLİR mi. Eksik tek kalem varsa false. */
  ready: boolean;
  /** Zaten devredilmiş mi -- tekrar devir işlemi yapılmamalı. */
  alreadyOnboarded: boolean;
  satisfied: OnboardingRequirement[];
  missing: OnboardingRequirement[];
}

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandoffError';
  }
}

/** Devir kaydının kimliği. Ağ ve program birlikte: aynı kimlik farklı ağda ayrı programdır. */
export function handoffKey(network: string, networkProgramId: string): string {
  return `onboard:${network}:${networkProgramId}`;
}

/**
 * Bir programın onboarding'e devredilebilir olup olmadığını ÖLÇER.
 *
 * Merchant AÇMAZ, durum DEĞİŞTİRMEZ, ağa gitmez. Yalnızca okur ve
 * söyler -- yan etkisiz olması, aynı turda defalarca çağrılabilmesi
 * demek.
 */
export function evaluateOnboardingHandoff(input: HandoffInput): OnboardingHandoff {
  if (!input.network || !input.networkProgramId) {
    throw new HandoffError('Devir icin ag ve program kimligi zorunlu.');
  }

  const satisfied: OnboardingRequirement[] = [];
  const missing: OnboardingRequirement[] = [];

  const kaydet = (gereklilik: OnboardingRequirement, saglandi: boolean) => {
    (saglandi ? satisfied : missing).push(gereklilik);
  };

  /*
   * YALNIZCA APPROVED. PENDING "yakında onaylanacak" değildir; ağ hâlâ
   * değerlendiriyor demektir ve onun üzerine mağaza kaydı açmak, hiç
   * gelmeyecek bir onayı varsaymak olurdu.
   */
  kaydet('approved_state', input.applicationState === 'APPROVED');

  // Ana sayfa olmadan deeplink hedefi ve alan adı beyaz listesi kurulamaz.
  kaydet('homepage_url', doluMetin(input.homepageUrl));

  // Ülke olmadan pazar, para birimi ve vergi tarafı belirsiz kalır.
  kaydet('country_code', doluMetin(input.countryCode));

  /*
   * 0 GEÇERLİ bir orandır ve `null`dan ayrı tutulur: komisyonsuz bir
   * programı "bilinmiyor" saymak, bilinen bir gerçeği eksik ilan etmek
   * olurdu.
   */
  kaydet(
    'commission_rate',
    input.commissionRate !== null && Number.isFinite(input.commissionRate) && input.commissionRate >= 0,
  );

  // Çerez penceresi olmadan dönüşüm ilişkilendirmesi yapılamaz:
  // `record_conversion` pencere dışındaki dönüşümü reddeder.
  kaydet(
    'cookie_window_days',
    input.cookieWindowDays !== null && Number.isFinite(input.cookieWindowDays) && input.cookieWindowDays > 0,
  );

  // Şartlar doğrulanmadan mağaza `active` yapılamaz
  // (`merchants_active_needs_verified_terms`). Devir de yapılamaz.
  kaydet('verified_terms', doluMetin(input.termsVerifiedAt));

  return {
    programId: input.programId,
    network: input.network,
    networkProgramId: input.networkProgramId,
    handoffKey: handoffKey(input.network, input.networkProgramId),
    ready: missing.length === 0,
    alreadyOnboarded: input.merchantId !== null,
    satisfied,
    missing,
  };
}

function doluMetin(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
