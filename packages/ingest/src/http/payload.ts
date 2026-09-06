/**
 * Feed gövdesinin biçimini çözer: düz metin, gzip'lenmiş dosya ya da arşiv.
 *
 * ======================================================================
 * TAŞIMA SIKIŞTIRMASI İLE DOSYA SIKIŞTIRMASI AYNI ŞEY DEĞİL
 * ======================================================================
 * `Content-Encoding: gzip` bir TAŞIMA katmanı ayrıntısıdır ve `fetch` onu
 * kendiliğinden açar; bize düz metin ulaşır.
 *
 * Ama ağların çoğu feed'i `urunler.csv.gz` olarak yayınlar. O bir DOSYADIR:
 * `Content-Type: application/gzip` gelir, `fetch` HİÇ AÇMAZ ve gövde ikili
 * veri olarak elimize geçer. Bu fark görülmezse CSV ayrıştırıcısı ikili
 * veriyi metin sanıp ayrıştırır: hata düşmez, yalnızca sıfır satır ya da
 * çöp satırlar üretir -- ve alım turu "başarılı, 0 ürün" der.
 *
 * Bu yüzden biçim SİHİRLİ BAYTLARDAN okunuyor, `Content-Type`'tan değil:
 * sunucular bu başlığı sık sık yanlış gönderir ve baytlar yalan söylemez.
 *
 * ======================================================================
 * SIKIŞTIRMA BOMBASI
 * ======================================================================
 * Gövde boyutu sınırı SIKIŞTIRILMIŞ akışa uygulanıyor. 1 MB'lık bir gzip
 * 10 GB'a açılabilir; sınır yalnız indirmeye bakarsa işçi açma sırasında
 * düşer. Bu yüzden AÇILMIŞ boyutun da ayrı bir tavanı var ve aşıldığı anda
 * açma iptal ediliyor -- tamamlanmasını beklemeden.
 *
 * ======================================================================
 * ARŞİVLER KAPALI BAŞARISIZ
 * ======================================================================
 * zip/tar/7z/rar REDDEDİLİYOR. Bunları açmak dizin geçişi (`../`), çok
 * girdili bomba ve "hangi dosya feed?" sorusunu getirir; üçü de
 * doğrulanmamış saldırı yüzeyidir. Bir arşiv feed'i geldiğinde doğru cevap
 * onu sessizce yanlış ayrıştırmak değil, AÇIKÇA reddetmek ve operatöre
 * söylemektir.
 */

import { gunzipSync } from 'node:zlib';

import { IngestError } from '../errors.js';

export type PayloadKind = 'plain' | 'gzip' | 'zip' | 'other_archive';

/** Açılmış gövde için tavan. Sıkıştırılmış sınırın 20 katı. */
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;

/**
 * Sihirli baytlardan biçim çözer.
 *
 * `Content-Type` KULLANILMIYOR: sunucular onu sık sık yanlış gönderir
 * (`application/octet-stream` altında gzip, `text/plain` altında zip) ve
 * yanlış bir başlığa göre ayrıştırmak sessiz çöp üretir. Baytlar yalan
 * söylemez.
 */
export function classifyPayload(bytes: Uint8Array): PayloadKind {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';

  // PK\x03\x04 / PK\x05\x06 (bos) / PK\x07\x08 (parcali)
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';

  // 7z: 37 7A BC AF 27 1C
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc &&
    bytes[3] === 0xaf && bytes[4] === 0x27 && bytes[5] === 0x1c
  ) {
    return 'other_archive';
  }

  // Rar!\x1a\x07
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 &&
    bytes[3] === 0x21 && bytes[4] === 0x1a
  ) {
    return 'other_archive';
  }

  // tar: 257. bayttan itibaren "ustar"
  if (bytes.length >= 262) {
    const ustar = [0x75, 0x73, 0x74, 0x61, 0x72];
    if (ustar.every((b, i) => bytes[257 + i] === b)) return 'other_archive';
  }

  return 'plain';
}

export interface DecodeOptions {
  /** Açılmış gövde için tavan. */
  maxDecompressedBytes?: number;
  /** Hata mesajında görünecek adres (maskelenmiş olarak verilmeli). */
  url?: string;
}

/**
 * Gövdeyi metne çevirir; gerekiyorsa gzip'i açar, arşivi REDDEDER.
 *
 * Fırlattığı hatalar KALICI: aynı gövdeyi yeniden indirmek sonucu
 * değiştirmez ve kuyruğun tekrar denemesi yalnız kaynağı yorar.
 */
export function decodeFeedPayload(bytes: Uint8Array, options: DecodeOptions = {}): string {
  const {
    maxDecompressedBytes = DEFAULT_MAX_DECOMPRESSED_BYTES,
    url = '(adres yok)',
  } = options;

  const kind = classifyPayload(bytes);

  if (kind === 'zip' || kind === 'other_archive') {
    throw new IngestError(
      'SECURITY_ERROR',
      `Arsiv bicimindeki feed desteklenmiyor (${kind}): ${url}. Arsiv acmak ` +
        'dizin gecisi ve cok girdili bomba yuzeyi getirir; dogrulanmadan ' +
        'acilmaz. Feed i duz ya da gzip olarak yayinlayin.',
      true,
    );
  }

  if (kind === 'gzip') {
    let acilmis: Buffer;
    try {
      /*
       * `maxOutputLength` açma sırasında tavana ulaşıldığı anda hata
       * fırlatır -- tamamının açılmasını BEKLEMEDEN. Sonradan boyuta
       * bakmak, 10 GB'ı zaten belleğe almış olmak demekti.
       */
      acilmis = gunzipSync(bytes, { maxOutputLength: maxDecompressedBytes });
    } catch (error) {
      const mesaj = error instanceof Error ? error.message : String(error);
      throw new IngestError(
        'SECURITY_ERROR',
        `Gzip govde acilamadi ya da tavani asti (${maxDecompressedBytes} bayt): ` +
          `${url}. ${mesaj}`,
        true,
      );
    }

    return new TextDecoder('utf-8').decode(acilmis);
  }

  return new TextDecoder('utf-8').decode(bytes);
}
