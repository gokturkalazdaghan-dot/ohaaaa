/**
 * Mağaza izolasyonu — bir kaynağın YALNIZCA kendi mağazasının ürünlerini
 * taşıdığının kanıtlanması.
 *
 * ======================================================================
 * NEDEN VAR: `upsertOffers` MAĞAZAYI SORGULAMAZ.
 * ======================================================================
 * İmza şu: `upsertOffers(merchantId, sourceId, rows, marketCode)`. Yani
 * bir turda okunan HER SATIR, kaynağın bağlı olduğu TEK mağazaya yazılır.
 * Satırların gerçekten o mağazaya ait olup olmadığı hiçbir yerde
 * sorulmuyordu.
 *
 * Tek kaynaklı bir feed'de bu sorun değil. Ortaklık ağlarının BİRLEŞİK
 * (combined/multi-feed) indirmelerinde ise felakettir: Awin'in Product
 * Data indirmesi tek bir `.csv.gz` içinde YÜZLERCE reklamverenin ürününü
 * taşıyabiliyor (eldeki örnek: 215 feed). Böyle bir dosyayı tek bir
 * kaynağa bağlamak, 215 mağazanın ürününü tek mağazanın altına yazmak
 * demek -- ve arıza SESSİZDİR: sayaçlar yeşil, `created` yüksek, katalog
 * yanlış. Yanlış mağazaya yazılmış bir teklif, kullanıcıyı satın alamayacağı
 * bir satıcıya gönderir ve komisyon yanlış programa atfedilir.
 *
 * MİMARİ KURAL: bir mağaza → bir kaynak → bir doğrulanmış feed.
 * Bu modül o kuralın ÇALIŞMA ANINDAKİ yaptırımıdır.
 *
 * FAIL CLOSED. Kaynak "ben yalnızca şu reklamvereni taşırım" diye bir
 * iddiada bulunuyorsa (`expectedAdvertiserId` dolu), bu iddia
 * DOĞRULANAMADIĞINDA da alım durur. "Doğrulayamadım" ile "doğrudur" aynı
 * şey değildir; ikisini birleştirmek, korumayı yapılandırma hatasıyla
 * sessizce kapatılabilir hâle getirirdi.
 */

import { IngestError } from './errors.js';
import type { FieldMapping, RawRecord } from './types.js';

/** Örnek hata metninde en fazla kaç yabancı kimlik adıyla anılır. */
const MAX_ORNEK_KIMLIK = 5;

export interface IsolationExpectation {
  /** Bu kaynağın taşıdığı reklamverenin ağ kimliği (Awin'de MID). */
  advertiserId: string;
  /** Ağın feed kimliği -- yalnızca hata metnini okunur kılmak için. */
  feedId?: string | null;
  /** Kaynağın slug'ı -- hangi kaynağın durduğunu söylemek için. */
  sourceSlug: string;
}

export interface IsolationResult {
  /** Kaç satır denetlendi. */
  checked: number;
  /** Feed'de görülen tekil reklamveren kimlikleri (doğrulama geçtiyse tek eleman). */
  advertiserIds: string[];
}

/**
 * Feed'in her satırının beklenen reklamverene ait olduğunu doğrular.
 *
 * Geçerse sessizdir; geçmezse `SECURITY_ERROR` fırlatır ve hat hiçbir şey
 * yazmadan durur. KALICI olarak sınıflandırılır: yanlış feed'i yeniden
 * indirmek aynı yanlış feed'i getirir, yalnızca sağlayıcıya yük bindirir.
 *
 * Hata metni YALNIZCA kimlikleri taşır -- ürün satırı, adres ya da
 * kimlik bilgisi taşımaz. Bu metin `ingest_runs.error` ve
 * `sources.last_error` sütunlarına yazılıyor.
 */
export function assertMerchantIsolation(
  records: readonly RawRecord[],
  mapping: FieldMapping,
  expected: IsolationExpectation,
): IsolationResult {
  const nerede =
    `kaynak '${expected.sourceSlug}'` +
    (expected.feedId ? `, feed ${expected.feedId}` : '');

  const kolon = mapping.merchant_id;

  /*
   * İDDİA VAR AMA DENETLEME YOLU YOK.
   *
   * Operatör "bu kaynak yalnızca X reklamverenini taşır" dedi ama feed'in
   * hangi kolonunun reklamvereni taşıdığını söylemedi. Sessizce geçmek,
   * korumayı bir yapılandırma eksiğiyle kapatmak olurdu.
   */
  if (!kolon) {
    throw new IngestError(
      'CONFIG_ERROR',
      `${nerede}: reklamveren ${expected.advertiserId} bekleniyor ama ` +
        'field_mapping.merchant_id tanımlı değil -- satırların hangi mağazaya ' +
        'ait olduğu doğrulanamıyor. Alım durduruldu.',
      true,
    );
  }

  const beklenen = expected.advertiserId.trim();
  const gorulen = new Set<string>();
  let bos = 0;

  for (const record of records) {
    const ham = record[kolon];

    /*
     * Kolon eşlendi ama satırda YOK ya da boş. Birleşik bir indirmede bu,
     * satırın kime ait olduğunun bilinmemesi demek -- geçirilemez.
     */
    if (typeof ham !== 'string' || ham.trim() === '') {
      bos += 1;
      continue;
    }

    gorulen.add(ham.trim());
  }

  if (bos > 0) {
    throw new IngestError(
      'SECURITY_ERROR',
      `${nerede}: ${records.length} satırın ${bos} tanesinde '${kolon}' kolonu ` +
        'boş -- bu satırların hangi mağazaya ait olduğu doğrulanamıyor. ' +
        'Alım durduruldu, hiçbir ürün yazılmadı.',
      true,
    );
  }

  const yabanci = [...gorulen].filter((id) => id !== beklenen);

  if (yabanci.length > 0) {
    /*
     * ASIL KORUMA BURASI. Birleşik feed doğrudan bu dala düşer.
     *
     * Metin kaç yabancı reklamveren olduğunu ve birkaç örneğini söyler --
     * hepsini dökmek 215 kimlikli bir hata satırı üretirdi ve
     * `sources.last_error` sütununu okunamaz hâle getirirdi.
     */
    const ornek = yabanci.slice(0, MAX_ORNEK_KIMLIK).join(', ');
    const fazlasi = yabanci.length > MAX_ORNEK_KIMLIK
      ? ` (+${yabanci.length - MAX_ORNEK_KIMLIK} tane daha)`
      : '';

    throw new IngestError(
      'SECURITY_ERROR',
      `${nerede}: feed yalnızca reklamveren ${beklenen} taşımalıydı ama ` +
        `${yabanci.length} farklı yabancı reklamveren içeriyor: ${ornek}${fazlasi}. ` +
        'BİRLEŞİK (multi-feed) bir indirme tek mağazaya bağlanmış olabilir. ' +
        'Alım durduruldu, hiçbir ürün yazılmadı.',
      true,
    );
  }

  /*
   * Beklenen kimlik hiç görülmedi: feed boş değil ama tek bir satırı bile
   * bize ait değil. Yukarıdaki dallar bunu zaten yakalar; buraya yalnızca
   * kayıt listesi boşsa gelinir.
   */
  if (records.length > 0 && !gorulen.has(beklenen)) {
    throw new IngestError(
      'SECURITY_ERROR',
      `${nerede}: beklenen reklamveren ${beklenen} feed'de hiç bulunamadı.`,
      true,
    );
  }

  return { checked: records.length, advertiserIds: [...gorulen] };
}
