/**
 * Başvuru durum geçiş tablosu — kodun ve veritabanının ORTAK sözleşmesi.
 *
 * ======================================================================
 * NEDEN İKİ YERDE
 * ======================================================================
 * Kapı veritabanında (`tg_programs_guard_application_state`). Orası SON
 * kapı ve öyle kalmalı: kod atlanabilir, veritabanı atlanamaz.
 *
 * Ama motor, veritabanının reddedeceği bir geçişi DENEMEMELİ. Denerse her
 * geçersiz geçiş bir DATABASE_ERROR olarak kaydedilir ve gerçek veritabanı
 * arızalarıyla aynı kefeye girer -- yani asıl arıza görünmez olur. Bu
 * tablo o yüzden var: motor önce burada durur.
 *
 * ======================================================================
 * İKİSİ AYRIŞAMAZ
 * ======================================================================
 * `scripts/verify-transition-parity.mjs` bu tabloyu göçteki CASE bloğuyla
 * karşılaştırıyor. Ayrışırlarsa CI düşer. Ayrışma sessiz olsaydı iki hata
 * biçimi doğardı: motorun boşuna denediği geçişler ve motorun yasak sandığı
 * ama aslında serbest olan geçişler -- ikincisi bir programı sonsuza kadar
 * yerinde çakılı bırakırdı.
 */

import type { ApplicationState } from './types.js';

export const APPLICATION_STATES: readonly ApplicationState[] = [
  'DISCOVERED',
  'ELIGIBLE',
  'APPLICATION_READY',
  'APPLIED',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'MANUAL_REQUIRED',
  'UNAVAILABLE',
  'NOT_IMPLEMENTED',
] as const;

/**
 * İZİN LİSTESİ — yasak listesi DEĞİL.
 *
 * Yasak listesi olsaydı, enum'a eklenecek her yeni durum varsayılan olarak
 * SERBEST olurdu ve kapı sessizce genişlerdi. Burada varsayılan REDDET.
 *
 * EN ÖNEMLİ SATIR: APPROVED yalnızca REJECTED'a gidebilir. Onay dışarıda
 * gerçekleşmiş bir olaydır -- ağ bizi kabul etti, merchant bağı kuruldu,
 * deeplink ve dönüşüm hattı ona bakıyor. Otomatik bir tur onu geri
 * çekebilseydi o programa yeniden başvurulur ve çalışan gelir hattı
 * sessizce kopardı. Onayı geri alabilecek tek şey ağın kendisidir.
 */
export const APPLICATION_TRANSITIONS: Readonly<
  Record<ApplicationState, readonly ApplicationState[]>
> = {
  DISCOVERED: [
    'ELIGIBLE', 'APPLICATION_READY', 'APPLIED', 'PENDING', 'APPROVED', 'REJECTED',
    'MANUAL_REQUIRED', 'UNAVAILABLE', 'NOT_IMPLEMENTED',
  ],
  ELIGIBLE: [
    'APPLICATION_READY', 'APPLIED', 'PENDING', 'APPROVED', 'REJECTED',
    'MANUAL_REQUIRED', 'UNAVAILABLE', 'NOT_IMPLEMENTED',
  ],
  APPLICATION_READY: [
    'APPLIED', 'PENDING', 'APPROVED', 'REJECTED',
    'MANUAL_REQUIRED', 'UNAVAILABLE', 'NOT_IMPLEMENTED',
  ],
  // Başvuru gönderildi: geriye "hiç görülmemiş"e dönüş YOK.
  APPLIED: ['PENDING', 'APPROVED', 'REJECTED', 'MANUAL_REQUIRED'],
  PENDING: ['APPROVED', 'REJECTED', 'MANUAL_REQUIRED'],
  // ONAY TEK YÖNLÜ.
  APPROVED: ['REJECTED'],
  // Ret kalıcı değil: şartlar değişince yeniden başvurulabilir.
  REJECTED: [
    'ELIGIBLE', 'APPLICATION_READY', 'APPLIED', 'PENDING',
    'MANUAL_REQUIRED', 'UNAVAILABLE', 'NOT_IMPLEMENTED',
  ],
  // Operatör elle başvurdu ve sonucu girdi.
  MANUAL_REQUIRED: [
    'ELIGIBLE', 'APPLICATION_READY', 'APPLIED', 'PENDING', 'APPROVED', 'REJECTED',
    'UNAVAILABLE', 'NOT_IMPLEMENTED',
  ],
  // Sözleşme sonradan doğrulanabilir: bu iki durum ÇIKMAZ SOKAK DEĞİL.
  UNAVAILABLE: [
    'DISCOVERED', 'ELIGIBLE', 'APPLICATION_READY', 'APPLIED', 'PENDING',
    'APPROVED', 'REJECTED', 'MANUAL_REQUIRED', 'NOT_IMPLEMENTED',
  ],
  NOT_IMPLEMENTED: [
    'DISCOVERED', 'ELIGIBLE', 'APPLICATION_READY', 'APPLIED', 'PENDING',
    'APPROVED', 'REJECTED', 'MANUAL_REQUIRED', 'UNAVAILABLE',
  ],
};

/**
 * Geçiş serbest mi.
 *
 * AYNI DURUMA GEÇİŞ SERBEST: "değişiklik yok" bir geçiş değildir ve
 * veritabanı kapısı da bu durumda hiç çalışmıyor. Yoklama turları çoğu
 * zaman aynı durumu görür; onu geçersiz saymak her turu hata üretir hâle
 * getirirdi.
 */
export function canTransition(from: ApplicationState, to: ApplicationState): boolean {
  if (from === to) return true;
  return APPLICATION_TRANSITIONS[from].includes(to);
}

/** Onay geri alınabilir mi — tek yönlülüğün okunabilir hâli. */
export function isApprovalFinal(state: ApplicationState): boolean {
  return state === 'APPROVED';
}
