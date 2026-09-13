/**
 * Arayüz metinleri -- dil başına tek kaynak.
 *
 * NEDEN BİR KÜTÜPHANE DEĞİL
 * `next-intl` / `i18next` gibi paketler yönlendirme, çoğul kuralları, tarih
 * biçimi ve mesaj derleyicisi getiriyor. Bu depoda sayı ve para biçimi zaten
 * `Intl` ile çözülmüş (`formatMoney`, `numberLocale`), yönlendirme ayrı bir
 * adımda ele alınıyor ve çoğul kuralı gereken yer bugün YOK. Geriye kalan tek
 * ihtiyaç "anahtar → metin" eşlemesi; onun için bir bağımlılık eklemek,
 * kullanılmayan üç özelliği paket boyutuna ve yükseltme yüküne davet etmek
 * olurdu.
 *
 * NEDEN TİPLİ
 * `MESAJLAR` nesnesinden türetilen `MessageKey`, olmayan bir anahtarı
 * DERLEME ZAMANINDA hata yapıyor. Eksik çeviri de aynı şekilde: `en`
 * sözlüğü `tr` ile birebir aynı anahtarları taşımak ZORUNDA, yoksa
 * derlenmiyor. Yarım çeviri -- sayfanın bir kısmının Türkçe kalması --
 * kullanıcıya bozuk görünür ve tam olarak bu yüzden tip seviyesinde
 * engelleniyor.
 *
 * DEĞİŞKENLER: `{ad}` biçiminde. Sayı ve para birimi BURADA biçimlenmez;
 * çağıran taraf `formatMoney`/`Intl` ile biçimlenmiş HAZIR metni geçirir --
 * yoksa biçim kuralı iki yere dağılırdı.
 */

import type { Locale } from '../market.js';

import { TR } from './tr.js';
import { EN } from './en.js';

export type MessageKey = keyof typeof TR;

/**
 * Sözlükler.
 *
 * `Record<Locale, ...>` DEĞİL: `LOCALES` bugün 'de' de taşıyor ama Almanca
 * sözlük YOK. Sözlüğü olmayan bir dili burada varmış gibi göstermek, sonra
 * çalışma zamanında `undefined` metin basmak olurdu. Hangi dillerin gerçekten
 * çevirisi olduğu `TRANSLATED_LOCALES` ile açıkça söyleniyor.
 */
const SOZLUKLER = { tr: TR, en: EN } as const;

export type TranslatedLocale = keyof typeof SOZLUKLER;

/** Çevirisi GERÇEKTEN olan diller. */
export const TRANSLATED_LOCALES = Object.keys(SOZLUKLER) as TranslatedLocale[];

export function isTranslatedLocale(locale: Locale): locale is TranslatedLocale {
  return (TRANSLATED_LOCALES as readonly string[]).includes(locale);
}

/**
 * Bir metni verilen dilde döndürür.
 *
 * Çevirisi olmayan dil Türkçeye düşer -- uydurma metin üretmek ya da anahtarı
 * ham hâliyle ekrana basmak yerine. Düşüş SESSİZ değil: `isTranslatedLocale`
 * ile önceden sorulabiliyor ve arayüz gerektiğinde "bu dil henüz yok"
 * diyebiliyor.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const sozluk = isTranslatedLocale(locale) ? SOZLUKLER[locale] : TR;
  const ham: string = sozluk[key];

  if (!params) return ham;

  return ham.replace(/\{(\w+)\}/g, (eslesme, ad: string) => {
    const deger = params[ad];
    // Verilmeyen değişken OLDUĞU GİBİ bırakılır: "{ad}" görmek, sessizce
    // boş metin basmaktan iyidir -- hata görünür olur.
    return deger === undefined ? eslesme : String(deger);
  });
}

/**
 * Bir metni "düz parça" ve "değişken" dizisine ayırır.
 *
 * NEDEN VAR: bazı cümlelerin ORTASINDA vurgu var -- "34.510 ürünü
 * karşılaştırıyoruz" cümlesinde vurgulanan şey sayıdır. `t()` yalnızca
 * metin döndürdüğü için vurguyu taşıyamaz; cümleyi parçalara bölüp ayrı
 * anahtarlara koymak ise SÖZ DİZİMİNİ tek dile çivilerdi (Türkçesi
 * "{ad} kategorisinde {n} ürünü..." diye başlar, İngilizcesi "We compare
 * {n} products in {ad}" diye).
 *
 * Bu yüzden cümle TEK anahtar olarak duruyor ve nereye ne geleceğini
 * çağıran taraf karar veriyor. Arayüz katmanı her `param` parçasının
 * yerine kendi düğümünü koyar.
 *
 * BURADA HTML AYRIŞTIRILMIYOR: sözlükte etiket yok, yalnızca `{ad}`
 * yer tutucusu var. Sözlükten gelen hiçbir metin ham HTML olarak
 * yorumlanmaz -- yani bir çeviri dosyası kod çalıştıramaz.
 */
export type MessagePart = { kind: 'text'; value: string } | { kind: 'param'; name: string };

export function splitMessage(locale: Locale, key: MessageKey): MessagePart[] {
  const ham = t(locale, key);

  return ham
    .split(/(\{\w+\})/g)
    // Bölme, yer tutucu başta ya da sonda olduğunda BOŞ parça üretir;
    // onları taşımak çağıranı gereksiz yere boş düğüm basmaya iter.
    .filter((parca) => parca !== '')
    .map((parca): MessagePart => {
      const eslesme = /^\{(\w+)\}$/.exec(parca);
      return eslesme ? { kind: 'param', name: eslesme[1]! } : { kind: 'text', value: parca };
    });
}

export { TR, EN };
