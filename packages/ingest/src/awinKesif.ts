/**
 * AWIN FEED LİSTESİ KEŞFİ -- YALNIZCA OKUR, HİÇBİR ŞEY YAZMAZ.
 *
 * NEDEN YAZMIYOR: kullanıcının kendi kuralı -- "ÖNCE DENETLE, SONRA
 * UYGULA". Ayrıştırıcı gerçek bir Awin yanıtıyla henüz hiç çalışmadı;
 * ilk çalıştırmada 38 programın satırlarını yazmak, doğrulanmamış bir
 * okumaya dayanarak toplu veri yazmak olurdu. Önce çıktıyı görürüz,
 * sonra yazma adımını gerçek veriyle kurarız.
 *
 * ÇIKTIDA ANAHTAR YOKTUR: adres `expandSecretPlaceholders`'tan geçer,
 * bu da değeri maskeleme defterine yazar; her satır `redact`'ten geçirilir.
 * Awin anahtarı YOLDA durduğu için (`/apikey/<deger>/`) tek koruma budur --
 * `maskUrl` yalnızca sorgu dizisini temizler.
 */

import { parseAwinFeedListesi, AWIN_FEED_LISTESI_ADRESI } from './awinFeedList.js';
import type { AwinFeedKaydi } from './awinFeedList.js';
import { expandSecretPlaceholders, redact } from './http/redact.js';
import { IngestError } from './errors.js';

export interface KesifSonucu {
  kayitlar: AwinFeedKaydi[];
  uyarilar: string[];
}

/** Feed listesini indirir ve ayrıştırır. Veritabanına DOKUNMAZ. */
export async function awinFeedListesiniGetir(
  fetcher: (url: string) => Promise<{ body: string; status: number }>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<KesifSonucu> {
  // Yer tutucuyu burada çözüyoruz: aynı çağrı değeri maskeleme defterine yazar.
  const adres = expandSecretPlaceholders(AWIN_FEED_LISTESI_ADRESI, env);

  const yanit = await fetcher(adres);

  if (yanit.status !== 200) {
    throw new IngestError(
      'CONFIG_ERROR',
      `Awin feed listesi ${yanit.status} döndü. ` +
        'Anahtar geçersiz ya da bu uca yetkisi yok.',
      true,
    );
  }

  const { kayitlar, uyarilar } = parseAwinFeedListesi(yanit.body);
  return { kayitlar, uyarilar };
}

/**
 * Sonucu insana okunur biçimde yazar.
 *
 * ÜRÜN SAYISI SIRALAMAYI BELİRLER çünkü asıl karar bu: 500 MB'lik sınırda
 * kalan yer sınırlı ve hangi feed'in sığdığını İNDİRMEDEN bilmek istiyoruz.
 */
export function kesfiYazdir(
  sonuc: KesifSonucu,
  yaz: (satir: string) => void = console.log,
): void {
  const { kayitlar, uyarilar } = sonuc;

  yaz(`Awin feed listesi: ${kayitlar.length} feed`);
  yaz('');
  yaz(
    ['ADVERTISER'.padEnd(10), 'FEED'.padEnd(8), 'ÜRÜN'.padStart(9), 'ÜYELİK'.padEnd(14), 'AD'].join(
      '  ',
    ),
  );

  const sirali = [...kayitlar].sort((a, b) => (b.itemCount ?? -1) - (a.itemCount ?? -1));

  for (const k of sirali) {
    yaz(
      redact(
        [
          k.advertiserId.padEnd(10),
          k.feedId.padEnd(8),
          (k.itemCount === null ? '?' : k.itemCount.toLocaleString('tr-TR')).padStart(9),
          (k.membershipStatus ?? '?').padEnd(14),
          `${k.advertiserName}${k.feedName ? ` / ${k.feedName}` : ''}`,
        ].join('  '),
      ),
    );
  }

  if (uyarilar.length > 0) {
    yaz('');
    yaz(`UYARILAR (${uyarilar.length}):`);
    for (const u of uyarilar) yaz(`  - ${redact(u)}`);
  }

  /*
   * Toplam, yer bütçesi kararının girdisi. Bilinmeyen sayılar toplama
   * KATILMAZ ve ayrıca sayılır -- bilinmeyeni sıfır saymak, bütçeyi
   * olduğundan geniş göstermek olurdu.
   */
  const bilinen = sirali.filter((k) => k.itemCount !== null);
  const toplam = bilinen.reduce((a, k) => a + (k.itemCount ?? 0), 0);

  yaz('');
  yaz(
    `Toplam ürün (bilinen ${bilinen.length} feed): ${toplam.toLocaleString('tr-TR')}` +
      (bilinen.length < sirali.length
        ? ` -- ${sirali.length - bilinen.length} feed'in sayısı bilinmiyor`
        : ''),
  );
}
