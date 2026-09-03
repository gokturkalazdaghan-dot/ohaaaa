/**
 * Kuyruk işçisi.
 *
 * NEDEN AYRI BİR KATMAN
 * Kuyruk (SQL tarafı) işleri saklar; işçi onları ALIR ve işler. İkisini
 * ayırmak, işçinin veritabanı olmadan test edilebilmesi demek --
 * yeniden deneme, zaman aşımı ve kapanış mantığı gerçek bir Postgres'e
 * bağlanmadan sınanabiliyor.
 *
 * DAEMON DEĞİL
 * Tek turda sınırlı sayıda iş alır ve çıkar. Sürekli çalışan bir süreç,
 * çöktüğünde sessizce durur ve kimse fark etmez; cron ise her tetiklemede
 * yeniden başlar ve çıkış kodu izlenebilir. Alım hattında aynı karar
 * verilmişti (bkz. packages/ingest/src/cli.ts).
 */

export interface QueueJob {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempt: number;
  market: string | null;
  sourceId: string | null;
}

/**
 * İşçinin veritabanıyla konuştuğu tek yüzey.
 *
 * Arayüz olarak tanımlı: gerçek uygulaması `claim_jobs` / `complete_job` /
 * `fail_job` fonksiyonlarını çağırır, testler ise sahte bir uygulama verir.
 */
export interface QueueRepository {
  claim(limit: number, kind?: string): Promise<QueueJob[]>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, error: string, permanent: boolean): Promise<void>;
}

/**
 * Bir işi işleyen fonksiyon.
 *
 * `PermanentJobError` fırlatırsa iş yeniden DENENMEZ. Bu ayrım işçide
 * değil işleyicide yapılır: 404 dönen bir adresin kalıcı, 503 dönen bir
 * sunucunun geçici olduğunu ancak işin kendisi bilir.
 */
export type JobHandler = (job: QueueJob) => Promise<void>;

/** Yeniden denenmemesi gereken hata. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export interface WorkerOptions {
  repository: QueueRepository;
  handlers: Record<string, JobHandler>;
  /** Bu turda en fazla kaç iş alınacak. */
  batchSize?: number;
  /** Tek bir iş için üst süre sınırı. */
  jobTimeoutMs?: number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface WorkerRunSummary {
  claimed: number;
  completed: number;
  failed: number;
  permanentlyFailed: number;
  unhandled: number;
  durationMs: number;
}

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('is_zaman_asimi')), ms);
    p.then(
      () => {
        clearTimeout(t);
        resolve();
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Kuyruktan bir tur iş alır ve işler.
 *
 * Bir işin çökmesi turu bitirmez: kalan işler işlenmeye devam eder.
 * Aksi halde tek bir bozuk kayıt, arkasındaki tüm kuyruğu rehin alırdı.
 */
export async function runWorkerOnce(options: WorkerOptions): Promise<WorkerRunSummary> {
  const {
    repository,
    handlers,
    batchSize = 10,
    jobTimeoutMs = 30_000,
    log = () => {},
  } = options;

  const basladi = Date.now();
  const ozet: WorkerRunSummary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    permanentlyFailed: 0,
    unhandled: 0,
    durationMs: 0,
  };

  const isler = await repository.claim(batchSize);
  ozet.claimed = isler.length;

  for (const is of isler) {
    const handler = handlers[is.kind];

    if (!handler) {
      /*
       * İŞLEYİCİSİ OLMAYAN İŞ KALICI HATADIR.
       *
       * Geçici sayıp yeniden denemek, kod dağıtılana kadar aynı işi
       * geri çekilmeyle tekrar tekrar denemek olurdu -- ve kuyrukta
       * sonsuza dek dönen bir kayıt bırakırdı. Kalıcı işaretlemek onu
       * görünür kılar: ölü mektup kutusunda, sebebi yazılı olarak.
       */
      ozet.unhandled += 1;
      ozet.permanentlyFailed += 1;
      log('job_unhandled', { jobId: is.id, kind: is.kind });
      await repository.fail(is.id, `Bu tur icin isleyici yok: ${is.kind}`, true);
      continue;
    }

    try {
      await withTimeout(handler(is), jobTimeoutMs);
      await repository.complete(is.id);
      ozet.completed += 1;
      log('job_completed', { jobId: is.id, kind: is.kind, attempt: is.attempt });
    } catch (error) {
      const kalici = error instanceof PermanentJobError;
      const mesaj = error instanceof Error ? error.message : String(error);

      if (kalici) ozet.permanentlyFailed += 1;
      else ozet.failed += 1;

      log('job_failed', {
        jobId: is.id,
        kind: is.kind,
        attempt: is.attempt,
        permanent: kalici,
        error: mesaj,
      });

      await repository.fail(is.id, mesaj, kalici);
    }
  }

  ozet.durationMs = Date.now() - basladi;
  log('worker_run_completed', { ...ozet });
  return ozet;
}
