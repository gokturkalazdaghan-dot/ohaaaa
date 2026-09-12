/**
 * Sıkıştırılmış feed gövdelerinin açılması.
 *
 * NEDEN VAR: hat, gövdeyi yalnızca METİN olarak taşıyordu
 * (`readBodyLimited` baytları okuyup hemen UTF-8'e çeviriyordu). Ortaklık
 * ağlarının ürün feed'leri ise sıklıkla SIKIŞTIRILMIŞ DOSYA olarak sunulur
 * (`.csv.gz`): baytlar gzip'tir, metin değildir.
 *
 * ÖNEMLİ AYRIM — İKİ FARKLI GZIP:
 *
 *   1. `content-encoding: gzip`  → AKTARIM sıkıştırması. `fetch` bunu
 *      kendiliğinden açar; buraya hiç gelmez. İstemci zaten
 *      `accept-encoding: gzip, deflate` gönderiyor.
 *
 *   2. `.csv.gz` gövdesi         → İÇERİĞİN KENDİSİ bir gzip dosyası.
 *      `fetch` bunu AÇMAZ; bayt bayt teslim eder.
 *
 * İkincisi UTF-8'e çevrildiğinde geri dönüşü olmayan biçimde bozulur:
 * geçersiz bayt dizileri U+FFFD'ye düşer ve ham gövde bir daha elde
 * edilemez. Bu yüzden açma işlemi METİNDEN DEĞİL BAYTTAN yapılmak
 * zorunda; `FetchResult.bytes` tam olarak bunun için taşınıyor.
 *
 * BİÇİM SEZGİSİ İÇERİKTEN, BAŞLIKTAN DEĞİL. `content-type` ortaklık
 * ağlarında güvenilmez: aynı `.gz` adresi kimi sunucuda
 * `application/octet-stream`, kimisinde `text/csv` döner. Sihirli baytlar
 * (magic bytes) belirsizlik bırakmaz.
 */

import { gunzipSync, inflateSync } from 'node:zlib';

import { IngestError } from '../errors.js';

/** gzip: 1f 8b */
const GZIP_SIHRI = [0x1f, 0x8b] as const;
/** zip: 50 4b 03 04 ("PK\x03\x04") */
const ZIP_SIHRI = [0x50, 0x4b, 0x03, 0x04] as const;
/** zlib/deflate: 78 01 | 78 9c | 78 da */
const ZLIB_ILK = 0x78;
const ZLIB_IKINCI = new Set([0x01, 0x9c, 0xda]);

export type SikistirmaBicimi = 'gzip' | 'zip' | 'zlib' | 'none';

function baslarMi(bytes: Uint8Array, sihir: readonly number[]): boolean {
  if (bytes.length < sihir.length) return false;
  return sihir.every((beklenen, i) => bytes[i] === beklenen);
}

/** Gövdenin sıkıştırma biçimini sihirli baytlardan tespit eder. */
export function detectCompression(bytes: Uint8Array): SikistirmaBicimi {
  if (baslarMi(bytes, GZIP_SIHRI)) return 'gzip';
  if (baslarMi(bytes, ZIP_SIHRI)) return 'zip';
  if (bytes.length >= 2 && bytes[0] === ZLIB_ILK && ZLIB_IKINCI.has(bytes[1]!)) {
    return 'zlib';
  }
  return 'none';
}

/**
 * Gövdeyi gerekiyorsa açar ve UTF-8 metne çevirir.
 *
 * `maxBytes` AÇILMIŞ boyutun üst sınırıdır ve açma sırasında uygulanır --
 * sonrasında değil. SIKIŞTIRMA BOMBASI tam olarak bu yüzden burada
 * durdurulur: 1 MB'lık bir gzip 1 GB'a açılabilir ve `maxBodyBytes`
 * yalnızca İNDİRİLEN baytı sınırladığı için bu sınırı hiç görmez. Açılmış
 * boyutu sonradan ölçmek, işçiyi zaten düşürdükten sonra ölçmek olurdu.
 *
 * `zip` AÇILMAZ. Node'un standart kütüphanesinde zip çözücü yoktur ve
 * yarım yazılmış bir zip okuyucu (yerel başlık, merkezi dizin, çok
 * dosyalı arşiv) sessizce yanlış dosyayı seçebilirdi. Operatöre biçimi
 * söyleyip durmak, yanlış veriyi katalog yazmaktan iyidir.
 */
export function decompressToText(
  bytes: Uint8Array,
  options: { maxBytes: number; url?: string },
): string {
  const bicim = detectCompression(bytes);
  const nerede = options.url ? ` (${options.url})` : '';

  if (bicim === 'none') {
    return new TextDecoder('utf-8').decode(bytes);
  }

  if (bicim === 'zip') {
    /*
     * KALICI: aynı adres her denemede aynı zip'i döndürecektir. Yeniden
     * denemek yalnızca sağlayıcıya yük bindirir.
     */
    throw new IngestError(
      'CONFIG_ERROR',
      `Feed bir ZIP arşivi${nerede}. Bu hat yalnızca gzip açabiliyor; ` +
        "kaynağın adresini sağlayıcının '.gz' (gzip) sürümüyle değiştirin.",
      true,
    );
  }

  try {
    const acilmis =
      bicim === 'gzip'
        ? gunzipSync(bytes, { maxOutputLength: options.maxBytes })
        : inflateSync(bytes, { maxOutputLength: options.maxBytes });

    return new TextDecoder('utf-8').decode(acilmis);
  } catch (error) {
    /*
     * Sınır aşımı ile bozuk dosya AYRI raporlanır. İkisini tek mesajda
     * toplamak, operatöre "feed bozuk" dedirtip aslında sınırın küçük
     * olduğu bir durumda yanlış yere baktırırdı.
     */
    const kod = (error as { code?: string } | null)?.code;
    if (kod === 'ERR_BUFFER_TOO_LARGE' || kod === 'ERR_BUFFER_OUT_OF_BOUNDS') {
      throw new IngestError(
        'CONFIG_ERROR',
        `Açılmış feed ${options.maxBytes} bayt sınırını aşıyor${nerede}. ` +
          'Sıkıştırma bombasına karşı durduruldu.',
        true,
      );
    }

    /*
     * GEÇİCİ: sağlayıcının yarım yazılmış dosyası yaygın bir durumdur ve
     * bir sonraki yayında düzelir. Kalıcı saymak, düzelecek bir arızada
     * kaynağı tek denemede öldürürdü.
     */
    throw new IngestError(
      'PARSER_ERROR',
      `Sıkıştırılmış feed açılamadı${nerede}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      false,
    );
  }
}
