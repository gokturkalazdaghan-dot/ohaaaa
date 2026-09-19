/**
 * Zamanlanmış alım turu — CLI ve HTTP tetikleyicinin ORTAK çekirdeği.
 *
 * ======================================================================
 * NEDEN BU DOSYA VAR: TEK ALIM YOLU
 * ======================================================================
 * Bu mantık daha önce yalnızca `cli.ts` içindeki `main()`'de yaşıyordu ve
 * `console.log` / `process.exit` ile iç içeydi. Vercel Cron'dan da
 * çalıştırmak gerektiğinde iki seçenek vardı:
 *
 *   (a) HTTP tarafında aynı adımları yeniden yazmak,
 *   (b) mantığı buraya çıkarıp iki çağıranın da onu kullanması.
 *
 * (a) seçilseydi kısa vadede daha hızlı olurdu ve uzun vadede en pahalı
 * hata olurdu: iki alım yolu, zamanla AYRIŞAN iki davranış demektir.
 * Biri nezaket gecikmesini uygular, diğeri unutur; biri yetim işleri
 * kurtarır, diğeri kurtarmaz. Ayrışma sessizdir -- ikisi de "çalışıyor"
 * görünür ve fark yalnızca üretimde, veri bozulduğunda ortaya çıkar.
 *
 * Bu yüzden burada NE console.log NE process.exit var: ikisi de çağırana
 * ait kararlar. Bu dosya yalnızca ne olduğunu DÖNDÜRÜR.
 *
 * ======================================================================
 * ZİNCİR (CLI'ın `--schedule` kipiyle birebir aynı)
 * ======================================================================
 *   1. schedule_due_sources()  → due kaynaklar için SOURCE_SYNC işi aç
 *   2. recover_orphaned_jobs() → önceki turda ölen worker'ın işlerini kurtar
 *   3. runWorkerOnce()         → claim_jobs → handler → runSource
 *
 * ======================================================================
 * TEKRARLANABİLİRLİK (idempotency) — YENİ BİR MEKANİZMA KURULMADI
 * ======================================================================
 * Aynı turun iki kez çalışması yinelenen alım ÜRETMEZ; koruma zaten üç
 * katmanda ve hepsi veritabanında:
 *
 *   • `schedule_due_sources` açık bir SOURCE_SYNC işi olan kaynağı ATLAR.
 *   • `enqueue_job` idempotency anahtarı kaynak kimliği + PLAN ZAMANI'nı
 *     içerir; aynı pencerede ikinci iş açılmaz, var olanın kimliği döner.
 *   • `claim_jobs` kira (lease) ile çalışır: bir iş aynı anda tek
 *     worker'a verilir.
 *
 * Burada dördüncü bir kilit eklemek, bu üçünün doğruluğunu gizlerdi.
 *
 * ======================================================================
 * SÜRE BÜTÇESİ — SERVERLESS İÇİN
 * ======================================================================
 * Serverless bir çağrı süre sınırıyla ÖLDÜRÜLÜR. Yarıda kesilen bir tur
 * kayıp değildir (kira dolunca iş geri gelir) ama gereksiz gecikmedir.
 *
 * `runWorkerOnce` bunun için zaten `shouldStop` taşıyor: tetiklendiğinde
 * YENİ iş alınmaz, ÇALIŞAN iş bitirilir. Bütçeyi ona bağlıyoruz --
 * yeni bir iptal mekanizması yazmıyoruz.
 *
 * ======================================================================
 * İŞ ZAMAN AŞIMI — ÖLÇÜLEN ARIZA
 * ======================================================================
 * `runWorkerOnce`'ın kendi varsayılanı 30 SANİYE ve bu çağrı onu
 * GEÇMİYORDU. Bir tam senkron ise ÖLÇÜLDÜ: 373,6 sn (ingest_runs,
 * 2026-09-12 16:30, 35.762 kalem, snapshot_complete). Yani izin verilen
 * sürenin 12,5 KATI.
 *
 * Sonuç zincirin tamamında görülebiliyor: kuyruk yolu 13 Eylül'de devreye
 * girdi, her deneme 30. saniyede `is_zaman_asimi` ile reddedildi, 5 deneme
 * sonunda iş ÖLÜ MEKTUP'a düştü (14 Eylül 21:08) ve katalog 12 Eylül'den
 * beri donmuş kaldı. `ingest_runs`'ta beş satır `running` olarak asılı
 * durdu -- reddedilen handler koşu kaydını kapatan koda hiç ulaşmadı.
 *
 * 12 Eylül'ün BAŞARILI koşuları bu yüzden aldatıcı: onlar `--source=<slug>`
 * doğrudan kipinden geçti ve o dal `runWorkerOnce`'a hiç uğramıyor, yani
 * zaman aşımı da yok.
 *
 * VARSAYILAN NEDEN BÜTÇEYE BAĞLI
 * Sabit bir uzun varsayılan, serverless çağıran için tuzak olurdu: iş
 * fonksiyonun ömrünü aşar, çağrı öldürülür ve iş kira dolana kadar asılı
 * kalır. Bu yüzden kural tek cümle: BİR SÜRE BÜTÇESİ BİLDİREN ÇAĞIRAN,
 * işin o bütçeyi aşmasına izin veremez. Bütçe yoksa (CLI / GitHub Actions)
 * ölçülen süreye rahat paylı uzun varsayılan geçerlidir.
 *
 * ======================================================================
 * GÜVENLİK
 * ======================================================================
 * Ağ erişimi YALNIZCA çağıranın verdiği `fetcher` üzerinden olur. Üretimde
 * bu `createPoliteClient`'tır ve SSRF kapısı, gövde boyutu sınırı, zaman
 * aşımı, yeniden deneme ve devre kesici oradadır. Bu dosya `fetch`
 * çağırmaz; dolayısıyla o korumaları ATLAYAMAZ.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { runWorkerOnce, type WorkerRunSummary } from '@ohaaaa/shared';

import type { Fetcher } from './pipeline.js';
import {
  createQueueRepository,
  scheduleDueSources,
  type ScheduledSource,
} from './queueRepository.js';
import { createSourceSyncHandler } from './sourceSyncHandler.js';
import { createSupabaseRepository, loadSources } from './supabaseRepository.js';
import type { IngestSummary } from './types.js';

/**
 * Süre bütçesi OLMAYAN çağıran için iş zaman aşımı: 15 dakika.
 *
 * Ölçülen tam senkron 373,6 sn. Pay yaklaşık 2,4 kat ve bilinçli: feed
 * büyüdükçe süre de büyür, tavan her büyümede yeniden ayarlanacak bir şey
 * olmamalı. Sonsuz da değil -- gerçekten takılan bir iş, kirayı 60
 * saniyede bir yenileyerek kuyruğu süresiz rehin alabilirdi.
 */
