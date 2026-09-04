/**
 * Nazik (polite) HTTP istemcisi.
 *
 * Bu istemci hız kazanmak için değil, KALICI OLMAK için tasarlanmıştır.
 * Bir veri kaynağını kaybetmenin maliyeti, onu yavaş taramanın maliyetinden
 * kat kat yüksektir.
 *
 * Uygulananlar:
 *   • Kimliğini açıkça bildiren User-Agent (iletişim adresi dahil)
 *   • robots.txt zorunlu — atlatma seçeneği yok
 *   • Alan adı başına en az bekleme süresi (robots crawl-delay ile büyütülür)
 *   • 429/503'te Retry-After'a uyan üstel geri çekilme
 *   • Ardışık hatalarda devre kesici (circuit breaker)
 *
 * Neden `undici`/`axios` değil de yerleşik fetch? Node 18+ fetch yeterli;
 * ek bağımlılık, tek kişilik bir operasyonda bakım yüzeyi demektir.
 */

import { crawlDelayFor, isAllowed, parseRobotsTxt, type RobotsTxt } from './robots.js';
import { maskUrl } from './redact.js';

export interface PoliteClientOptions {
  /**
   * Kendimizi tanıttığımız dize. İletişim adresi İÇERMELİDİR: site sahibi
   * bir sorun görürse bizi engellemek yerine ulaşabilmelidir. Anonim ya da
   * tarayıcı taklidi yapan bir UA, tam olarak kaçındığımız şeydir.
   */
  userAgent: string;
  /** Alan adı başına iki istek arasındaki en az süre. */
  minDelayMs: number;
  /** Tek isteğin zaman aşımı. */
  timeoutMs: number;
  /** Geçici hatalarda en fazla kaç deneme. */
  maxRetries: number;
  /** Bu kadar ardışık hatadan sonra alan adı bu çalışma için bırakılır. */
  circuitBreakerThreshold: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_OPTIONS: Omit<PoliteClientOptions, 'userAgent'> = {
  minDelayMs: 2000,
  timeoutMs: 20_000,
  maxRetries: 3,
  circuitBreakerThreshold: 5,
};

export class RobotsDisallowedError extends Error {
  /*
   * ADRES MASKELENEREK MESAJA GİRER.
   *
   * Bu mesaj `summary.error` üzerinden veritabanına (`ingest_runs.error`,
   * `sources.last_error`) ve CI günlüğüne yazılıyor. Feed adresi jetonu
   * sorgu dizisinde taşıdığında, maskesiz mesaj jetonu üç ayrı yere
   * kopyalardı. `url` alanı ham kalır -- çağıran gerekirse kullanır ama
   * mesaj artık taşımaz.
   */
  constructor(readonly url: string, reason?: string) {
    super(
      `robots.txt bu adrese erişimi yasaklıyor: ${maskUrl(url)}` +
        (reason ? ` (${reason})` : ''),
    );
    this.name = 'RobotsDisallowedError';
  }
}

/**
 * Yeniden denemenin sonucu değiştirmeyeceği hata (404, 403, 410…).
 *
 * Ayrı bir sınıf olması ŞART: aksi halde döngü içindeki genel `catch` bu
 * hatayı geçici sanıp isteği tekrarlar ve sunucuyu boşuna yorar.
 */
export class PermanentHttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`HTTP ${status} — ${maskUrl(url)}`);
    this.name = 'PermanentHttpError';
  }
}

export class CircuitOpenError extends Error {
  constructor(readonly host: string) {
    super(`${host} için çok fazla ardışık hata; bu çalışmada atlanıyor`);
    this.name = 'CircuitOpenError';
  }
}

interface HostState {
  nextAllowedAt: number;
  consecutiveFailures: number;
  /** null = henüz alınmadı, false = alınamadı (yasak sayılır) */
  robots: RobotsTxt | null | false;
  robotsDelayMs: number;
}

export interface FetchResult {
  url: string;
  status: number;
  body: string;
  contentType: string | null;
}

