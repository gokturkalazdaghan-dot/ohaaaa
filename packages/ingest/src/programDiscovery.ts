/**
 * Program keşif turu — ağ kataloglarını tarar, `programs`'a yazar.
 *
 * ======================================================================
 * BU DOSYA HİÇBİR AĞIN SÖZLEŞMESİNİ BİLMEZ
 * ======================================================================
 * Ne endpoint, ne kimlik doğrulama, ne alan adı. Hepsi sağlayıcıda.
 * Buradaki iş: hangi ağların keşfi DESTEKLEDİĞİNİ sormak, destekleyenleri
 * çağırmak, sonucu yazmak ve ne olduğunu raporlamak.
 *
 * Böylece yeni bir ağ eklemek bu dosyayı DEĞİŞTİRMEZ.
 *
 * ======================================================================
 * DESTEKLEMEYEN AĞ BİR HATA DEĞİL
 * ======================================================================
 * Bugün hiçbir ağın keşif sözleşmesi doğrulanmadı; `callCapability` hepsi
 * için fırlatıyor. Tur bunu ÇÖKEREK değil, SAYARAK raporluyor:
 *
 *   manual_required            -> operatöre iş düşer
 *   capability_unavailable     -> ağın sözleşmesi doğrulanmalı
 *   capability_not_implemented -> bizim hatamız
 *
 * Üçü ayrı sayılıyor çünkü üçünün aksiyonu farklı. Tek bir "atlandı"
 * sayacı, "bakmadık" ile "bakamayız"ı aynı kefeye koyar ve kimse geri
 * dönüp bakmaz.
 *
 * ======================================================================
 * GÜVENLİK
 * ======================================================================
 * Ağ erişimi YALNIZCA çağıranın verdiği getirici üzerinden. Üretimde bu
 * `createPoliteClient`'tır: SSRF kapısı, gövde boyutu sınırı, zaman aşımı,
 * yeniden deneme, nezaket gecikmesi ve devre kesici oradadır. Bu dosya
 * `fetch` çağırmaz ve sağlayıcılar da çağıramaz (`ProviderContext`).
 *
 * Bir sağlayıcının döndürdüğü `homepage_url` gibi alanlar DIŞ VERİDİR ve
 * burada FETCH EDİLMEZ; yalnızca kaydedilir. Onları çekmek gerektiğinde
 * (feed onboarding) aynı korumalı getirici kullanılır.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ProviderError,
  callCapability,
  getProvider,
  knownNetworks,
  type DiscoveryPage,
  type NormalizedProgram,
  type ProviderContext,
  type ProviderFetcher,
} from '@ohaaaa/shared/providers';

import {
  createDiscoveryRepository,
  type DiscoveryErrorCategory,
  type DiscoveryRepository,
  type DiscoveryRunStatus,
} from './discoveryRepository.js';
import { batches } from './incrementalSync.js';
import { createProgramRepository } from './programRepository.js';
import { redact, redactError } from './http/redact.js';

/** Bir ağın bu turdaki sonucu. */
export interface NetworkDiscoveryOutcome {
  network: string;
  status:
    | 'discovered'
    | 'partial'
    | 'duplicate'
    | 'manual_required'
    | 'unavailable'
    | 'not_implemented'
    | 'failed';
  programCount: number;
  firstSeenCount: number;
  /** Şemaya uymadığı için ELENEN satırlar. Sessiz kayıp YASAK. */
  malformedDropped: number;
  pagesFetched: number;
  /** Turun bittiği imleç. null = katalogun sonu. */
  cursorEnd: string | null;
  errorCategory: DiscoveryErrorCategory | null;
  /** Ağdan/koddan gelen açıklama; hata yoksa null. */
  detail: string | null;
}

export interface DiscoveryRunResult {
  outcomes: NetworkDiscoveryOutcome[];
  totalPrograms: number;
  totalFirstSeen: number;
  totalMalformedDropped: number;
  durationMs: number;
}

