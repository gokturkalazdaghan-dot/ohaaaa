import 'server-only';

import { notFound } from 'next/navigation';

import { isAffiliateOnly } from './env';

/**
 * Pazar yeri sayfalarinin ortaklik kipinde kapisi.
 *
 * NEDEN GORUNURLUK YETMEZ?
 * Basliktan "Sepet" dugmesini kaldirmak adresi kapatmaz: `/odeme`,
 * `/siparislerim` ya da `/tasoron/basvuru` hala dogrudan yazilarak
 * acilabilirdi. Ortaklik agi denetcisi de, arama motoru da adresi
 * dogrudan dener. Konumlandirma kararinin ARKASINDA bir kapi olmali.
 *
 * NEDEN 404, 403 DEGIL?
 * 403 "burada bir sey var ama giremezsin" der ve pazar yeri yuzeyinin
 * VARLIGINI dogrular. Ortaklik kipinde o yuzey kavramsal olarak YOK;
 * dogru cevap "boyle bir sayfa yok". Ayni sebeple `notFound()` mevcut
 * 404 sayfasini kullanir, ozel bir ekran uretmez.
 *
 * Kip `hybrid` yapildiginda bu cagri hicbir sey yapmaz ve sayfalar
 * oldugu gibi geri gelir -- kod silinmedi, yalnizca kapatildi.
 */
export function requireMarketplaceMode(): void {
  if (isAffiliateOnly) notFound();
}
