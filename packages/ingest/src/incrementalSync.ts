/**
 * Artımlı senkronizasyon planlayıcısı — saf, belirlenimci, ağdan bağımsız.
 *
 * ======================================================================
 * NEDEN TAM TARAMA ÖLÇEKLENMİYOR
 * ======================================================================
 * Bugün her tur feed'in tamamını indirip her satırı yazıyor. Tek kaynakta
 * makul; yüz milyon ürüne giden bir katalogda değil:
 *
 *   • 50 milyon satırı 6 saatte bir baştan işlemek, değişmeyen %99'u boşuna
 *     yazmaktır -- her boşuna yazma bir `updated_at` tazeler, bir indeks
 *     satırı çürütür, bir replikasyon baytı üretir.
 *   • Tur bir kez düşerse baştan başlar. Yeterince büyük bir feed'de
 *     "baştan" hiç bitmez: tur, bir sonraki tur başlamadan tamamlanamaz.
 *
 * ======================================================================
 * ÜÇ MEKANİZMA, BİRBİRİNİN YEDEĞİ DEĞİL
 * ======================================================================
 *   conditional   Sunucu 304 diyebiliyorsa tek bayt inmez. En ucuzu.
 *   watermark     Feed "şu tarihten sonra değişenler"i destekliyorsa delta.
 *   cursor        Sayfalı API'de kalınan yer. Tur düşerse kaldığı yerden.
 *
 * Hiçbiri yoksa davranış BUGÜNKÜYLE AYNI: tam tarama. Bu modül bir
 * zorunluluk getirmiyor, bir imkân açıyor.
 *
 * ======================================================================
 * SU İŞARETİ TUR BİTMEDEN İLERLEMEZ
 * ======================================================================
 * En kritik kural. Yarıda kalmış bir turda su işaretini ilerletmek,
 * işlenmemiş satırları SONSUZA KADAR atlamak demektir: bir sonraki tur
 * onların "değişmediğini" sanır. Bu sessizdir -- katalogda eksik kalan
 * ürünler hiçbir hata üretmez.
 *
 * ======================================================================
 * SİLİNENLER YALNIZ TAM TARAMADA GÖRÜLÜR
 * ======================================================================
 * Artımlı bir feed yalnız DEĞİŞENLERİ verir; kaldırılan ürünü hiç
 * göndermez. Yalnız artımlı koşulursa katalog, mağazada artık satılmayan
 * ürünlerle sonsuza kadar dolu kalır. Bu yüzden planlayıcı, tam taramanın
 * üzerinden `fullSyncIntervalHours` geçtiyse artımlı kipi olsa bile TAM
 * tarama istiyor.
 */

/** `public.sync_mode` ile birebir. */
export type SyncMode = 'full' | 'incremental';

/** Bu turda ne yapılacağı. */
export type SyncStrategy =
  | 'full'          // baştan sona tara
  | 'incremental'   // yalnız değişenler
  | 'conditional'   // önce 304 sor; değişmediyse hiç indirme
  | 'resume';       // yarıda kalmış turu kaldığı yerden sürdür

export interface SyncState {
  syncMode: SyncMode;
  /** Sayfalı API'de kalınan yer. Opak: ayrıştırılmaz. */
  syncCursor: string | null;
  syncWatermark: string | null;
  httpEtag: string | null;
  httpLastModified: string | null;
  batchSize: number;
  lastFullSyncAt: string | null;
}

export interface SyncPlanOptions {
  now: Date;
  /** Bu süreden sonra artımlı kipte bile tam tarama istenir. */
  fullSyncIntervalHours?: number;
  /** Tek turda en fazla kaç sayfa — asılı bir tur işçiyi süresiz tutmasın. */
  maxPagesPerRun?: number;
}

