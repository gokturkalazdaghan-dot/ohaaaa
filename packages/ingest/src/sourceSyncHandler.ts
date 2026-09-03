import { PermanentJobError, type JobHandler, type QueueJob } from '@ohaaaa/shared';

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
      throw new Error(summary.error ?? 'Alım başarısız oldu.');
    }
  };
}
