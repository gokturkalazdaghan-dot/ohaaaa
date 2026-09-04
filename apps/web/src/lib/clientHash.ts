import 'server-only';

/**
 * Ziyaretçi kimliğinin GERİ ÇEVRİLEMEZ özeti.
 *
 * NEDEN TUZ ŞART
 * Düz `sha256(ip)` gizlilik sağlamaz: IPv4 uzayı 2^32'dir ve tamamı sıradan
 * bir makinede saatler içinde taranıp özet tablosu çıkarılabilir. Yani
 * tuzsuz bir özet, IP adresini SAKLAMAK değil, yalnızca ZORLAŞTIRMAKTIR.
 *
 * NEDEN GÜNLÜK DÖNEN TUZ
 * Sabit bir tuz, özeti kalıcı bir kullanıcı kimliğine çevirir: aynı kişi
 * aylar boyunca aynı dizeyle izlenebilir. Günlük döndürmek, aynı gün
 * içindeki tekilleştirmeyi (hız sınırı, kötüye kullanım) korurken günler
 * arası takibi imkânsız kılar.
 *
 * Bu mantık depoda ÜÇ AYRI YERDE ayrı ayrı yazılmıştı ve üçü de aynı şeyi
 * yapmıyordu -- /api/iletisim tuzsuz özet kullanıyordu. Tek kaynağa
 * indirildi.
 */

import { createHash } from 'node:crypto';

/** Vekil sunucuların ilettiği istemci adresi. Bulunamazsa null. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;

  const real = headers.get('x-real-ip')?.trim();
  return real && real.length > 0 ? real : null;
}

/**
 * Günlük dönen tuz.
 *
 * `CLICK_HASH_SECRET` tanımlı değilse sabit bir yedek kullanılır ve bu
 * DURUM GİZLENMEZ: yedek tuz öngörülebilirdir, yani üretimde değişken
 * mutlaka tanımlanmalıdır (.env.example'da yazılı).
 */
export function dailySalt(): string {
  const secret = process.env.CLICK_HASH_SECRET ?? 'ohaaaa-varsayilan-tuz';
  return `${secret}:${new Date().toISOString().slice(0, 10)}`;
}

/** Tuzlanmış özet. Aynı gün + aynı değer = aynı dize. */
export function hashWithDailySalt(value: string): string {
  return createHash('sha256').update(`${dailySalt()}:${value}`).digest('hex').slice(0, 32);
}

/**
 * İstemci adresinin günlük tuzlanmış özeti.
 *
 * Adres okunamazsa `'bilinmeyen'` döner -- ve bu KASITLI olarak tek bir
 * kovaya düşer: adresini gizleyen bütün istekler aynı sayacı paylaşır,
 * yani başlık silerek sınırdan kaçılamaz.
 */
export function hashedClientIp(headers: Headers): string {
  const ip = clientIp(headers);
  return ip ? hashWithDailySalt(ip) : 'bilinmeyen';
}