export interface SyncPlan {
  strategy: SyncStrategy;
  /** Sunucuya gönderilecek koşullu istek başlıkları. */
  conditionalHeaders: Record<string, string>;
  /** Kaldığı yer; `resume` dışında null. */
  resumeCursor: string | null;
  /** Artımlı sorgunun alt sınırı; yalnız `incremental`de dolu. */
  since: string | null;
  batchSize: number;
  maxPages: number;
  /** Neden bu strateji seçildi — günlüğe ve panele. */
  reason: string;
}

export const SYNC_DEFAULTS = {
  fullSyncIntervalHours: 24,
  maxPagesPerRun: 1000,
  batchSize: 1000,
} as const;

export class SyncPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncPlanError';
  }
}

/**
 * Bu turda ne yapılacağına karar verir.
 *
 * SAF: I/O yok, `Date.now()` yok. "Şimdi" çağıran tarafından verilir;
 * aynı durum her zaman aynı planı üretir ve testler bunu kilitler.
 */
export function planSync(state: SyncState, options: SyncPlanOptions): SyncPlan {
  const {
    now,
    fullSyncIntervalHours = SYNC_DEFAULTS.fullSyncIntervalHours,
    maxPagesPerRun = SYNC_DEFAULTS.maxPagesPerRun,
  } = options;

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new SyncPlanError('Gecerli bir "now" verilmeli.');
  }
  if (!Number.isInteger(state.batchSize) || state.batchSize < 1) {
    throw new SyncPlanError(`batchSize pozitif tam sayi olmali: ${state.batchSize}`);
  }

  const taban = {
    batchSize: state.batchSize,
    maxPages: maxPagesPerRun,
    conditionalHeaders: {} as Record<string, string>,
    resumeCursor: null as string | null,
    since: null as string | null,
  };

  /*
   * 1) YARIDA KALMIŞ TUR HER ŞEYDEN ÖNCE.
   *
   * İmleç doluysa önceki tur bitmemiş demektir. Yeni bir tam tarama
   * başlatmak, o turun yaptığı işi çöpe atmak ve büyük feed'lerde hiç
   * bitmeyen bir döngüye girmektir.
   */
  if (state.syncCursor !== null && state.syncCursor.length > 0) {
    return {
      ...taban,
      strategy: 'resume',
      resumeCursor: state.syncCursor,
      reason: 'Onceki tur yarida kaldi; kaldigi yerden suruluyor.',
    };
  }

  /*
   * 2) SİLİNENLER İÇİN PERİYODİK TAM TARAMA.
   *
   * Artımlı feed kaldırılan ürünü hiç göndermez. Yalnız artımlı koşulursa
   * katalog, mağazada artık satılmayan ürünlerle sonsuza kadar dolu kalır.
   */
  const tamTaramaGerekli =
    state.lastFullSyncAt === null ||
    saatFarki(now, state.lastFullSyncAt) >= fullSyncIntervalHours;

  if (state.syncMode === 'full' || tamTaramaGerekli) {
    return {
      ...taban,
      strategy: 'full',
      reason:
        state.syncMode === 'full'
          ? 'Kaynak tam tarama kipinde.'
          : 'Tam tarama araligi doldu; SILINEN satirlar yalnizca tam taramada gorulur.',
    };
  }

  /*
   * 3) KOŞULLU İSTEK EN UCUZU.
   *
   * Sunucu "değişmedi" diyebiliyorsa tek bayt inmez. Su işaretinden önce
   * denenmesinin sebebi bu: 304 alan bir tur hiçbir şey ayrıştırmaz.
   */
  const basliklar: Record<string, string> = {};
  if (state.httpEtag) basliklar['if-none-match'] = state.httpEtag;
  if (state.httpLastModified) basliklar['if-modified-since'] = state.httpLastModified;

  if (Object.keys(basliklar).length > 0) {
    return {
      ...taban,
      strategy: 'conditional',
      conditionalHeaders: basliklar,
      since: state.syncWatermark,
      reason: 'Kosullu istek: sunucu degismedi derse tek bayt inmez.',
    };
  }

  /*
   * 4) SU İŞARETİ.
   *
   * Buraya gelindiyse artımlı kip seçilmiş ama ne imleç ne koşullu başlık
   * var. Su işareti de yoksa "değişenleri getir" diyecek bir dayanak
   * kalmaz ve tur pratikte HİÇBİR ŞEY getirmez -- kaynak sessizce boşalır.
   * Bu yüzden kapalı başarısız olunuyor: dayanaksız artımlı kip yerine
   * tam tarama.
   */
  if (state.syncWatermark === null) {
    return {
      ...taban,
      strategy: 'full',
      reason:
        'Artimli kip secilmis ama dayanak yok; tam taramaya duselerek kaynagin ' +
        'sessizce bosalmasi onleniyor.',
    };
  }

  return {
    ...taban,
    strategy: 'incremental',
    since: state.syncWatermark,
    reason: 'Su isaretinden sonra degisenler.',
  };
}