export function createPoliteClient(options: PoliteClientOptions) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const doFetch = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const sleep =
    config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const hosts = new Map<string, HostState>();

  function stateFor(host: string): HostState {
    let state = hosts.get(host);
    if (!state) {
      state = {
        nextAllowedAt: 0,
        consecutiveFailures: 0,
        robots: null,
        robotsDelayMs: 0,
      };
      hosts.set(host, state);
    }
    return state;
  }

  /**
   * robots.txt'yi alır ve önbelleğe koyar (alan adı başına bir kez).
   * Sonucu DÖNDÜRÜR: çağıran taraf mutasyona güvenip daraltma (narrowing)
   * yapamaz, çünkü ara `await`'ler durumu değiştirmiş olabilir.
   */
  async function loadRobots(origin: string, host: string): Promise<RobotsTxt | false> {
    const state = stateFor(host);
    if (state.robots !== null) return state.robots;

    try {
      const response = await withTimeout(
        doFetch(`${origin}/robots.txt`, {
          headers: { 'user-agent': config.userAgent, accept: 'text/plain' },
          redirect: 'follow',
        }),
        config.timeoutMs,
      );

      if (response.status === 404 || response.status === 410) {
        // Dosya yoksa kısıt da yoktur.
        state.robots = { groups: [], sitemaps: [] };
        return state.robots;
      }

      if (!response.ok) {
        // 5xx: sunucunun ne istediğini bilmiyoruz → yasak varsay.
        state.robots = false;
        return false;
      }

      const parsed = parseRobotsTxt(await response.text());
      state.robots = parsed;

      const delaySeconds = crawlDelayFor(parsed, config.userAgent);
      if (delaySeconds !== null) {
        state.robotsDelayMs = Math.round(delaySeconds * 1000);
      }

      return parsed;
    } catch {
      state.robots = false;
      return false;
    }
  }

  /** Alan adı için sıradaki isteğin zamanını bekler. */
  async function waitForSlot(host: string): Promise<void> {
    const state = stateFor(host);

    // Site daha yavaş istiyorsa site kazanır; biz daha yavaşsak biz kalırız.
    const delay = Math.max(config.minDelayMs, state.robotsDelayMs);

    const waitMs = state.nextAllowedAt - now();
    if (waitMs > 0) await sleep(waitMs);

    state.nextAllowedAt = now() + delay;
  }

  async function get(targetUrl: string): Promise<FetchResult> {
    const url = new URL(targetUrl);
    const host = url.host;
    const state = stateFor(host);

    if (state.consecutiveFailures >= config.circuitBreakerThreshold) {
      throw new CircuitOpenError(host);
    }

    const robots = await loadRobots(url.origin, host);

    if (robots === false) {
      /*
       * Açıklama AYRI parametre olarak veriliyor. Önceden adres ve
       * açıklama tek dizgide birleştirilip kurucuya veriliyordu; maskeleme
       * eklendiğinde bu dizgi geçerli bir adres olmadığı için ya tamamen
       * maskelenir ya da açıklama sorgu dizisine karışırdı.
       */
      throw new RobotsDisallowedError(
        targetUrl,
        'robots.txt alınamadı; güvenli varsayım: yasak',
      );
    }

    if (!isAllowed(robots, config.userAgent, url.pathname + url.search)) {
      throw new RobotsDisallowedError(targetUrl);
    }

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      await waitForSlot(host);

      try {
        const response = await withTimeout(
          doFetch(targetUrl, {
            headers: {
              'user-agent': config.userAgent,
              accept: 'text/csv, application/xml, application/json;q=0.9, */*;q=0.5',
              'accept-encoding': 'gzip, deflate',
            },
            redirect: 'follow',
          }),
          config.timeoutMs,
        );

        // 429 / 503: sunucu açıkça "yavaşla" diyor. Retry-After'a uyulur.
        if (response.status === 429 || response.status === 503) {
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
          const backoff = retryAfter ?? backoffMs(attempt, config.minDelayMs);

          state.nextAllowedAt = now() + backoff;
          lastError = new Error(`HTTP ${response.status} (yeniden deneme ${attempt + 1})`);
          continue;
        }

        if (response.status >= 500) {
          state.nextAllowedAt = now() + backoffMs(attempt, config.minDelayMs);
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }

        if (!response.ok) {
          // 4xx (429 hariç) kalıcıdır; yeniden denemek yükü artırır, sonucu değiştirmez.
          state.consecutiveFailures += 1;
          throw new PermanentHttpError(response.status, targetUrl);
        }

        state.consecutiveFailures = 0;

        return {
          url: response.url || targetUrl,
          status: response.status,
          body: await response.text(),
          contentType: response.headers.get('content-type'),
        };
      } catch (error) {
        // Bu iki hata döngüden ÇIKAR: tekrarlamak sonucu değiştirmez.
        if (error instanceof RobotsDisallowedError) throw error;
        if (error instanceof PermanentHttpError) throw error;

        lastError = error;
        state.nextAllowedAt = now() + backoffMs(attempt, config.minDelayMs);
      }
    }

    state.consecutiveFailures += 1;
    throw lastError instanceof Error
      ? lastError
      : new Error(`İstek başarısız: ${maskUrl(targetUrl)}`);
  }

  return {
    get,
    /** Test ve teşhis için alan adı durumu. */
    inspect: (host: string) => hosts.get(host),
  };
}

/** Üstel geri çekilme + jitter. Jitter, eşzamanlı denemelerin çakışmasını önler. */
function backoffMs(attempt: number, base: number): number {
  const exponential = base * 2 ** attempt;
  const jitter = Math.random() * base * 0.5;
  return Math.min(exponential + jitter, 60_000);
}

/** Retry-After hem saniye hem HTTP tarihi olabilir. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 300_000);
  }

  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(0, date - Date.now()), 300_000);
  }

  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Zaman aşımı (${ms} ms)`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
