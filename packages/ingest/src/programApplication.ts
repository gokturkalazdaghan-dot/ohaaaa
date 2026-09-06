/**
 * Başvuru turu — `programs` üzerindeki programlara ağ başvurusu yapar.
 *
 * ======================================================================
 * BU DOSYA HİÇBİR AĞIN SÖZLEŞMESİNİ BİLMEZ
 * ======================================================================
 * Ne endpoint, ne kimlik doğrulama, ne alan adı. Keşif turuyla aynı
 * kalıp: hangi ağın başvuruyu DESTEKLEDİĞİNİ sorar, destekleyeni çağırır,
 * sonucu yazar. Yeni bir ağ eklemek bu dosyayı DEĞİŞTİRMEZ.
 *
 * Bugün hiçbir ağın başvuru sözleşmesi doğrulanmadı: `awin`
 * `application_submit: 'unavailable'`, `direct` `'manual_required'`.
 * Yani bu turdan ŞU AN gerçek bir başvuru ÇIKMAZ ve bu bir eksiklik
 * değil, doğru davranış -- sahte bir uç noktaya istek atmaktansa
 * "sözleşme doğrulanmadı" demek.
 *
 * ======================================================================
 * ÖNCE TALEP, SONRA İSTEK
 * ======================================================================
 * Başvuru geri alınamaz. Denetim satırı ağa istek gitmeden ÖNCE
 * yazılıyor; benzersizlik ihlali "zaten başvurulmuş" demek ve ağa ikinci
 * bir istek GİTMİYOR. Yarış da yeniden deneme de aynı kapıdan geçiyor.
 *
 * ======================================================================
 * ONAYLI PROGRAMA ASLA YENİDEN BAŞVURULMAZ
 * ======================================================================
 * Tur, APPROVED bir programı hiç ele almaz. Veritabanındaki geçiş kapısı
 * zaten APPROVED'dan geri dönüşü reddediyor ama buraya da konuyor: ağa
 * gereksiz bir başvuru göndermek, kapının reddedeceği bir güncellemeden
 * daha pahalıdır -- ağ tarafında kötüye kullanım sayılır.
 *
 * ======================================================================
 * GÜVENLİK
 * ======================================================================
 * Ağ erişimi YALNIZCA çağıranın verdiği getirici üzerinden
 * (`ProviderContext`). Bu dosya `fetch` çağırmaz; sağlayıcılar da
 * çağıramaz. Üretimde getirici `createPoliteClient`'tır: SSRF kapısı,
 * gövde sınırı, zaman aşımı, yeniden deneme ve devre kesici oradadır.
 *
 * Sır ne loga ne veritabanına gider: her mesaj `redactError`/`redact`
 * süzgecinden geçiyor ve `programs.raw` kalıbındaki gibi kimlik bilgisi
 * hiç taşınmıyor (`ProviderContext.secret` ortam değişkeni ADIYLA çalışır).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ProviderError,
  callCapability,
  getProvider,
  knownNetworks,
  type ApplicationResult,
  type ApplicationState,
  type ProviderContext,
  type ProviderFetcher,
} from '@ohaaaa/shared/providers';

import {
  createApplicationRepository,
  type ApplicationRepository,
  type AttemptErrorCategory,
  type AttemptResult,
} from './applicationRepository.js';
import { redact, redactError } from './http/redact.js';

/** Bir programın bu turdaki sonucu. */
export type ApplicationOutcomeStatus =
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'pending'
  | 'manual_required'
  | 'unavailable'
  | 'not_implemented'
  | 'duplicate'
  | 'already_approved'
  | 'rate_limited'
  | 'failed';

export interface ApplicationCandidate {
  programId: string;
  network: string;
  networkProgramId: string;
  applicationState: ApplicationState;
}

export interface ProgramApplicationOutcome {
  programId: string;
  network: string;
  networkProgramId: string;
  status: ApplicationOutcomeStatus;
  /** Ağa GERÇEKTEN istek gitti mi. */
  requestSent: boolean;
  /** Programın aldığı yeni durum; değişmediyse null. */
  newState: ApplicationState | null;
  errorCategory: AttemptErrorCategory | null;
  /** Sırlardan arındırılmış açıklama. */
  detail: string | null;
  attempts: number;
}

