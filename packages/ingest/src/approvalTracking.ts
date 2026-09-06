/**
 * Onay takibi — başvurusu gönderilmiş programların ağdaki durumunu yoklar.
 *
 * ======================================================================
 * ONAY UYDURULMAZ
 * ======================================================================
 * Bir program yalnızca AĞ "onaylandı" dediğinde APPROVED olur. Yanıt
 * gelmezse, anlaşılmazsa, zaman aşarsa ya da ağın sözleşmesi
 * doğrulanmamışsa durum OLDUĞU GİBİ KALIR. "Bir süredir bekliyor, herhâlde
 * onaylanmıştır" gibi bir çıkarım YOK: olmayan bir onayı varsaymak, o
 * mağazaya trafik gönderip komisyonu hiç alamamak demektir.
 *
 * Bugün hiçbir ağın `application_status` sözleşmesi doğrulanmadı; awin
 * `unavailable`, direct `manual_required`. Yani bu tur ŞU AN ağa hiç
 * gitmiyor ve bu doğru davranış.
 *
 * ======================================================================
 * YOKLAMA BAŞVURUDAN FARKLI BİR İDEMPOTENCY İSTER
 * ======================================================================
 * Başvuru bir kez yapılır: anahtarı SONSUZA KADAR aynı ve ikinci istek
 * asla gitmez. Yoklama ise tekrarlanmak ÜZERE vardır -- aynı anahtar
 * kullanılsaydı ilk yoklamadan sonra bir daha hiç yoklanamazdı.
 *
 * Bu yüzden yoklama anahtarı bir PENCERE taşıyor (varsayılan: gün).
 * Sonuç: bir program bir pencerede en fazla bir kez yoklanır. Hem ağ
 * gereksiz yere yorulmaz hem denetim izi şişmez hem de tekrar eden
 * çağrılar ikinci bir kayıt üretmez.
 *
 * ======================================================================
 * MOTOR VERİTABANININ REDDEDECEĞİ GEÇİŞİ DENEMEZ
 * ======================================================================
 * `canTransition` ile önce kod tarafında duruluyor. Denenseydi her
 * geçersiz geçiş DATABASE_ERROR olarak kaydedilirdi ve gerçek veritabanı
 * arızalarıyla aynı kefeye girerdi -- asıl arıza görünmez olurdu.
 * Veritabanı kapısı yine SON kapı olarak duruyor.
 *
 * ======================================================================
 * GÜVENLİK
 * ======================================================================
 * Ağ erişimi YALNIZCA `ProviderContext.fetch` üzerinden. Bu dosya `fetch`
 * çağırmaz. Zaman aşımı, yeniden deneme, geri çekilme, tur kotası ve sır
 * maskeleme başvuru motorundakiyle aynı.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ProviderError,
  canTransition,
  callCapability,
  getProvider,
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

export type ApprovalOutcomeStatus =
  | 'approved'
  | 'rejected'
  | 'pending'
  | 'unchanged'
  | 'manual_required'
  | 'unavailable'
  | 'not_implemented'
  | 'duplicate'
  | 'transition_blocked'
  | 'rate_limited'
  | 'failed';

export interface ApprovalCandidate {
  programId: string;
  network: string;
  networkProgramId: string;
  applicationState: ApplicationState;
}

export interface ApprovalOutcome {
  programId: string;
  network: string;
  networkProgramId: string;
  status: ApprovalOutcomeStatus;
  requestSent: boolean;
  previousState: ApplicationState;
  /** Durum değiştiyse yeni durum; değişmediyse null. */
  newState: ApplicationState | null;
  networkApplicationId: string | null;
  errorCategory: AttemptErrorCategory | null;
  detail: string | null;
  attempts: number;
}

export interface ApprovalRunResult {
  outcomes: ApprovalOutcome[];
  requestsSent: number;
  approved: number;
  durationMs: number;
}