export const VARSAYILAN_IS_ZAMAN_ASIMI_MS = 15 * 60_000;

export interface ScheduledIngestOptions {
  supabase: SupabaseClient;
  /**
   * Ağ erişiminin TEK yolu. Üretimde `createPoliteClient`; testte sahte.
   * Zorunlu tutulması bilinçli: varsayılan bir `fetch` verilseydi, birinin
   * onu yanlışlıkla kullanması SSRF kapısını atlamak olurdu.
   */
  fetcher: Fetcher;
  /** Bu turda en fazla kaç iş alınacak. */
  batchSize?: number;
  /** Zamanlayıcının bir turda kuyruğa alacağı en fazla kaynak sayısı. */
  scheduleLimit?: number;
  /**
   * Bu çağrının toplam süre bütçesi (ms). Aşılınca yeni iş ALINMAZ.
   * 0 ya da verilmemişse bütçe uygulanmaz (CLI'ın varsayılanı).
   */
  budgetMs?: number;
  /**
   * TEK BİR İŞİN en uzun çalışma süresi (ms). Aşılırsa iş
   * `is_zaman_asimi` ile başarısız sayılır ve denemesi harcanır.
   *
   * Verilmezse: bütçe bildirilmişse BÜTÇEYE eşitlenir (iş, çağıranın
   * ömrünü aşamaz), yoksa `VARSAYILAN_IS_ZAMAN_ASIMI_MS`.
   */
  jobTimeoutMs?: number;
  /** Enjekte edilebilir saat -- bütçe davranışının testi için. */
  now?: () => number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface ScheduledIngestResult {
  /** Bu turda kuyruğa alınan kaynaklar. */
  scheduled: ScheduledSource[];
  /**
   * Yetim kurtarma sonucu. `null` = RPC hata verdi (tur yine de sürdü);
   * kurtarma bir iyileştirmedir, turu düşürmesi için sebep değil.
   */
  orphansRecovered: number | null;
  worker: WorkerRunSummary;
  /** Tamamlanan her alımın özeti. */
  summaries: IngestSummary[];
  /** Süre bütçesi dolduğu için yeni iş alınmayı bıraktı mı? */
  budgetExhausted: boolean;
  durationMs: number;
}

/**
 * Bir zamanlanmış alım turu çalıştırır.
 *
 * Fırlatmaz: kaynak yükleme ve iş yürütme hataları `worker.failed` ve
 * `summaries` içinde raporlanır. Yalnızca zamanlayıcı RPC'si düşerse
 * fırlatır -- o durumda tur hiç başlamamıştır ve çağıran bunu bir arıza
 * olarak görmelidir.
 */
export async function runScheduledIngest(
  options: ScheduledIngestOptions,
): Promise<ScheduledIngestResult> {
  const {
    supabase,
    fetcher,
    batchSize = 5,
    scheduleLimit = 100,
    budgetMs = 0,
    /*
     * Bütçe bildiren çağıran (serverless) için tavan BÜTÇEDİR: iş,
     * kendisini çalıştıran çağrıdan uzun yaşayamaz. Bütçesiz çağıran
     * (CLI / GitHub Actions) ölçülen süreye paylı varsayılanı alır.
     */
    jobTimeoutMs = budgetMs > 0 ? budgetMs : VARSAYILAN_IS_ZAMAN_ASIMI_MS,
    now = () => Date.now(),
    log = () => {},
  } = options;

  const basladi = now();

  // --- 1. Due kaynakları kuyruğa al ----------------------------------------
  // Hata FIRLATIR: zamanlayıcı çalışmadıysa tur anlamsızdır ve bunu
  // "0 iş bulundu" diye raporlamak, sessiz bir arıza olurdu.
  const scheduled = await scheduleDueSources(supabase, scheduleLimit);
  log('ingest.scheduled', { count: scheduled.length });

  // --- 2. Yetim işleri kurtar ----------------------------------------------
  /*
   * Önceki turda worker öldüyse işleri `calisiyor` durumunda asılı kalır ve
   * kirası dolar. Kurtarma onları tekrar alınabilir yapar.
   *
   * Hata TURU DÜŞÜRMEZ: kurtarma bir iyileştirmedir. Düşürseydi, tek bir
   * RPC arızası yüzünden sağlıklı işler de işlenmezdi.
   */
  let orphansRecovered: number | null = null;
  const { data: kurtarilan, error: kurtarmaHatasi } =
    await supabase.rpc('recover_orphaned_jobs');

  if (kurtarmaHatasi) {
    log('ingest.orphan_recovery_failed', { error: kurtarmaHatasi.message });
  } else {
    orphansRecovered = typeof kurtarilan === 'number' ? kurtarilan : 0;
    if (orphansRecovered > 0) log('ingest.orphans_recovered', { count: orphansRecovered });
  }

  // --- 3. Kuyruktaki işleri çalıştır ---------------------------------------
  const summaries: IngestSummary[] = [];
  let budgetExhausted = false;

  /*
   * ÇÖZÜLEN TAVAN LOGLANIYOR.
   *
   * Zaman aşımı sessizce yanlış olduğunda dışarıdan görünen tek şey
   * "iş başarısız" idi; hangi tavana çarptığı log'da yoktu ve arıza altı
   * gün fark edilmedi. Sayıyı turun başında yazmak, bir dahakinde
   * sorunun yerini ilk satırda gösterir.
   */
  log('ingest.worker_baslatiliyor', { jobTimeoutMs, batchSize, budgetMs });

  const worker = await runWorkerOnce({
    repository: createQueueRepository(supabase),
    batchSize,
    // Aynı kaynağa eşzamanlı istek göndermemek için tek tek işlenir.
    concurrency: 1,
    leaseRenewMs: 60_000,
    /*
     * GEÇİLMEZSE 30 SANİYE OLUYORDU. Dosya başındaki "İŞ ZAMAN AŞIMI"
     * bölümü bunun ölçülen bedelini anlatıyor; buradaki satır o bedeli
     * ödeten satırın ta kendisiydi -- eksikliğiyle.
     */
    jobTimeoutMs,
    shouldStop: () => {
      if (budgetMs <= 0) return false;
      const doldu = now() - basladi >= budgetMs;
      if (doldu && !budgetExhausted) {
        budgetExhausted = true;
        log('ingest.budget_exhausted', { budgetMs });
      }
      return doldu;
    },
    handlers: {
      SOURCE_SYNC: createSourceSyncHandler({
        loadSource: async (id) => {
          const bulunan = await loadSources(supabase, { id });
          return bulunan[0] ?? null;
        },
        repository: createSupabaseRepository(supabase),
        fetcher,
        onComplete: (summary) => summaries.push(summary),
      }),
    },
    log,
  });

  return {
    scheduled,
    orphansRecovered,
    worker,
    summaries,
    budgetExhausted,
    durationMs: now() - basladi,
  };
}
