'use client';

/**
 * Vercel Web Analytics — ONAYA BAĞLI.
 *
 * BULUNAN ÇELİŞKİ
 * Bileşen `layout.tsx`e KOŞULSUZ eklenmişti: sayfa açılır açılmaz, kullanıcı
 * çerez şeridine dokunmadan ölçümleme başlıyordu.
 *
 * Oysa bu depodaki Google Analytics tam tersini yapıyor ve gerekçesi
 * `Analytics.tsx` içinde yazılı: "onay alınmadan yapılan ölçümleme KVKK ve
 * ePrivacy açısından ihlaldir ve para cezasına konu olur". İki ölçüm aracının
 * aynı sitede farklı kurallara tabi olması tutarsızlık.
 *
 * "ÇEREZSİZ" YETERLİ BİR GEREKÇE DEĞİL
 * Vercel Web Analytics çerez kullanmıyor; bu gerçek ve olumlu. Ama ePrivacy
 * ve KVKK'nın konusu yalnızca çerez değil, kullanıcının cihazına erişim ve
 * kişisel veri işlenmesidir. Sitenin kendi çerez şeridi ziyaretçiye
 * "onayınız olmadan yüklenmez" diyor; bir aracı bunun dışında tutmak o
 * cümleyi yanlış hale getirir.
 *
 * KALDIRILMADI, KAPIYA BAĞLANDI. Onay verildiğinde betik yüklenir ve
 * ölçümleme normal çalışır.
 */

import { Analytics } from '@vercel/analytics/next';

import { useConsent } from '@/lib/consent';

export function VercelAnalytics() {
  const allowed = useConsent() === 'granted';

  if (!allowed) return null;

  return <Analytics />;
}
