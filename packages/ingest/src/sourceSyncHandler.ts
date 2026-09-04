import { PermanentJobError, type JobHandler, type QueueJob } from '@ohaaaa/shared';

import { isPermanentClass } from './errors.js';
import { runSource, type Fetcher, type IngestRepository } from './pipeline.js';
import type { IngestSummary, SourceConfig } from './types.js';

/**
 * SOURCE_SYNC iş türünün işleyicisi.
 *
 * ZİNCİRDEKİ EKSİK HALKA BUYDU. Kuyruk, worker ve `runSource` üçü de
 * ayrı ayrı çalışıyordu ama birbirlerini tanımıyorlardı. Bu dosya onları
 * birleştiriyor -- ve başka hiçbir şey yapmıyor: yeni bir alım mantığı,
 * yeni bir durum makinesi ya da ikinci bir zamanlama kararı yok.
 *
 * KAYNAK PAYLOAD'DAN DEĞİL VERİTABANINDAN ÇÖZÜLÜR.
 *
 * İş yükü yalnızca `source_id` taşıyor. Kaynak yapılandırmasının tamamını
 * (alan haritası, izinli alan adları, nezaket ayarları) işe kopyalamak,
 * kuyrukta bekleyen bir işin ESKİ yapılandırmayla çalışması demekti:
 * operatör alan haritasını düzeltir, kuyruktaki iş yine bozuk haritayla
 * çalışırdı.
 */

export interface SourceSyncDeps {
  /** Kaynak yapılandırmasını kimliğinden çözer. */
  loadSource(sourceId: string): Promise<SourceConfig | null>;
  repository: IngestRepository;
  fetcher: Fetcher;
  /** Tamamlanan her alımın özeti — telemetri ve test için. */
  onComplete?(summary: IngestSummary): void;
}

/** İş yükünden kaynak kimliğini güvenle okur. */
function readSourceId(job: QueueJob): string {
  const raw = job.payload['source_id'];
  if (typeof raw !== 'string' || raw.length === 0) {
    /*
     * Bozuk yük KALICI hatadır.
     *
     * Yeniden denemek hiçbir şeyi değiştirmez -- yük değişmeyecek. Geçici
     * saymak, aynı bozuk işi geri çekilmeyle tekrar tekrar denemek ve
     * kuyrukta sonsuza dek dönen bir kayıt bırakmak olurdu.
     */
    throw new PermanentJobError('SOURCE_SYNC yükünde geçerli source_id yok.');
  }
  return raw;
}

/**
 * Worker'ın `handlers` haritasına takılacak işleyici.
 *
 * @example
 *   runWorkerOnce({
 *     repository: queueRepo,
 *     handlers: { SOURCE_SYNC: createSourceSyncHandler(deps) },
 *   })
 */
export function createSourceSyncHandler(deps: SourceSyncDeps): JobHandler {
  return async (job: QueueJob): Promise<void> => {
    const sourceId = readSourceId(job);
    const source = await deps.loadSource(sourceId);

    if (!source) {
      /*
       * Kaynak silinmiş ya da devre dışı: yeniden denemek anlamsız.
       * Kalıcı hata olarak işaretlenip ölü mektuba düşmesi, sebebiyle
       * birlikte görünür kalması demek.
       */
      throw new PermanentJobError(`Kaynak bulunamadı ya da etkin değil: ${sourceId}`);
    }

    /*
     * GERÇEK ALIM. Sahte bir sonuç üretilmiyor; `runSource` mevcut
     * hattın tamamını çalıştırıyor:
     *   getir → ayrıştır → normalleştir → parmak izi → delta
     *   → yaz/atla → bayatlat → yenileme planı
     */
    const summary = await runSource(source, {
      fetcher: deps.fetcher,
      repository: deps.repository,
    });

    deps.onComplete?.(summary);

    /*
     * BAŞARISIZ ALIM, BAŞARISIZ İŞTİR.
     *
     * `runSource` hata fırlatmaz; durumu özete yazar. İşi burada
     * başarısız işaretlemeseydik kuyruk onu "tamamlandı" sayar ve
     * yeniden deneme hiç çalışmazdı -- kuyruğun retry mekanizması
     * sessizce devre dışı kalırdı.
     *
     * Kısmi tur başarısız SAYILMAZ: veri yazıldı, katalog korundu ve
     * bir sonraki plan zaten geri çekilme uyguladı. Onu da yeniden
     * denemek, zaten yavaşlatılmış bir kaynağı hemen tekrar dövmek olurdu.
     */
    if (summary.status === 'failed') {
      const mesaj = summary.error ?? 'Alım başarısız oldu.';

      /*
       * HATANIN SINIFI, YENİDEN DENEME KARARINI VERİR.
       *
       * Önce her başarısız tur düz `Error` olarak fırlatılıyordu ve kuyruk
       * hepsini GEÇİCİ sayıyordu. Bunun ölçülebilir bedeli şuydu: eksik bir
       * ortam değişkeni ya da yanlış bir alan haritası -- tekrar denenince
       * kesinlikle aynı sonucu verecek hatalar -- üstel geri çekilmeyle beş
       * kez deneniyor, kaynak saatler boyunca "yeniden denenecek" görünüyor
       * ve ancak sonunda ölü mektuba düşüyordu. 401 alan bir kaynakta bu,
       * sağlayıcıya dört kez daha kimliksiz istek göndermek demekti.
       *
       * Sınıflandırma tanımadığı hatayı GEÇİCİ bırakır: ters varsayım,
       * düzelebilecek bir arızayı ilk denemede kalıcı işaretleyip kaynağı
       * sessizce öldürürdü.
       */
      /*
       * ÖRNEK KARARI TABLODAN ÖNCE GELİR.
       *
       * Aynı sınıf iki karar verebilir: 404 kalıcı, 503 geçicidir. Yalnızca
       * sınıf tablosuna bakmak 503'ü kalıcı sayıyordu; test bunu yakaladı.
       * Tablo yalnızca özette karar yoksa (eski kayıt, elle üretilmiş özet)
       * geri düşüş olarak kullanılıyor.
       */
      const kalici =
        summary.errorPermanent ??
        (summary.errorClass ? isPermanentClass(summary.errorClass) : false);

      if (kalici) {
        throw new PermanentJobError(`[${summary.errorClass}] ${mesaj}`);
      }

      throw new Error(`[${summary.errorClass ?? 'UNKNOWN_ERROR'}] ${mesaj}`);
    }
  };
}