export interface ApplicationRunResult {
  outcomes: ProgramApplicationOutcome[];
  /** Ağa gerçekten gönderilen istek sayısı. */
  requestsSent: number;
  durationMs: number;
}

export interface ApplicationRunOptions {
  candidates: ApplicationCandidate[];
  fetcher: ProviderFetcher;
  supabase?: SupabaseClient;
  /** Testler ve alternatif depolar için; verilmezse supabase'den kurulur. */
  repository?: ApplicationRepository;
  secret?: (envVarName: string) => string | null;
  now?: () => string;
  /** Turu izlemek için; idempotency anahtarı DEĞİL. */
  correlationId?: string;
  /** Tek başvurunun zaman aşımı. */
  timeoutMs?: number;
  /** Geçici hatalarda en fazla kaç deneme (ilk deneme dâhil). */
  maxRetries?: number;
  /** İlk geri çekilme; her denemede ikiye katlanır. */
  retryBaseMs?: number;
  /** Bir turda tek ağa gönderilecek en fazla istek. */
  maxRequestsPerNetwork?: number;
  /** Aynı ağa iki istek arasındaki en az süre. */
  minDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export const DEFAULT_APPLICATION_OPTIONS = {
  timeoutMs: 20_000,
  maxRetries: 3,
  retryBaseMs: 1_000,
  /*
   * Bir turda tek ağa 10 başvurudan fazlası gönderilmiyor. Sınırsız
   * olsaydı, ilk gerçek sözleşme doğrulandığında yüzlerce keşfedilmiş
   * programa aynı anda başvurulur ve bu ağ tarafında kötüye kullanım
   * sayılırdı -- hesabın askıya alınması, kaybedilen gelirden pahalı.
   */
  maxRequestsPerNetwork: 10,
  minDelayMs: 2_000,
} as const;

/** Ağın döndürdüğü duruma karşılık gelen deneme sonucu. */
const DURUM_SONUCU: Readonly<Record<ApplicationState, AttemptResult>> = {
  DISCOVERED: 'SUBMITTED',
  ELIGIBLE: 'SUBMITTED',
  APPLICATION_READY: 'SUBMITTED',
  APPLIED: 'SUBMITTED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  MANUAL_REQUIRED: 'MANUAL_REQUIRED',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
};

const GECERLI_DURUMLAR = new Set<string>(Object.keys(DURUM_SONUCU));

/**
 * Bir başvuru turu çalıştırır.
 *
 * FIRLATMAZ: bir programın düşmesi diğerlerini durdurmaz. Tek bir ağın
 * API'si bozuk diye tüm turun iptal olması, başvurulabilecek programları
 * da kaybetmek olurdu.
 */
export async function runProgramApplications(
  options: ApplicationRunOptions,
): Promise<ApplicationRunResult> {
  const {
    candidates,
    fetcher,
    supabase,
    secret = (name) => process.env[name] ?? null,
    now = () => new Date().toISOString(),
    correlationId = null,
    timeoutMs = DEFAULT_APPLICATION_OPTIONS.timeoutMs,
    maxRetries = DEFAULT_APPLICATION_OPTIONS.maxRetries,
    retryBaseMs = DEFAULT_APPLICATION_OPTIONS.retryBaseMs,
    maxRequestsPerNetwork = DEFAULT_APPLICATION_OPTIONS.maxRequestsPerNetwork,
    minDelayMs = DEFAULT_APPLICATION_OPTIONS.minDelayMs,
    sleep = varsayilanUyku,
    log = () => {},
  } = options;

  const repository =
    options.repository ??
    (supabase
      ? createApplicationRepository(supabase)
      : (() => {
          throw new Error('runProgramApplications: supabase ya da repository verilmeli.');
        })());

  const basladi = Date.now();
  const ctx: ProviderContext = { fetch: fetcher, secret, now };

  /** Ağ başına bu turda gönderilen istek ve son istek anı. */
  const agDurumu = new Map<string, { sent: number; lastAt: number }>();
  const outcomes: ProgramApplicationOutcome[] = [];

  for (const candidate of candidates) {
    outcomes.push(
      await applyOne(candidate, {
        ctx,
        repository,
        correlationId,
        timeoutMs,
        maxRetries,
        retryBaseMs,
        maxRequestsPerNetwork,
        minDelayMs,
        sleep,
        now,
        log,
        agDurumu,
      }),
    );
  }

  const requestsSent = outcomes.filter((o) => o.requestSent).length;
  log('application.finished', { candidates: candidates.length, requestsSent });

  return { outcomes, requestsSent, durationMs: Date.now() - basladi };
}

interface TurBaglami {
  ctx: ProviderContext;
  repository: ApplicationRepository;
  correlationId: string | null;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  maxRequestsPerNetwork: number;
  minDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => string;
  log: (event: string, data: Record<string, unknown>) => void;
  agDurumu: Map<string, { sent: number; lastAt: number }>;
}

async function applyOne(
  candidate: ApplicationCandidate,
  tur: TurBaglami,
): Promise<ProgramApplicationOutcome> {
  const { network, networkProgramId, programId } = candidate;
  const taban = { programId, network, networkProgramId };

  /*
   * ONAYLI PROGRAMA HİÇ DOKUNULMAZ. Ağa gereksiz bir başvuru
   * göndermek, veritabanı kapısının reddedeceği bir güncellemeden
   * pahalıdır: ağ tarafında bu kötüye kullanımdır.
   */
  if (candidate.applicationState === 'APPROVED') {
    return {
      ...taban,
      status: 'already_approved',
      requestSent: false,
      newState: null,
      errorCategory: null,
      detail: 'Program zaten onayli; yeniden basvurulmuyor.',
      attempts: 0,
    };
  }

  // --- 1) Ağ bu işi otomatik yapabiliyor mu -------------------------------
  let submit: NonNullable<ReturnType<typeof secimSubmit>>;
  let provider: ReturnType<typeof getProvider>;

  try {
    provider = getProvider(network);
    submit = callCapability(network, 'application_submit', secimSubmit);
  } catch (error) {
    return await engelKaydet(candidate, error, tur);
  }

  // --- 2) Hız sınırı: ağ başına tur kotası --------------------------------
  const durum = tur.agDurumu.get(network) ?? { sent: 0, lastAt: 0 };

  if (durum.sent >= tur.maxRequestsPerNetwork) {
    tur.log('application.rate_limited', { network, sent: durum.sent });
    return {
      ...taban,
      status: 'rate_limited',
      requestSent: false,
      newState: null,
      errorCategory: 'RATE_LIMITED',
      detail: `Bu turda ${network} icin istek kotasi doldu (${tur.maxRequestsPerNetwork}).`,
      attempts: 0,
    };
  }

  // --- 3) ÖNCE TALEP ET ---------------------------------------------------
  const idempotencyKey = basvuruAnahtari(network, networkProgramId);

  let bizimTalep: boolean;
  try {
    bizimTalep = await tur.repository.claimAttempt({
      programId,
      network,
      networkProgramId,
      idempotencyKey,
      correlationId: tur.correlationId,
      result: 'SUBMITTED',
      errorCategory: null,
      message: null,
    });
  } catch (error) {
    const detail = redactError(error);
    tur.log('application.claim_failed', { network, networkProgramId, error: detail });
    return {
      ...taban,
      status: 'failed',
      requestSent: false,
      newState: null,
      errorCategory: 'DATABASE_ERROR',
      detail,
      attempts: 0,
    };
  }

  if (!bizimTalep) {
    /*
     * Bu anahtar zaten kullanılmış: ya eşzamanlı bir tur ya da bir
     * yeniden deneme. Ağa İSTEK GİTMİYOR ve yeni bir denetim satırı da
     * açılmıyor -- ikisi de tekrar sayılırdı.
     */
    tur.log('application.duplicate', { network, networkProgramId });
    return {
      ...taban,
      status: 'duplicate',
      requestSent: false,
      newState: null,
      errorCategory: 'DUPLICATE',
      detail: 'Bu basvuru zaten talep edilmis; aga ikinci istek gonderilmedi.',
      attempts: 0,
    };
  }

  // --- 4) Nezaket gecikmesi ------------------------------------------------
  const beklenen = durum.lastAt + tur.minDelayMs - Date.now();
  if (durum.sent > 0 && beklenen > 0) await tur.sleep(beklenen);

  // --- 5) Başvuruyu gönder, geçici hatalarda geri çekilerek yeniden dene ---
  let sonDetail: string | null = null;
  let sonKategori: AttemptErrorCategory = 'UNKNOWN_ERROR';
  let deneme = 0;

  while (deneme < tur.maxRetries) {
    deneme += 1;

    try {
      const sonuc = await zamanAsimiyla(
        () => submit.call(provider, tur.ctx, networkProgramId),
        tur.timeoutMs,
      );

      tur.agDurumu.set(network, { sent: durum.sent + 1, lastAt: Date.now() });

      const dogrulanmis = sonucuDogrula(sonuc);
      if (!dogrulanmis) {
        // Ağ tanımadığımız bir şey döndürdü. Durumu DEĞİŞTİRMİYORUZ:
        // anlaşılmayan bir yanıta göre ilerlemek, olmayan bir onayı
        // varsaymak olabilirdi.
        const detail = 'Agin basvuru yaniti sozlesmeye uymuyor; durum degistirilmedi.';
        await sonuclandir(tur, idempotencyKey, 'FAILED', null, 'MALFORMED_RESPONSE', detail);
        return {
          ...taban,
          status: 'failed',
          requestSent: true,
          newState: null,
          errorCategory: 'MALFORMED_RESPONSE',
          detail,
          attempts: deneme,
        };
      }

      return await sonucuIsle(candidate, dogrulanmis, idempotencyKey, deneme, tur);
    } catch (error) {
      const { kategori, geciciMi } = siniflandir(error);
      sonKategori = kategori;
      sonDetail = redactError(error);

      tur.agDurumu.set(network, { sent: durum.sent + 1, lastAt: Date.now() });

      if (!geciciMi || deneme >= tur.maxRetries) break;

      // Üstel geri çekilme: 1s, 2s, 4s …
      await tur.sleep(tur.retryBaseMs * 2 ** (deneme - 1));
    }
  }

  await sonuclandir(tur, idempotencyKey, 'FAILED', null, sonKategori, sonDetail);
  tur.log('application.failed', { network, networkProgramId, category: sonKategori });

  return {
    ...taban,
    status: 'failed',
    requestSent: true,
    newState: null,
    errorCategory: sonKategori,
    detail: sonDetail,
    attempts: deneme,
  };
}

/**
 * Yetenek reddini denetim izine yazar.
 *
 * ANAHTAR AYRI: `block:` öneki kullanılıyor, `apply:` değil. Aynı anahtar
 * kullanılsaydı, bugün sözleşmesi doğrulanmamış bir program için yazılan
 * satır, sözleşme YARIN doğrulandığında gerçek başvuruyu SONSUZA KADAR
 * engellerdi -- "denedik" diye. Ayrı anahtar hem bunu önlüyor hem de
 * tekrarlayan turların denetim izini şişirmesini engelliyor: aynı red
 * ikinci kez yazılamaz.
 */
async function engelKaydet(
  candidate: ApplicationCandidate,
  error: unknown,
  tur: TurBaglami,
): Promise<ProgramApplicationOutcome> {
  const { network, networkProgramId, programId } = candidate;
  const taban = { programId, network, networkProgramId };

  const { status, sonuc, kategori, durum } = engelSinifi(error);
  const detail = redactError(error);

  try {
    const yeni = await tur.repository.claimAttempt({
      programId,
      network,
      networkProgramId,
      idempotencyKey: engelAnahtari(network, networkProgramId, sonuc),
      correlationId: tur.correlationId,
      result: sonuc,
      errorCategory: kategori,
      message: detail,
    });

    // Durum yalnızca ilk kez kaydedilirken ilerletiliyor; tekrar eden
    // turlar aynı geçişi boşuna denemez.
    if (yeni && durum && candidate.applicationState !== durum) {
      await tur.repository.transition(programId, durum);
    }
  } catch (dbError) {
    tur.log('application.block_record_failed', { network, error: redactError(dbError) });
  }

  tur.log('application.blocked', { network, networkProgramId, status });

  return {
    ...taban,
    status,
    requestSent: false,
    newState: durum ?? null,
    errorCategory: kategori,
    detail,
    attempts: 0,
  };
}

/** Yetenek hatasını sayılabilir bir sonuca çevirir. */
function engelSinifi(error: unknown): {
  status: ApplicationOutcomeStatus;
  sonuc: AttemptResult;
  kategori: AttemptErrorCategory;
  durum: ApplicationState | null;
} {
  if (error instanceof ProviderError) {
    switch (error.code) {
      case 'manual_required':
        return {
          status: 'manual_required',
          sonuc: 'MANUAL_REQUIRED',
          kategori: 'MANUAL_REQUIRED',
          durum: 'MANUAL_REQUIRED',
        };
      case 'capability_unavailable':
        return {
          status: 'unavailable',
          sonuc: 'UNAVAILABLE',
          kategori: 'CAPABILITY_UNAVAILABLE',
          durum: 'UNAVAILABLE',
        };
      case 'capability_not_implemented':
        return {
          status: 'not_implemented',
          sonuc: 'NOT_IMPLEMENTED',
          kategori: 'CAPABILITY_NOT_IMPLEMENTED',
          durum: 'NOT_IMPLEMENTED',
        };
      case 'unknown_network':
        /*
         * Bilinmeyen ağ varsayılana DÜŞMEZ ve bir DURUM da almaz: o
         * programın durumunu değiştirmek, tanımadığımız bir ağ hakkında
         * bir karar vermiş gibi görünürdü.
         */
        return {
          status: 'failed',
          sonuc: 'FAILED',
          kategori: 'UNKNOWN_NETWORK',
          durum: null,
        };
      default:
        break;
    }
  }

  return { status: 'failed', sonuc: 'FAILED', kategori: 'UNKNOWN_ERROR', durum: null };
}

/** Ağın yanıtını durum geçişine ve denetim satırına çevirir. */
async function sonucuIsle(
  candidate: ApplicationCandidate,
  sonuc: ApplicationResult,
  idempotencyKey: string,
  deneme: number,
  tur: TurBaglami,
): Promise<ProgramApplicationOutcome> {
  const { network, networkProgramId, programId } = candidate;
  const taban = { programId, network, networkProgramId };
  const attemptResult = DURUM_SONUCU[sonuc.state];

  let newState: ApplicationState | null = sonuc.state;
  let detail = sonuc.message === null ? null : redact(sonuc.message);
  let kategori: AttemptErrorCategory | null = null;

  try {
    if (candidate.applicationState !== sonuc.state) {
      await tur.repository.transition(programId, sonuc.state);
    } else {
      newState = null;
    }
  } catch (error) {
    /*
     * Geçiş kapısı reddetti. Bu bir HATA DEĞİL, bir SAVUNMA: ağ "onaylı"
     * dese bile veritabanı geçersiz bir geçişe izin vermiyor. Başvuru
     * gerçekten gitti, o yüzden denetim satırı yazılıyor; durum ise
     * değişmiyor.
     */
    newState = null;
    kategori = 'DATABASE_ERROR';
    detail = redactError(error);
    tur.log('application.transition_rejected', { network, networkProgramId, error: detail });
  }

  await sonuclandir(tur, idempotencyKey, attemptResult, newState, kategori, detail);

  tur.log('application.completed', { network, networkProgramId, state: sonuc.state });

  return {
    ...taban,
    status: durumStatusu(sonuc.state),
    requestSent: true,
    newState,
    errorCategory: kategori,
    detail,
    attempts: deneme,
  };
}

async function sonuclandir(
  tur: TurBaglami,
  idempotencyKey: string,
  result: AttemptResult,
  outcomeState: ApplicationState | null,
  errorCategory: AttemptErrorCategory | null,
  message: string | null,
): Promise<void> {
  try {
    await tur.repository.completeAttempt(idempotencyKey, {
      result,
      outcomeState,
      errorCategory,
      message,
      completedAt: tur.now(),
    });
  } catch (error) {
    // Sonucu yazamamak turu düşürmez: başvuru zaten talep edilmiş ve
    // anahtar tekil, yani tekrar üretilemez.
    tur.log('application.complete_failed', { error: redactError(error) });
  }
}

function durumStatusu(state: ApplicationState): ApplicationOutcomeStatus {
  switch (state) {
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    case 'PENDING':
      return 'pending';
    case 'MANUAL_REQUIRED':
      return 'manual_required';
    case 'UNAVAILABLE':
      return 'unavailable';
    case 'NOT_IMPLEMENTED':
      return 'not_implemented';
    default:
      return 'submitted';
  }
}

/**
 * Sağlayıcının döndürdüğünü şemaya göre doğrular.
 *
 * Sağlayıcıya güvenmek, bir ağın bozuk ya da düşmanca yanıtının durum
 * makinesine girmesi demek olurdu -- en kötü hâlde olmayan bir onayı
 * varsaymak.
 */
function sonucuDogrula(value: unknown): ApplicationResult | null {
  if (typeof value !== 'object' || value === null) return null;

  const aday = value as Record<string, unknown>;

  if (typeof aday.state !== 'string' || !GECERLI_DURUMLAR.has(aday.state)) return null;
  if (aday.networkApplicationId !== null && typeof aday.networkApplicationId !== 'string') {
    return null;
  }
  if (aday.message !== null && typeof aday.message !== 'string') return null;
  if (typeof aday.checkedAt !== 'string' || !Number.isFinite(Date.parse(aday.checkedAt))) {
    return null;
  }

  return {
    state: aday.state as ApplicationState,
    networkApplicationId: (aday.networkApplicationId as string | null) ?? null,
    message: (aday.message as string | null) ?? null,
    checkedAt: aday.checkedAt,
  };
}

class ApplicationTimeoutError extends Error {
  constructor(ms: number) {
    super(`Basvuru ${ms} ms icinde yanitlanmadi.`);
    this.name = 'ApplicationTimeoutError';
  }
}

/**
 * Zaman aşımı — sağlayıcının kendi zaman aşımına GÜVENİLMİYOR.
 *
 * Getirici (`createPoliteClient`) kendi sınırını uyguluyor ama sağlayıcı
 * birden çok istek yapabilir ya da hiç yanıt vermeyen bir söz
 * döndürebilir. Bu kapı olmasaydı tek bir asılı başvuru tüm turu süresiz
 * bloke ederdi.
 */
async function zamanAsimiyla<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let zamanlayici: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        zamanlayici = setTimeout(() => reject(new ApplicationTimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (zamanlayici) clearTimeout(zamanlayici);
  }
}

/** Hatayı kategoriye ve "yeniden denenir mi"ye çevirir. */
function siniflandir(error: unknown): {
  kategori: AttemptErrorCategory;
  geciciMi: boolean;
} {
  const ad = error instanceof Error ? error.name : '';
  const durum =
    typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : null;

  if (ad === 'ApplicationTimeoutError') return { kategori: 'TIMEOUT', geciciMi: true };
  if (ad === 'RobotsDisallowedError') return { kategori: 'SECURITY_ERROR', geciciMi: false };
  if (ad === 'CircuitOpenError') return { kategori: 'NETWORK_ERROR', geciciMi: false };

  // 429 ve 503 hız sınırıdır: yeniden denenir ama geri çekilerek.
  if (durum === 429) return { kategori: 'RATE_LIMITED', geciciMi: true };
  if (durum !== null && durum >= 500) return { kategori: 'HTTP_ERROR', geciciMi: true };
  if (durum !== null && durum >= 400) return { kategori: 'HTTP_ERROR', geciciMi: false };

  if (error instanceof ProviderError) return { kategori: 'UNKNOWN_ERROR', geciciMi: false };
  if (ad === 'TypeError') return { kategori: 'NETWORK_ERROR', geciciMi: true };

  return { kategori: 'UNKNOWN_ERROR', geciciMi: true };
}

/** Başvuru NİYETİNİN kimliği. Aynı niyet her turda aynı anahtarı üretir. */
export function basvuruAnahtari(network: string, networkProgramId: string): string {
  return `apply:${network}:${networkProgramId}`;
}

/** Yetenek reddinin kimliği. `apply:` anahtarını YAKMAZ; gerekçesi yukarıda. */
export function engelAnahtari(
  network: string,
  networkProgramId: string,
  sonuc: AttemptResult,
): string {
  return `block:${network}:${networkProgramId}:${sonuc}`;
}

/** Kayıtlı ağlardan başvuruyu otomatik destekleyenler. */
export function networksSupportingApplication(): string[] {
  return knownNetworks().filter(
    (network) => getProvider(network).capabilities.application_submit === 'supported',
  );
}

function secimSubmit(provider: ReturnType<typeof getProvider>) {
  return provider.submitApplication;
}

function varsayilanUyku(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
