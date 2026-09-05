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
import { IngestError } from '../errors.js';
import {
  ResponseTooLargeError,
  TooManyRedirectsError,
  assertFetchable,
  type HostResolver,
} from './guard.js';

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
  /**
   * Bir istekte izlenecek en fazla yönlendirme.
   *
   * Sonsuz döngü ya da yüzlerce adımlık bir zincir, her adımda DNS + kapı
   * denetimi çalıştırdığı için ucuz bir kaynak tüketim saldırısıdır.
   */
  maxRedirects?: number;
  /**
   * Gövde için en fazla bayt.
   *
   * Gövde belleğe alınıyor (`string`); sınırsız bırakmak, tek bir dev
   * feed'in işçiyi düşürmesi demektir. Sınır, gövdenin TAMAMI indirilmeden
   * uygulanır -- aşıldığı anda akış iptal edilir.
   */
  maxBodyBytes?: number;
  fetchImpl?: typeof fetch;
  /** Ad çözücü. Testler gerçek DNS'e çıkmasın diye dışarıdan verilir. */
  resolveHost?: HostResolver;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_OPTIONS = {
  minDelayMs: 2000,
  timeoutMs: 20_000,
  maxRetries: 3,
  circuitBreakerThreshold: 5,
  maxRedirects: 5,
  // 64 MiB. Ürün feed'leri büyüktür ama bu sınırı aşan bir feed'in
  // belleğe alınması zaten güvenli değil; kaynak başına ayarlanabilir
  // hale getirmek ilk gerçek feed bağlandığında değerlendirilir.
  maxBodyBytes: 64 * 1024 * 1024,
} as const satisfies Omit<PoliteClientOptions, 'userAgent'>;

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
  /*
   * Yeni sınırlar isteğe bağlı: mevcut çağıranlar (cli.ts, testler) hiçbir
   * değişiklik yapmadan çalışmaya devam eder ve varsayılanı alır. `??` ile
   * ayrıca çözülüyor çünkü yayılım (spread), açıkça `undefined` verilmiş
   * bir alanı varsayılanın ÜZERİNE yazardı.
   */
  const config = {
    ...DEFAULT_OPTIONS,
    ...options,
    maxRedirects: options.maxRedirects ?? DEFAULT_OPTIONS.maxRedirects,
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_OPTIONS.maxBodyBytes,
  };
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
   * KAPILI GETİRME — her istek ve HER YÖNLENDİRME ADIMI için adres denetimi.
   *
   * Önceki hâl `redirect: 'follow'` kullanıyordu. Bu, denetimi yalnızca İLK
   * adrese uygulamak demekti: güvenli görünen bir alan adı 302 ile
   * `http://169.254.169.254/...` adresine yollayabilir ve `fetch` oraya
   * sessizce giderdi. Yani kapı olsa bile atlanabilirdi.
   *
   * Artık yönlendirmeler ELLE izleniyor ve her adımda `assertFetchable`
   * yeniden çalışıyor. Zincirin uzunluğu sınırlı: sonsuz döngü, her adımda
   * DNS çözümü yaptıran ucuz bir tüketim saldırısıdır.
   *
   * Zaman aşımı TEK BİR BÜTÇE olarak taşınıyor. Önceden `withTimeout`
   * yalnızca `fetch` sözünü sarıyordu; `fetch` başlıklar gelir gelmez
   * çözülür, yani GÖVDE OKUMASI süresizdi. Yavaş damlatan bir sunucu
   * işçiyi süresiz tutabilirdi. Bütçe artık başlıkları da gövdeyi de kapsar
   * ve `AbortController` ile soket gerçekten kapanır.
   */
  async function guardedFetch(
    startUrl: string,
    init: RequestInit,
    kalanMs: () => number,
    signal: AbortSignal,
  ): Promise<{ response: Response; finalUrl: string }> {
    let current = startUrl;

    for (let hop = 0; hop <= config.maxRedirects; hop += 1) {
      await assertFetchable(current, { resolveHost: config.resolveHost });

      const response = await withTimeout(
        doFetch(current, { ...init, redirect: 'manual', signal }),
        kalanMs(),
      );

      if (!YONLENDIRME_KODLARI.has(response.status)) {
        return { response, finalUrl: current };
      }

      const konum = response.headers.get('location');
      // Yönlendirme kodu ama adres yok: izlenecek bir hedef yok, yanıt
      // olduğu gibi döner. Uydurma bir hedef üretmek yanlış olurdu.
      if (!konum) return { response, finalUrl: current };

      current = new URL(konum, current).toString();
    }

    throw new TooManyRedirectsError(startUrl, config.maxRedirects);
  }

  /**
   * robots.txt'yi alır ve önbelleğe koyar (alan adı başına bir kez).
   * Sonucu DÖNDÜRÜR: çağıran taraf mutasyona güvenip daraltma (narrowing)
   * yapamaz, çünkü ara `await`'ler durumu değiştirmiş olabilir.
   */
  async function loadRobots(origin: string, host: string): Promise<RobotsTxt | false> {
    const state = stateFor(host);
    if (state.robots !== null) return state.robots;

    const bitis = now() + config.timeoutMs;
    const kalan = () => Math.max(0, bitis - now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      /*
       * robots.txt de kapıdan geçer. Aynı kaynağa gittiği için ilk adres
       * zaten denetlenmiş olur; asıl kazanç YÖNLENDİRMEDE: robots.txt bir
       * özel adrese yönlendirilerek kapı atlatılabilirdi.
       */
      const { response } = await guardedFetch(
        `${origin}/robots.txt`,
        { headers: { 'user-agent': config.userAgent, accept: 'text/plain' } },
        kalan,
        controller.signal,
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

      const parsed = parseRobotsTxt(
        await readBodyLimited(response, ROBOTS_MAX_BYTES, `${origin}/robots.txt`),
      );
      state.robots = parsed;

      const delaySeconds = crawlDelayFor(parsed, config.userAgent);
      if (delaySeconds !== null) {
        state.robotsDelayMs = Math.round(delaySeconds * 1000);
      }

      return parsed;
    } catch {
      state.robots = false;
      return false;
    } finally {
      clearTimeout(timer);
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

  async function get(
    targetUrl: string,
    options: { headers?: Record<string, string> } = {},
  ): Promise<FetchResult> {
    const url = new URL(targetUrl);
    const host = url.host;
    const state = stateFor(host);

    if (state.consecutiveFailures >= config.circuitBreakerThreshold) {
      throw new CircuitOpenError(host);
    }

    /*
     * ADRES DENETİMİ ROBOTS'TAN ÖNCE.
     *
     * Sıra bir ayrıntı değil, TEŞHİS meselesi. Denetim yalnızca
     * `guardedFetch` içinde kalsaydı iç ağa bakan bir adres önce robots.txt
     * isteğinde takılır, `loadRobots` hatayı yutar ve operatöre
     * "robots.txt erişimi yasaklıyor" denirdi -- gerçek sebep ise adresin
     * özel bir ağı göstermesi. Yanlış teşhis, saatlerce yanlış yerde
     * aranan bir hata demektir.
     *
     * Ayrıca ucuz: yasak bir adres için robots.txt isteği hiç gitmez.
     */
    await assertFetchable(targetUrl, { resolveHost: config.resolveHost });

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

      const bitis = now() + config.timeoutMs;
      const kalan = () => Math.max(0, bitis - now());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      try {
        const { response, finalUrl } = await guardedFetch(
          targetUrl,
          {
            /*
             * Çağıranın başlıkları SONA konuyor ama user-agent'ı ezemez:
             * kimliğimizi gizlemek robots uyumunu anlamsız kılardı ve bu
             * projede bot kimliği pazarlık konusu değil.
             */
            headers: {
              accept: 'text/csv, application/xml, application/json;q=0.9, */*;q=0.5',
              'accept-encoding': 'gzip, deflate',
              ...(options.headers ?? {}),
              'user-agent': config.userAgent,
            },
          },
          kalan,
          controller.signal,
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

        /*
         * GÖVDE SINIRLI OKUNUR. Önceki `await response.text()` ne kadar
         * geleceğine bakmadan hepsini belleğe alıyordu; 10 GB'lık bir yanıt
         * işçiyi düşürürdü ve bunun için saldırı bile gerekmezdi -- yanlış
         * yapılandırılmış tek bir feed yeterdi.
         */
        const body = await withTimeout(
          readBodyLimited(response, config.maxBodyBytes, finalUrl),
          kalan(),
        );

        state.consecutiveFailures = 0;

        return {
          url: finalUrl,
          status: response.status,
          body,
          contentType: response.headers.get('content-type'),
        };
      } catch (error) {
        /*
         * Bu hatalar döngüden ÇIKAR: tekrarlamak sonucu değiştirmez.
         *
         * Güvenlik hataları özellikle önemli: bir SSRF denemesini ya da
         * sınırı aşan bir gövdeyi yeniden denemek yalnızca kayıtları
         * kirletir. `IngestError` üzerinden gelen `permanent` bayrağı
         * kuyruğa da aynı şeyi söyler.
         */
        if (error instanceof RobotsDisallowedError) throw error;
        if (error instanceof PermanentHttpError) throw error;
        if (error instanceof IngestError && error.permanent) {
          state.consecutiveFailures += 1;
          throw error;
        }

        lastError = error;
        state.nextAllowedAt = now() + backoffMs(attempt, config.minDelayMs);
      } finally {
        clearTimeout(timer);
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

/**
 * Yönlendirme sayılan durum kodları.
 *
 * 303 için yöntem GET'e döner; bu istemci zaten yalnızca GET yaptığı için
 * ek bir davranış gerekmiyor.
 */
const YONLENDIRME_KODLARI = new Set([301, 302, 303, 307, 308]);

/**
 * robots.txt için ayrı ve çok daha küçük sınır.
 *
 * robots.txt bir metin dosyasıdır; megabaytlarcası ancak saldırı ya da
 * arıza olur. Feed sınırını buraya uygulamak, 64 MiB'lık bir "robots.txt"i
 * kabul etmek anlamına gelirdi.
 */
const ROBOTS_MAX_BYTES = 512 * 1024;

/**
 * Gövdeyi SINIRA KADAR okur; sınır aşılırsa akışı iptal edip fırlatır.
 *
 * İki katmanlı: önce beyan edilen `content-length`, sonra GERÇEKTEN gelen
 * bayt. İkincisi şart, çünkü `content-length` yalan olabilir ya da hiç
 * gönderilmeyebilir (chunked). Yalnızca başlığa güvenen bir denetim,
 * başlığı atlayan bir sunucu karşısında hiçbir şey yapmaz.
 *
 * Sınır aşıldığında geri kalan İNDİRİLMEZ: `reader.cancel()` bağlantıyı
 * kapatır. "Hepsini al, sonra boyuna bak" yaklaşımı, korumanın kendisini
 * saldırının aracına çevirirdi.
 */
async function readBodyLimited(
  response: Response,
  maxBytes: number,
  url: string,
): Promise<string> {
  const beyan = response.headers.get('content-length');
  if (beyan !== null) {
    const bildirilen = Number(beyan);
    // ERKEN ÇIKIŞ: sunucu zaten "şu kadar göndereceğim" diyorsa, tek bayt
    // indirmeden reddedilir.
    if (Number.isFinite(bildirilen) && bildirilen > maxBytes) {
      throw new ResponseTooLargeError(url, maxBytes);
    }
  }

  const stream = response.body;
  if (!stream) return '';

  const reader = stream.getReader();
  const parcalar: Uint8Array[] = [];
  let toplam = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    toplam += value.byteLength;

    if (toplam > maxBytes) {
      // Gerisini indirme; soket kapansın.
      await reader.cancel().catch(() => {});
      throw new ResponseTooLargeError(url, maxBytes);
    }

    parcalar.push(value);
  }

  const birlesik = new Uint8Array(toplam);
  let ofset = 0;
  for (const parca of parcalar) {
    birlesik.set(parca, ofset);
    ofset += parca.byteLength;
  }

  return new TextDecoder('utf-8').decode(birlesik);
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