export interface DiscoveryOptions {
  supabase?: SupabaseClient;
  /** Ağa erişimin tek yolu — üretimde createPoliteClient. */
  fetcher: ProviderFetcher;
  /** Yalnızca bu ağlar; verilmezse kayıtlı tüm ağlar. */
  networks?: string[];
  /** Ortam değişkeni ADIYLA sır çözer; değeri koda girmez. */
  secret?: (envVarName: string) => string | null;
  now?: () => string;
  log?: (event: string, data: Record<string, unknown>) => void;

  // --- ÖLÇEK ---------------------------------------------------------------
  /** Testler ve alternatif depolar için; verilmezse supabase'den kurulur. */
  discoveryRepository?: DiscoveryRepository;
  /** Ağ başına başlangıç imleci. Verilmezse baştan başlanır. */
  cursors?: Record<string, string | null>;
  /** Turu izlemek için; idempotency anahtarı DEĞİL. */
  correlationId?: string;
  /** Bir turda tek ağdan en fazla kaç sayfa. */
  maxPagesPerNetwork?: number;
  /** Tek sayfa isteğinin zaman aşımı. */
  timeoutMs?: number;
  /** Geçici hatalarda en fazla kaç deneme (ilk deneme dâhil). */
  maxRetries?: number;
  /** İlk geri çekilme; her denemede ikiye katlanır. */
  retryBaseMs?: number;
  /** Aynı ağa iki sayfa isteği arasındaki en az süre. */
  minDelayMs?: number;
  /** Tek yazma partisindeki en fazla program. */
  writeBatchSize?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_DISCOVERY_OPTIONS = {
  maxPagesPerNetwork: 50,
  timeoutMs: 30_000,
  maxRetries: 3,
  retryBaseMs: 1_000,
  minDelayMs: 2_000,
  /*
   * Tek partide 500 program. Sınırsız olsaydı milyonlarca programlı bir ağın
   * ilk sayfası tek bir dev INSERT'e dönerdi: işlem uzun sürer, kilit
   * tutar ve düştüğünde HİÇBİR ŞEY yazılmamış olur.
   */
  writeBatchSize: 500,
} as const;

/**
 * Bir keşif turu çalıştırır.
 *
 * FIRLATMAZ: bir ağın düşmesi diğerlerini durdurmaz. Tek bir ağın API'si
 * bozuk diye tüm turun iptal olması, çalışan ağların da keşfini
 * kaybetmek olurdu. Her ağ kendi `outcome`'unu alır.
 *
 * ÖLÇEK: her ağ SAYFA SAYFA taranıyor, yazma PARTİLERE bölünüyor, imleç
 * her başarılı sayfadan sonra saklanıyor ve tur bir denetim satırı
 * bırakıyor. Bunlar olmadan milyonlarca programlı bir ağ tek turda ne
 * taranabilir ne de yarıda kaldığında sürdürülebilir.
 */
export async function runProgramDiscovery(
  options: DiscoveryOptions,
): Promise<DiscoveryRunResult> {
  const {
    supabase,
    fetcher,
    networks = knownNetworks(),
    secret = (name) => process.env[name] ?? null,
    now = () => new Date().toISOString(),
    log = () => {},
    cursors = {},
    correlationId = null,
    maxPagesPerNetwork = DEFAULT_DISCOVERY_OPTIONS.maxPagesPerNetwork,
    timeoutMs = DEFAULT_DISCOVERY_OPTIONS.timeoutMs,
    maxRetries = DEFAULT_DISCOVERY_OPTIONS.maxRetries,
    retryBaseMs = DEFAULT_DISCOVERY_OPTIONS.retryBaseMs,
    minDelayMs = DEFAULT_DISCOVERY_OPTIONS.minDelayMs,
    writeBatchSize = DEFAULT_DISCOVERY_OPTIONS.writeBatchSize,
    sleep = varsayilanUyku,
  } = options;

  const basladi = Date.now();
  const repository = supabase ? createProgramRepository(supabase) : null;
  const discoveryRepo =
    options.discoveryRepository ?? (supabase ? createDiscoveryRepository(supabase) : null);

  const ctx: ProviderContext = { fetch: fetcher, secret, now };
  const outcomes: NetworkDiscoveryOutcome[] = [];

  for (const network of networks) {
    outcomes.push(
      await discoverOne(network, {
        ctx,
        repository,
        discoveryRepo,
        cursorStart: cursors[network] ?? null,
        correlationId,
        maxPagesPerNetwork,
        timeoutMs,
        maxRetries,
        retryBaseMs,
        minDelayMs,
        writeBatchSize,
        sleep,
        now,
        log,
      }),
    );
  }

  const totalPrograms = outcomes.reduce((s, o) => s + o.programCount, 0);
  const totalFirstSeen = outcomes.reduce((s, o) => s + o.firstSeenCount, 0);
  const totalMalformedDropped = outcomes.reduce((s, o) => s + o.malformedDropped, 0);

  log('discovery.finished', {
    networks: networks.length,
    totalPrograms,
    totalFirstSeen,
    totalMalformedDropped,
  });

  return {
    outcomes,
    totalPrograms,
    totalFirstSeen,
    totalMalformedDropped,
    durationMs: Date.now() - basladi,
  };
}

interface TurBaglami {
  ctx: ProviderContext;
  repository: ReturnType<typeof createProgramRepository> | null;
  discoveryRepo: DiscoveryRepository | null;
  cursorStart: string | null;
  correlationId: string | null;
  maxPagesPerNetwork: number;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  minDelayMs: number;
  writeBatchSize: number;
  sleep: (ms: number) => Promise<void>;
  now: () => string;
  log: (event: string, data: Record<string, unknown>) => void;
}

/** Keşif turunun kimliği. Ağ + başlangıç imleci: aynı niyet aynı anahtar. */
export function kesifAnahtari(
  network: string,
  cursor: string | null,
  pencere: string,
): string {
  return `discover:${network}:${cursor ?? 'bas'}:${pencere}`;
}

async function discoverOne(
  network: string,
  tur: TurBaglami,
): Promise<NetworkDiscoveryOutcome> {
  const bos = {
    network,
    programCount: 0,
    firstSeenCount: 0,
    malformedDropped: 0,
    pagesFetched: 0,
    cursorEnd: null as string | null,
  };

  // --- 1) Ağ keşfi destekliyor mu ----------------------------------------
  let provider: ReturnType<typeof getProvider>;
  let sayfaCek: (cursor: string | null) => Promise<DiscoveryPage>;

  try {
    provider = getProvider(network);

    /*
     * `callCapability` ile çağrılıyor, `provider.discoverPrograms?.()` ile
     * DEĞİL. Optional chaining, beyanı `unavailable` olan bir yeteneği
     * sessizce `undefined` döndürerek atlar ve tur bunu "0 program" sanar --
     * yani bir BOŞLUK, geçerli bir sonuç gibi görünür.
     *
     * Sayfalı uygulama TERCİH EDİLİR: tek dizi milyonlarca programda
     * belleğe sığmaz. Yoksa tek seferlik olan sayfalı arayüze sarılıyor,
     * böylece turun geri kalanı iki durumu ayırt etmek zorunda kalmıyor.
     */
    const secilen = callCapability(
      network,
      'program_discovery',
      (p) => p.discoverProgramsPage ?? p.discoverPrograms,
    );

    sayfaCek = provider.discoverProgramsPage
      ? (cursor) => (secilen as NonNullable<typeof provider.discoverProgramsPage>).call(provider, tur.ctx, cursor)
      : async () => ({
          programs: await (secilen as NonNullable<typeof provider.discoverPrograms>).call(
            provider,
            tur.ctx,
          ),
          nextCursor: null,
        });
  } catch (error) {
    return await engelKaydet(network, error, tur, bos);
  }

  // --- 2) Turu TALEP ET: iki zamanlayıcı aynı anda tetiklenirse ikincisi
  //        ağa TEK BİR İSTEK bile göndermez.
  const anahtar = kesifAnahtari(network, tur.cursorStart, tur.now().slice(0, 13));

  if (tur.discoveryRepo) {
    let bizim: boolean;
    try {
      bizim = await tur.discoveryRepo.claimRun({
        network,
        idempotencyKey: anahtar,
        correlationId: tur.correlationId,
        cursorStart: tur.cursorStart,
      });
    } catch (error) {
      const detail = redactError(error);
      tur.log('discovery.claim_failed', { network, error: detail });
      return { ...bos, status: 'failed', errorCategory: 'DATABASE_ERROR', detail };
    }

    if (!bizim) {
      tur.log('discovery.duplicate', { network, key: anahtar });
      return {
        ...bos,
        status: 'duplicate',
        errorCategory: null,
        detail: 'Bu kesif turu zaten calisiyor ya da calisti; aga istek gonderilmedi.',
      };
    }
  }

  // --- 3) Sayfa sayfa tara -------------------------------------------------
  let cursor = tur.cursorStart;
  let sayfa = 0;
  let gorulen = 0;
  let yazilan = 0;
  let ilkKez = 0;
  let atilan = 0;
  let sonHata: { kategori: DiscoveryErrorCategory; detail: string } | null = null;
  let sonaUlasti = false;

  while (sayfa < tur.maxPagesPerNetwork) {
    if (sayfa > 0 && tur.minDelayMs > 0) await tur.sleep(tur.minDelayMs);

    let sonuc: DiscoveryPage | null = null;
    let deneme = 0;

    while (deneme < tur.maxRetries) {
      deneme += 1;
      try {
        sonuc = dogrulaSayfa(await zamanAsimiyla(() => sayfaCek(cursor), tur.timeoutMs));
        if (sonuc === null) {
          sonHata = {
            kategori: 'MALFORMED_RESPONSE',
            detail: 'Agin kesif yaniti sozlesmeye uymuyor; sayfa islenmedi.',
          };
        }
        break;
      } catch (error) {
        const { kategori, geciciMi } = siniflandir(error);
        sonHata = { kategori, detail: redactError(error) };
        if (!geciciMi || deneme >= tur.maxRetries) break;
        await tur.sleep(tur.retryBaseMs * 2 ** (deneme - 1));
      }
    }

    if (sonuc === null) break;

    sayfa += 1;
    sonHata = null;
    gorulen += sonuc.programs.length;

    /*
     * Ağ bağımsız doğrulama: sağlayıcı ne döndürürse döndürsün, şemaya
     * uymayan satır YAZILMAZ. Sağlayıcıya güvenmek, bir ağın bozuk
     * yanıtının tabloya girmesi demek olurdu. Elenen SAYILIYOR: sessiz
     * kayıp yasak.
     */
    const gecerli = sonuc.programs.filter((p: NormalizedProgram) => isWellFormed(p, network));
    atilan += sonuc.programs.length - gecerli.length;

    if (gecerli.length < sonuc.programs.length) {
      tur.log('discovery.malformed_dropped', {
        network,
        dropped: sonuc.programs.length - gecerli.length,
      });
    }

    if (tur.repository && gecerli.length > 0) {
      try {
        // PARTİLERE bölünüyor: tek dev INSERT uzun sürer, kilit tutar ve
        // düştüğünde HİÇBİR ŞEY yazılmamış olur.
        for (const parti of batches(gecerli, tur.writeBatchSize)) {
          const y = await tur.repository.upsertDiscovered(parti);
          yazilan += y.written;
          ilkKez += y.firstSeen.length;
        }
      } catch (error) {
        sonHata = { kategori: 'DATABASE_ERROR', detail: redactError(error) };
        break;
      }
    }

    /*
     * İMLEÇ YALNIZCA SAYFA BAŞARIYLA YAZILDIKTAN SONRA İLERLİYOR. Önce
     * ilerletilseydi, yazma düştüğünde o sayfa sonsuza kadar atlanırdı.
     */
    cursor = sonuc.nextCursor;

    if (tur.discoveryRepo) {
      try {
        await tur.discoveryRepo.saveCursor(network, cursor, tur.now());
      } catch (error) {
        tur.log('discovery.cursor_save_failed', { network, error: redactError(error) });
      }
    }

    if (cursor === null) {
      sonaUlasti = true;
      break;
    }
  }

  // --- 4) Sonucu yaz -------------------------------------------------------
  const status: NetworkDiscoveryOutcome['status'] = sonHata
    ? 'failed'
    : sonaUlasti
      ? 'discovered'
      : 'partial';

  const outcome: NetworkDiscoveryOutcome = {
    network,
    status,
    programCount: yazilan,
    firstSeenCount: ilkKez,
    malformedDropped: atilan,
    pagesFetched: sayfa,
    cursorEnd: cursor,
    errorCategory: sonHata?.kategori ?? null,
    detail: sonHata?.detail ?? (atilan > 0 ? `${atilan} bozuk kayit atlandi` : null),
  };

  await turuKapat(tur, anahtar, outcome, gorulen);

  tur.log('discovery.network_done', {
    network,
    status,
    programs: yazilan,
    firstSeen: ilkKez,
    pages: sayfa,
  });

  return outcome;
}

/** Yetenek reddini denetim izine yazar ve sayılabilir bir sonuca çevirir. */
async function engelKaydet(
  network: string,
  error: unknown,
  tur: TurBaglami,
  bos: Omit<NetworkDiscoveryOutcome, 'status' | 'errorCategory' | 'detail'>,
): Promise<NetworkDiscoveryOutcome> {
  const { status, kategori, runStatus } = engelSinifi(error);
  const detail = redactError(error);

  /*
   * `reason` ile `status` ayrı ayrı loglanıyor: birincisi sağlayıcı
   * katmanının verdiği ham kod, ikincisi turun raporladığı sonuç. İkisini
   * tek alana indirmek, bir gün eşleşmelerinin bozulduğunu görünmez
   * kılardı.
   */
  tur.log('discovery.skipped', {
    network,
    status,
    reason: error instanceof ProviderError ? error.code : 'unknown',
  });

  const outcome: NetworkDiscoveryOutcome = { ...bos, status, errorCategory: kategori, detail };

  if (tur.discoveryRepo) {
    const anahtar = kesifAnahtari(network, tur.cursorStart, tur.now().slice(0, 13));
    try {
      const bizim = await tur.discoveryRepo.claimRun({
        network,
        idempotencyKey: anahtar,
        correlationId: tur.correlationId,
        cursorStart: tur.cursorStart,
      });
      if (bizim) {
        await tur.discoveryRepo.completeRun(anahtar, {
          status: runStatus,
          cursorEnd: tur.cursorStart,
          pagesFetched: 0,
          programsSeen: 0,
          programsWritten: 0,
          firstSeenCount: 0,
          malformedDropped: 0,
          errorCategory: kategori,
          message: detail,
          finishedAt: tur.now(),
        });
      }
    } catch (dbError) {
      tur.log('discovery.block_record_failed', { network, error: redactError(dbError) });
    }
  }

  return outcome;
}

async function turuKapat(
  tur: TurBaglami,
  anahtar: string,
  outcome: NetworkDiscoveryOutcome,
  gorulen: number,
): Promise<void> {
  if (!tur.discoveryRepo) return;

  try {
    await tur.discoveryRepo.completeRun(anahtar, {
      status: outcome.status === 'discovered' ? 'completed' : (outcome.status as DiscoveryRunStatus),
      cursorEnd: outcome.cursorEnd,
      pagesFetched: outcome.pagesFetched,
      programsSeen: gorulen,
      programsWritten: outcome.programCount,
      firstSeenCount: outcome.firstSeenCount,
      malformedDropped: outcome.malformedDropped,
      errorCategory: outcome.errorCategory,
      message: outcome.detail === null ? null : redact(outcome.detail),
      finishedAt: tur.now(),
    });
  } catch (error) {
    // Sonucu yazamamak turu düşürmez: tur zaten talep edilmiş ve anahtar
    // tekil, yani tekrar üretilemez.
    tur.log('discovery.complete_failed', { error: redactError(error) });
  }
}

/** Sağlayıcının döndürdüğü sayfayı şemaya göre doğrular. */
function dogrulaSayfa(value: unknown): DiscoveryPage | null {
  if (typeof value !== 'object' || value === null) return null;

  const aday = value as Record<string, unknown>;
  if (!Array.isArray(aday.programs)) return null;
  if (aday.nextCursor !== null && typeof aday.nextCursor !== 'string') return null;

  return {
    programs: aday.programs as NormalizedProgram[],
    nextCursor: (aday.nextCursor as string | null) ?? null,
  };
}

class DiscoveryTimeoutError extends Error {
  constructor(ms: number) {
    super(`Kesif sayfasi ${ms} ms icinde yanitlanmadi.`);
    this.name = 'DiscoveryTimeoutError';
  }
}

async function zamanAsimiyla<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let zamanlayici: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        zamanlayici = setTimeout(() => reject(new DiscoveryTimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (zamanlayici) clearTimeout(zamanlayici);
  }
}

function siniflandir(error: unknown): {
  kategori: DiscoveryErrorCategory;
  geciciMi: boolean;
} {
  const ad = error instanceof Error ? error.name : '';
  const durum =
    typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : null;

  if (ad === 'DiscoveryTimeoutError') return { kategori: 'TIMEOUT', geciciMi: true };
  if (ad === 'RobotsDisallowedError') return { kategori: 'SECURITY_ERROR', geciciMi: false };
  if (ad === 'CircuitOpenError') return { kategori: 'NETWORK_ERROR', geciciMi: false };

  if (durum === 429) return { kategori: 'RATE_LIMITED', geciciMi: true };
  if (durum !== null && durum >= 500) return { kategori: 'HTTP_ERROR', geciciMi: true };
  if (durum !== null && durum >= 400) return { kategori: 'HTTP_ERROR', geciciMi: false };

  if (error instanceof ProviderError) return { kategori: 'UNKNOWN_ERROR', geciciMi: false };
  if (ad === 'TypeError') return { kategori: 'NETWORK_ERROR', geciciMi: true };

  return { kategori: 'UNKNOWN_ERROR', geciciMi: true };
}

function varsayilanUyku(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Yetenek hatasını sayılabilir bir sonuca çevirir. */
function engelSinifi(error: unknown): {
  status: NetworkDiscoveryOutcome['status'];
  kategori: DiscoveryErrorCategory;
  runStatus: DiscoveryRunStatus;
} {
  if (error instanceof ProviderError) {
    switch (error.code) {
      case 'manual_required':
        return {
          status: 'manual_required',
          kategori: 'MANUAL_REQUIRED',
          runStatus: 'manual_required',
        };
      case 'capability_unavailable':
        return {
          status: 'unavailable',
          kategori: 'CAPABILITY_UNAVAILABLE',
          runStatus: 'unavailable',
        };
      case 'capability_not_implemented':
        return {
          status: 'not_implemented',
          kategori: 'CAPABILITY_NOT_IMPLEMENTED',
          runStatus: 'not_implemented',
        };
      case 'unknown_network':
        return { status: 'failed', kategori: 'UNKNOWN_NETWORK', runStatus: 'failed' };
      default:
        break;
    }
  }

  return { status: 'failed', kategori: 'UNKNOWN_ERROR', runStatus: 'failed' };
}

/**
 * Şemanın reddedeceği kaydı ÖNCEDEN eler.
 *
 * Veritabanı zaten reddederdi ama tek bir bozuk satır TÜM toplu yazmayı
 * düşürürdü ve o ağın geçerli programları da kaybolurdu. Burada elemek,
 * bozuk olanı atıp geri kalanı kurtarıyor.
 */
function isWellFormed(program: NormalizedProgram, network: string): boolean {
  return (
    program.network === network &&
    typeof program.networkProgramId === 'string' &&
    program.networkProgramId.trim().length > 0 &&
    typeof program.merchantName === 'string' &&
    program.merchantName.trim().length > 0 &&
    typeof program.lastVerifiedAt === 'string' &&
    program.lastVerifiedAt.length > 0 &&
    (program.commissionRate === null ||
      (Number.isFinite(program.commissionRate) &&
        program.commissionRate >= 0 &&
        program.commissionRate <= 0.9)) &&
    (program.cookieWindowDays === null || program.cookieWindowDays > 0) &&
    (program.productCount === null || program.productCount >= 0)
  );
}
