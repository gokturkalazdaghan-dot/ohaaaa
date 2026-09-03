/**
 * Kaynak sağlığı → kuyruk zamanlaması.
 *
 * ÇÖZÜLEN PROBLEM
 * `source_health()` ve kuyruk ayrı ayrı çalışıyordu: sağlık "bu kaynak
 * başarısız" diyor, kuyruk aynı kaynağa iş üretmeye devam ediyordu.
 * Çöken bir kaynağa normal hızda iş göndermek, onu daha da düşürür ve
 * kuyruğu başarısız işlerle doldurur -- yeniden deneme fırtınası.
 *
 * BU MODÜL BİR KARAR TABLOSU
 * Deterministik: aynı sağlık durumu + devre durumu her zaman aynı
 * politikayı verir. Zamanlayıcı bu politikaya bakarak iş üretir.
 */

import type { SourceHealthState } from './refresh.js';

export type JobPriority = 'kritik' | 'yuksek' | 'normal' | 'dusuk';

export interface SchedulingPolicy {
  /** Bu kaynak için yeni iş üretilebilir mi? */
  allowNewJobs: boolean;
  /**
   * Hangi öncelikler geçebilir.
   *
   * Sağlıksız bir kaynakta bile KRİTİK işler geçer: kullanıcının açtığı
   * bayat bir fırsatı doğrulamak, kaynağı korumaktan önce gelir --
   * kullanıcı zaten o sayfaya bakıyor.
   */
  allowedPriorities: readonly JobPriority[];
  /** Yenileme aralığı bu katsayıyla çarpılır. */
  backoffMultiplier: number;
  reason: string;
}

/**
 * Sağlık ve devre durumundan zamanlama politikası.
 *
 * Devre kesici sağlıktan ÖNCE bakılır: devre açıksa istek zaten
 * engellenecek, iş üretmek yalnızca kuyruğu şişirir ve her biri
 * başarısız olup yeniden denenir.
 */
export function schedulingPolicyFor(
  health: SourceHealthState,
  breakerOpen = false,
): SchedulingPolicy {
  if (breakerOpen) {
    return {
      allowNewJobs: false,
      // Devre açıkken kritik iş bile üretilmez: istek fiziksel olarak
      // engelleniyor, iş üretmek yalnızca ölü mektup kutusunu doldururdu.
      allowedPriorities: [],
      backoffMultiplier: 8,
      reason: 'devre_kesici_acik',
    };
  }

  switch (health) {
    case 'saglikli':
      return {
        allowNewJobs: true,
        allowedPriorities: ['kritik', 'yuksek', 'normal', 'dusuk'],
        backoffMultiplier: 1,
        reason: 'saglikli',
      };

    case 'yavas':
      // Kısmi/boş dönen kaynak: yavaşlat ama durdurma.
      return {
        allowNewJobs: true,
        allowedPriorities: ['kritik', 'yuksek', 'normal'],
        backoffMultiplier: 2,
        reason: 'kaynak_yavas',
      };

    case 'bayat':
      return {
        allowNewJobs: true,
        allowedPriorities: ['kritik', 'yuksek'],
        backoffMultiplier: 3,
        reason: 'kaynak_bayat',
      };

    case 'basarisiz':
      /*
       * Başarısız kaynakta YALNIZCA kritik iş.
       *
       * Normal katalog yenilemesi göndermek, çöken bir kaynağa yüklenmek
       * ve toparlanmasını geciktirmektir. Kritik iş geçer çünkü onun
       * arkasında bekleyen bir kullanıcı var.
       */
      return {
        allowNewJobs: true,
        allowedPriorities: ['kritik'],
        backoffMultiplier: 6,
        reason: 'kaynak_basarisiz',
      };

    case 'hic_calismadi':
      /*
       * Hiç çalışmamış kaynak CEZALANDIRILMAZ.
       *
       * Bayat ya da başarısız değil -- sadece henüz denenmemiş. Backoff
       * uygulamak, yeni eklenen bir kaynağın ilk çalışmasını geciktirmek
       * olurdu.
       */
      return {
        allowNewJobs: true,
        allowedPriorities: ['kritik', 'yuksek', 'normal', 'dusuk'],
        backoffMultiplier: 1,
        reason: 'ilk_calisma_bekleniyor',
      };
  }
}

/** Bir işin bu politikada kuyruğa girip giremeyeceği. */
export function jobAllowed(policy: SchedulingPolicy, priority: JobPriority): boolean {
  return policy.allowNewJobs && policy.allowedPriorities.includes(priority);
}

/** Politikanın uygulandığı efektif aralık. */
export function effectiveIntervalMinutes(
  baseMinutes: number,
  policy: SchedulingPolicy,
): number {
  // Üst sınır 24 saat: hiçbir kaynak bir günden fazla tamamen unutulmasın,
  // aksi halde toparlanmış bir kaynak fark edilmeden bekler.
  return Math.min(1440, Math.round(baseMinutes * policy.backoffMultiplier));
}
