/**
 * Onboarding turu — onaylı programları operasyonel merchant'a devreder.
 *
 * ======================================================================
 * KARAR VERİTABANINDA
 * ======================================================================
 * `onboard_approved_program` tek çağrıda hem kanıtı denetliyor hem mağazayı
 * açıyor hem de ağ bağını kuruyor. Bu mantığı koda taşımak, "önce kontrol
 * et, sonra yaz" kalıbına dönerdi: iki eşzamanlı tur da kontrolü geçer,
 * ikisi de yazar ve aynı mağazanın iki kaydı, iki deeplink'i, iki gelir
 * kalemi oluşur.
 *
 * Bu dosyanın işi sıralama, hız sınırı ve raporlama.
 *
 * ======================================================================
 * AĞA HİÇ GİDİLMİYOR
 * ======================================================================
 * Onboarding bir İÇ işlemdir: elimizde zaten olan veriyi mağaza kaydına
 * çevirir. Ağa istek gerekmediği için bu dosyada getirici de yok --
 * olmayan bir ağ yüzeyi, kapatılması gereken bir yüzey de değildir.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { redactError } from './http/redact.js';

/** `public.onboarding_refusal` ile birebir. */
export type OnboardingRefusal =
  | 'not_approved'
  | 'missing_homepage'
  | 'missing_country'
  | 'missing_commission'
  | 'missing_cookie_window'
  | 'missing_terms'
  | 'network_taken';

export type OnboardingStatus = 'onboarded' | 'already_onboarded' | 'refused' | 'failed';

export interface OnboardingCandidate {
  programId: string;
  network: string;
  networkProgramId: string;
}

export interface OnboardingOutcome {
  programId: string;
  network: string;
  networkProgramId: string;
  status: OnboardingStatus;
  merchantId: string | null;
  /** Reddedildiyse GEREKÇE. Tek bir "başarısız" değeri operatöre yol göstermez. */
  refusal: OnboardingRefusal | null;
  detail: string | null;
}

export interface OnboardingRunResult {
  outcomes: OnboardingOutcome[];
  onboarded: number;
  alreadyOnboarded: number;
  refused: number;
  failed: number;
  durationMs: number;
}

export interface OnboardingRepository {
  /** `onboard_approved_program` çağrısı. */
  onboard(programId: string): Promise<{
    merchantId: string | null;
    created: boolean;
    refusal: OnboardingRefusal | null;
  } | null>;
}

export function createOnboardingRepository(supabase: SupabaseClient): OnboardingRepository {
  return {
    async onboard(programId: string) {
      const { data, error } = await supabase.rpc('onboard_approved_program', {
        p_program_id: programId,
      });

      if (error) throw new Error(`Onboarding cagrisi basarisiz: ${error.message}`);

      const satir = Array.isArray(data) ? data[0] : data;
      // Program bulunamadıysa fonksiyon HİÇ SATIR döndürmez; bunu "başarılı
      // ama boş" saymak, olmayan bir programı devredilmiş göstermek olurdu.
      if (!satir) return null;

      const ham = satir as Record<string, unknown>;
      return {
        merchantId: (ham.merchant_id as string | null) ?? null,
        created: ham.created === true,
        refusal: (ham.refusal as OnboardingRefusal | null) ?? null,
      };
    },
  };
}

export interface OnboardingRunOptions {
  candidates: OnboardingCandidate[];
  supabase?: SupabaseClient;
  repository?: OnboardingRepository;
  /** Bir turda en fazla kaç program devredilir. */
  maxPerRun?: number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export const DEFAULT_ONBOARDING_OPTIONS = {
  /*
   * Tek turda 200 devir. Sınırsız olsaydı ilk gerçek onay dalgasında
   * binlerce mağaza aynı anda açılır ve hiçbiri gözden geçirilmemiş olurdu;
   * mağaza kaydı açmak geri alınması pahalı bir iştir.
   */
  maxPerRun: 200,
} as const;

/**
 * Bir onboarding turu çalıştırır.
 *
 * FIRLATMAZ: bir programın düşmesi diğerlerini durdurmaz.
 */
export async function runOnboarding(
  options: OnboardingRunOptions,
): Promise<OnboardingRunResult> {
  const {
    candidates,
    supabase,
    maxPerRun = DEFAULT_ONBOARDING_OPTIONS.maxPerRun,
    log = () => {},
  } = options;

  const repository =
    options.repository ??
    (supabase
      ? createOnboardingRepository(supabase)
      : (() => {
          throw new Error('runOnboarding: supabase ya da repository verilmeli.');
        })());

  const basladi = Date.now();
  const outcomes: OnboardingOutcome[] = [];

  for (const aday of candidates.slice(0, maxPerRun)) {
    const taban = {
      programId: aday.programId,
      network: aday.network,
      networkProgramId: aday.networkProgramId,
    };

    try {
      const sonuc = await repository.onboard(aday.programId);

      if (sonuc === null) {
        outcomes.push({
          ...taban,
          status: 'failed',
          merchantId: null,
          refusal: null,
          detail: 'Program bulunamadi.',
        });
        continue;
      }

      if (sonuc.refusal !== null) {
        log('onboarding.refused', { ...taban, refusal: sonuc.refusal });
        outcomes.push({
          ...taban,
          status: 'refused',
          merchantId: null,
          refusal: sonuc.refusal,
          detail: null,
        });
        continue;
      }

      outcomes.push({
        ...taban,
        status: sonuc.created ? 'onboarded' : 'already_onboarded',
        merchantId: sonuc.merchantId,
        refusal: null,
        detail: null,
      });

      log(sonuc.created ? 'onboarding.created' : 'onboarding.already', {
        ...taban,
        merchantId: sonuc.merchantId,
      });
    } catch (error) {
      const detail = redactError(error);
      log('onboarding.failed', { ...taban, error: detail });
      outcomes.push({
        ...taban,
        status: 'failed',
        merchantId: null,
        refusal: null,
        detail,
      });
    }
  }

  const say = (s: OnboardingStatus) => outcomes.filter((o) => o.status === s).length;

  return {
    outcomes,
    onboarded: say('onboarded'),
    alreadyOnboarded: say('already_onboarded'),
    refused: say('refused'),
    failed: say('failed'),
    durationMs: Date.now() - basladi,
  };
}