export interface ApprovalRunOptions {
  candidates: ApprovalCandidate[];
  fetcher: ProviderFetcher;
  supabase?: SupabaseClient;
  repository?: ApplicationRepository;
  secret?: (envVarName: string) => string | null;
  now?: () => string;
  /**
   * Yoklama penceresi. Aynı pencerede aynı program bir kez yoklanır.
   * Verilmezse `now()`un gün kısmı kullanılır.
   */
  pollWindow?: string;
  correlationId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  maxRequestsPerNetwork?: number;
  minDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export const DEFAULT_APPROVAL_OPTIONS = {
  timeoutMs: 20_000,
  maxRetries: 3,
  retryBaseMs: 1_000,
  maxRequestsPerNetwork: 50,
  minDelayMs: 2_000,
} as const;

/**
 * Yoklanmaya DEĞER durumlar.
 *
 * APPROVED de yoklanıyor: ağ onayı geri alabilir ve bunu öğrenmenin tek
 * yolu sormaktır. Geri alınmış bir onayla trafik göndermeye devam etmek,
 * komisyonu hiç alınmayacak tıklamalar üretir. Geçiş kapısı APPROVED'dan
 * yalnızca REJECTED'a izin verdiği için bu yoklama onayı YANLIŞLIKLA da
 * geri çekemez.
 */
const YOKLANABILIR: ReadonlySet<ApplicationState> = new Set<ApplicationState>([
  'APPLIED',
  'PENDING',
  'APPROVED',
  'MANUAL_REQUIRED',
]);

const DURUM_SONUCU: Readonly<Record<ApplicationState, AttemptResult>> = {
  DISCOVERED: 'PENDING',
  ELIGIBLE: 'PENDING',
  APPLICATION_READY: 'PENDING',
  APPLIED: 'SUBMITTED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  MANUAL_REQUIRED: 'MANUAL_REQUIRED',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
};

const GECERLI_DURUMLAR = new Set<string>(Object.keys(DURUM_SONUCU));

/** Yoklama denemesinin kimliği. PENCERE taşır; gerekçesi dosya başında. */
export function yoklamaAnahtari(
  network: string,
  networkProgramId: string,
  pencere: string,
): string {
  return `status:${network}:${networkProgramId}:${pencere}`;
}

/** Yetenek reddinin kimliği. Yoklamayla aynı pencerede tekrar yazılmaz. */
export function yoklamaEngelAnahtari(
  network: string,
  networkProgramId: string,
  sonuc: AttemptResult,
  pencere: string,
): string {
  return `status-block:${network}:${networkProgramId}:${sonuc}:${pencere}`;
}

/**
 * Bir onay takip turu çalıştırır.
 *
 * FIRLATMAZ: bir programın düşmesi diğerlerini durdurmaz.
 */
export async function runApprovalTracking(
  options: ApprovalRunOptions,
): Promise<ApprovalRunResult> {
  const {
    candidates,
    fetcher,
    supabase,
    secret = (name) => process.env[name] ?? null,
    now = () => new Date().toISOString(),
    correlationId = null,
    timeoutMs = DEFAULT_APPROVAL_OPTIONS.timeoutMs,
    maxRetries = DEFAULT_APPROVAL_OPTIONS.maxRetries,
    retryBaseMs = DEFAULT_APPROVAL_OPTIONS.retryBaseMs,
    maxRequestsPerNetwork = DEFAULT_APPROVAL_OPTIONS.maxRequestsPerNetwork,
    minDelayMs = DEFAULT_APPROVAL_OPTIONS.minDelayMs,
    sleep = varsayilanUyku,
    log = () => {},
  } = options;

  const repository =
    options.repository ??
    (supabase
      ? createApplicationRepository(supabase)
      : (() => {
          throw new Error('runApprovalTracking: supabase ya da repository verilmeli.');
        })());

  const basladi = Date.now();
  const pencere = options.pollWindow ?? now().slice(0, 10);
  const ctx: ProviderContext = { fetch: fetcher, secret, now };
  const agDurumu = new Map<string, { sent: number; lastAt: number }>();
  const outcomes: ApprovalOutcome[] = [];

  for (const candidate of candidates) {
    outcomes.push(
      await trackOne(candidate, {
        ctx,
        repository,
        pencere,
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
  const approved = outcomes.filter((o) => o.newState === 'APPROVED').length;

  log('approval.finished', { candidates: candidates.length, requestsSent, approved });

  return { outcomes, requestsSent, approved, durationMs: Date.now() - basladi };
}

interface TurBaglami {
  ctx: ProviderContext;
  repository: ApplicationRepository;
  pencere: string;
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

async function trackOne(
  candidate: ApprovalCandidate,
  tur: TurBaglami,
): Promise<ApprovalOutcome> {
  const { network, networkProgramId, programId, applicationState } = candidate;
  const taban = {
    programId,
    network,
    networkProgramId,
    previousState: applicationState,
    networkApplicationId: null as string | null,
  };

  // --- 0) Yoklanmaya değmeyen durumlar -----------------------------------
  // REJECTED, DISCOVERED ve benzerleri için ağda sorulacak bir başvuru yok.
  if (!YOKLANABILIR.has(applicationState)) {
    return {
      ...taban,
      status: 'unchanged',
      requestSent: false,
      newState: null,
      errorCategory: null,
      detail: `${applicationState} durumunda yoklanacak bir basvuru yok.`,
      attempts: 0,
    };
  }

  // --- 1) Ağ durum sorgusunu destekliyor mu ------------------------------
  let statusFn: NonNullable<ReturnType<typeof secimStatus>>;
  let provider: ReturnType<typeof getProvider>;

  try {
    provider = getProvider(network);
    statusFn = callCapability(network, 'application_status', secimStatus);
  } catch (error) {
    return await engelKaydet(candidate, error, tur);
  }

  // --- 2) Tur kotası ------------------------------------------------------
  const durum = tur.agDurumu.get(network) ?? { sent: 0, lastAt: 0 };

  if (durum.sent >= tur.maxRequestsPerNetwork) {
    tur.log('approval.rate_limited', { network, sent: durum.sent });
    return {
      ...taban,
      status: 'rate_limited',
      requestSent: false,
      newState: null,
      errorCategory: 'RATE_LIMITED',
      detail: `Bu turda ${network} icin yoklama kotasi doldu (${tur.maxRequestsPerNetwork}).`,
      attempts: 0,
    };
  }

  // --- 3) Pencere başına tek yoklama --------------------------------------
  const anahtar = yoklamaAnahtari(network, networkProgramId, tur.pencere);

  let bizimTalep: boolean;
  try {
    bizimTalep = await tur.repository.claimAttempt({
      programId,
      network,
      networkProgramId,
      idempotencyKey: anahtar,
      correlationId: tur.correlationId,
      result: 'SUBMITTED',
      errorCategory: null,
      message: null,
    });
  } catch (error) {
    const detail = redactError(error);
    tur.log('approval.claim_failed', { network, networkProgramId, error: detail });
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
    tur.log('approval.duplicate', { network, networkProgramId, window: tur.pencere });
    return {
      ...taban,
      status: 'duplicate',
      requestSent: false,
      newState: null,
      errorCategory: 'DUPLICATE',
      detail: `Bu program ${tur.pencere} penceresinde zaten yoklandi.`,
      attempts: 0,
    };
  }

  // --- 4) Nezaket gecikmesi ------------------------------------------------
  const beklenen = durum.lastAt + tur.minDelayMs - Date.now();
  if (durum.sent > 0 && beklenen > 0) await tur.sleep(beklenen);

  // --- 5) Yokla ------------------------------------------------------------
  let sonDetail: string | null = null;
  let sonKategori: AttemptErrorCategory = 'UNKNOWN_ERROR';
  let deneme = 0;

  while (deneme < tur.maxRetries) {
    deneme += 1;

    try {
      const ham = await zamanAsimiyla(
        () => statusFn.call(provider, tur.ctx, networkProgramId),
        tur.timeoutMs,
      );

      tur.agDurumu.set(network, { sent: durum.sent + 1, lastAt: Date.now() });

      const sonuc = sonucuDogrula(ham);
      if (!sonuc) {
        const detail = 'Agin durum yaniti sozlesmeye uymuyor; durum degistirilmedi.';
        await sonuclandir(tur, anahtar, 'FAILED', null, 'MALFORMED_RESPONSE', detail);
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

      return await sonucuIsle(candidate, sonuc, anahtar, deneme, tur);
    } catch (error) {
      const { kategori, geciciMi } = siniflandir(error);
      sonKategori = kategori;
      sonDetail = redactError(error);

      tur.agDurumu.set(network, { sent: durum.sent + 1, lastAt: Date.now() });

      if (!geciciMi || deneme >= tur.maxRetries) break;
      await tur.sleep(tur.retryBaseMs * 2 ** (deneme - 1));
    }
  }

  await sonuclandir(tur, anahtar, 'FAILED', null, sonKategori, sonDetail);
  tur.log('approval.failed', { network, networkProgramId, category: sonKategori });

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

/** Ağın yanıtını durum geçişine çevirir — ONAY UYDURMADAN. */
async function sonucuIsle(
  candidate: ApprovalCandidate,
  sonuc: ApplicationResult,
  anahtar: string,
  deneme: number,
  tur: TurBaglami,
): Promise<ApprovalOutcome> {
  const { network, networkProgramId, programId, applicationState } = candidate;
  const taban = {
    programId,
    network,
    networkProgramId,
    previousState: applicationState,
    networkApplicationId: sonuc.networkApplicationId,
  };

  const detail = sonuc.message === null ? null : redact(sonuc.message);

  // --- Durum değişmedi: ağ hâlâ aynı şeyi söylüyor ------------------------
  if (sonuc.state === applicationState) {
    await sonuclandir(tur, anahtar, DURUM_SONUCU[sonuc.state], null, null, detail);
    return {
      ...taban,
      status: 'unchanged',
      requestSent: true,
      newState: null,
      errorCategory: null,
      detail,
      attempts: deneme,
    };
  }

  /*
   * VERİTABANININ REDDEDECEĞİ GEÇİŞ DENENMEZ.
   *
   * Ağ, onaylı bir program için "PENDING" diyebilir (kendi panelinde bir
   * gecikme, bir önbellek). O yanıta uyup onayı geri çekmek, çalışan gelir
   * hattını ağın bir tutarsızlığı yüzünden koparmak olurdu. Kapı burada
   * kapanıyor ve durum OLDUĞU GİBİ kalıyor.
   */
  if (!canTransition(applicationState, sonuc.state)) {
    const engelDetail =
      `Ag "${sonuc.state}" dedi ama ${applicationState} -> ${sonuc.state} gecisi ` +
      'yasak; durum degistirilmedi.';

    await sonuclandir(tur, anahtar, 'FAILED', null, 'MALFORMED_RESPONSE', engelDetail);
    tur.log('approval.transition_blocked', {
      network,
      networkProgramId,
      from: applicationState,
      to: sonuc.state,
    });

    return {
      ...taban,
      status: 'transition_blocked',
      requestSent: true,
      newState: null,
      errorCategory: 'MALFORMED_RESPONSE',
      detail: engelDetail,
      attempts: deneme,
    };
  }

  let newState: ApplicationState | null = sonuc.state;
  let kategori: AttemptErrorCategory | null = null;
  let sonDetail = detail;

  try {
    await tur.repository.transition(programId, sonuc.state);
  } catch (error) {
    // Son kapı yine de reddetti: kod tablosu ile veritabanı ayrışmış
    // olabilir. Durum değişmiyor ve bu ayrışma denetim izine yazılıyor.
    newState = null;
    kategori = 'DATABASE_ERROR';
    sonDetail = redactError(error);
    tur.log('approval.transition_rejected', { network, networkProgramId, error: sonDetail });
  }

  await sonuclandir(tur, anahtar, DURUM_SONUCU[sonuc.state], newState, kategori, sonDetail);
  tur.log('approval.changed', {
    network,
    networkProgramId,
    from: applicationState,
    to: sonuc.state,
  });

  return {
    ...taban,
    status: durumStatusu(sonuc.state),
    requestSent: true,
    newState,
    errorCategory: kategori,
    detail: sonDetail,
    attempts: deneme,
  };
}

/** Yetenek reddini pencere başına bir kez denetim izine yazar. */
async function engelKaydet(
  candidate: ApprovalCandidate,
  error: unknown,
  tur: TurBaglami,
): Promise<ApprovalOutcome> {
  const { network, networkProgramId, programId, applicationState } = candidate;
  const taban = {
    programId,
    network,
    networkProgramId,
    previousState: applicationState,
    networkApplicationId: null as string | null,
  };

  const { status, sonuc, kategori } = engelSinifi(error);
  const detail = redactError(error);

  try {
    await tur.repository.claimAttempt({
      programId,
      network,
      networkProgramId,
      idempotencyKey: yoklamaEngelAnahtari(network, networkProgramId, sonuc, tur.pencere),
      correlationId: tur.correlationId,
      result: sonuc,
      errorCategory: kategori,
      message: detail,
    });
  } catch (dbError) {
    tur.log('approval.block_record_failed', { network, error: redactError(dbError) });
  }

  /*
   * YOKLAMA DURUM DEĞİŞTİRMEZ.
   *
   * Başvuru turu, sözleşmesi doğrulanmamış bir programı UNAVAILABLE'a
   * çeker -- orada bu bir ilerlemedir. Burada değil: başvurusu gönderilmiş
   * bir programı "durumunu soramadık" diye UNAVAILABLE yapmak, gerçekten
   * beklemede olan bir başvuruyu kaybetmek olurdu.
   */
  tur.log('approval.blocked', { network, networkProgramId, status });

  return {
    ...taban,
    status,
    requestSent: false,
    newState: null,
    errorCategory: kategori,
    detail,
    attempts: 0,
  };
}

function engelSinifi(error: unknown): {
  status: ApprovalOutcomeStatus;
  sonuc: AttemptResult;
  kategori: AttemptErrorCategory;
} {
  if (error instanceof ProviderError) {
    switch (error.code) {
      case 'manual_required':
        return {
          status: 'manual_required',
          sonuc: 'MANUAL_REQUIRED',
          kategori: 'MANUAL_REQUIRED',
        };
      case 'capability_unavailable':
        return {
          status: 'unavailable',
          sonuc: 'UNAVAILABLE',
          kategori: 'CAPABILITY_UNAVAILABLE',
        };
      case 'capability_not_implemented':
        return {
          status: 'not_implemented',
          sonuc: 'NOT_IMPLEMENTED',
          kategori: 'CAPABILITY_NOT_IMPLEMENTED',
        };
      case 'unknown_network':
        return { status: 'failed', sonuc: 'FAILED', kategori: 'UNKNOWN_NETWORK' };
      default:
        break;
    }
  }

  return { status: 'failed', sonuc: 'FAILED', kategori: 'UNKNOWN_ERROR' };
}

async function sonuclandir(
  tur: TurBaglami,
  anahtar: string,
  result: AttemptResult,
  outcomeState: ApplicationState | null,
  errorCategory: AttemptErrorCategory | null,
  message: string | null,
): Promise<void> {
  try {
    await tur.repository.completeAttempt(anahtar, {
      result,
      outcomeState,
      errorCategory,
      message,
      completedAt: tur.now(),
    });
  } catch (error) {
    tur.log('approval.complete_failed', { error: redactError(error) });
  }
}

function durumStatusu(state: ApplicationState): ApprovalOutcomeStatus {
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
      return 'unchanged';
  }
}

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

class ApprovalTimeoutError extends Error {
  constructor(ms: number) {
    super(`Onay yoklamasi ${ms} ms icinde yanitlanmadi.`);
    this.name = 'ApprovalTimeoutError';
  }
}

async function zamanAsimiyla<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let zamanlayici: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        zamanlayici = setTimeout(() => reject(new ApprovalTimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (zamanlayici) clearTimeout(zamanlayici);
  }
}

function siniflandir(error: unknown): { kategori: AttemptErrorCategory; geciciMi: boolean } {
  const ad = error instanceof Error ? error.name : '';
  const durum =
    typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : null;

  if (ad === 'ApprovalTimeoutError') return { kategori: 'TIMEOUT', geciciMi: true };
  if (ad === 'RobotsDisallowedError') return { kategori: 'SECURITY_ERROR', geciciMi: false };
  if (ad === 'CircuitOpenError') return { kategori: 'NETWORK_ERROR', geciciMi: false };

  if (durum === 429) return { kategori: 'RATE_LIMITED', geciciMi: true };
  if (durum !== null && durum >= 500) return { kategori: 'HTTP_ERROR', geciciMi: true };
  if (durum !== null && durum >= 400) return { kategori: 'HTTP_ERROR', geciciMi: false };

  if (error instanceof ProviderError) return { kategori: 'UNKNOWN_ERROR', geciciMi: false };
  if (ad === 'TypeError') return { kategori: 'NETWORK_ERROR', geciciMi: true };

  return { kategori: 'UNKNOWN_ERROR', geciciMi: true };
}

function secimStatus(provider: ReturnType<typeof getProvider>) {
  return provider.applicationStatus;
}

function varsayilanUyku(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