export interface SyncOutcome {
  /** Tur SONUNA KADAR gitti mi. Yarıda kaldıysa false. */
  completed: boolean;
  /** Son işlenen sayfanın imleci; tur bittiyse null. */
  nextCursor: string | null;
  /** Bu turda görülen en yeni değişiklik anı. */
  newestSeenAt: string | null;
  etag: string | null;
  lastModified: string | null;
}

/** Turdan sonra kaynağa yazılacak yeni durum. */
export interface SyncStateUpdate {
  sync_cursor: string | null;
  sync_watermark?: string;
  http_etag?: string | null;
  http_last_modified?: string | null;
  last_full_sync_at?: string;
}

/**
 * Tur sonucunu kaynak durumuna çevirir.
 *
 * TEK KRİTİK KURAL: `sync_watermark` YALNIZCA tur tamamlandığında ilerler.
 * Yarıda kalmış bir turda ilerletmek, işlenmemiş satırları sonsuza kadar
 * atlamak demektir ve bu sessizdir -- eksik ürünler hiçbir hata üretmez.
 */
export function applySyncOutcome(
  plan: SyncPlan,
  outcome: SyncOutcome,
  now: Date,
): SyncStateUpdate {
  if (!outcome.completed) {
    /*
     * Tur yarıda kaldı: yalnız imleç saklanıyor. Su işareti, ETag ve
     * Last-Modified'a DOKUNULMUYOR -- üçü de "buraya kadarı işlendi"
     * iddiasıdır ve o iddia doğru değil.
     */
    return { sync_cursor: outcome.nextCursor };
  }

  const guncelleme: SyncStateUpdate = {
    sync_cursor: null,
    http_etag: outcome.etag,
    http_last_modified: outcome.lastModified,
  };

  if (outcome.newestSeenAt !== null) {
    guncelleme.sync_watermark = outcome.newestSeenAt;
  }

  // Tam tarama bittiyse silinenler de görüldü demektir.
  if (plan.strategy === 'full' || plan.strategy === 'resume') {
    guncelleme.last_full_sync_at = now.toISOString();
  }

  return guncelleme;
}

/**
 * Büyük bir diziyi partilere böler.
 *
 * Tek partide belleğe alınan satır sayısı sınırsız olsaydı işçi düşerdi ve
 * o düşüş EN BÜYÜK feed'de en sık olurdu -- yani tam olarak ölçeklenmesi
 * gereken yerde.
 */
export function* batches<T>(items: readonly T[], size: number): Generator<T[]> {
  if (!Number.isInteger(size) || size < 1) {
    throw new SyncPlanError(`Parti boyutu pozitif tam sayi olmali: ${size}`);
  }

  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

function saatFarki(now: Date, iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    throw new SyncPlanError(`Gecersiz tarih: ${iso}`);
  }
  return (now.getTime() - t) / 3_600_000;
}
