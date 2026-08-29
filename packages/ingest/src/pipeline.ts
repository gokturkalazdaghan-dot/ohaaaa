/**
 * Alım hattı — bir kaynağı baştan sona işler.
 *
 *   kaynak yapılandırması
 *        ↓  getir (nazik istemci / dosya)
 *   ham içerik
 *        ↓  ayrıştır (adaptör)
 *   RawRecord[]
 *        ↓  normalleştir + doğrula
 *   NormalizedOffer[]
 *        ↓  kanonik ürünle eşleştir
 *   teklif + group_id
 *        ↓  upsert
 *   veritabanı
 *        ↓  bu çalışmada görülmeyenleri işaretle
 *   bayat teklifler → out_of_stock
 *
 * TASARIM KARARI — "bayat" teklifleri SİLMİYORUZ, stoksuz işaretliyoruz.
 * Bir feed geçici olarak yarım gelirse (ağ hatası, kısmi yayın), silme
 * kataloğun yarısını yok eder ve geri getirmek yeni bir tam alım gerektirir.
 * Stoksuz işaretlemek geri alınabilir bir karardır.
 */

import type {
  IngestSummary,
  NormalizedOffer,
  RawRecord,
  SourceConfig,
} from './types.js';

import { parseCsv } from './adapters/csv.js';
import { parseJson } from './adapters/json.js';
import { parseXml } from './adapters/xml.js';
import { normalizeRecords } from './normalize.js';

/**
 * Veritabanı işlemleri. Arayüz olarak tanımlıdır: hattın tamamı gerçek bir
 * Supabase bağlantısı olmadan test edilebilsin diye.
 */
export interface IngestRepository {
  /** GTIN ile kanonik ürün arar. → gtin → group_id */
  findGroupsByGtin(gtins: string[]): Promise<Map<string, string>>;
  /** Marka + normalize başlık imzasıyla arar. → imza → group_id */
  findGroupsBySignature(signatures: string[]): Promise<Map<string, string>>;
  /** Yeni kanonik ürünler açar. → dizin → group_id */
  createGroups(
    groups: Array<{
      title: string;
      brand: string | null;
      gtin: string | null;
      imageUrl: string | null;
      signature: string;
    }>,
  ): Promise<Map<string, string>>;
  /** Teklifleri (merchant_id, external_id) anahtarıyla upsert eder. */
  upsertOffers(
    merchantId: string,
    sourceId: string,
    rows: Array<NormalizedOffer & { groupId: string | null }>,
  ): Promise<{ created: number; updated: number }>;
  /** Bu çalışmada görülmeyen teklifleri stoksuz işaretler. */
  markStale(sourceId: string, runStartedAt: Date): Promise<number>;
  /** Çalışma kaydını açar/kapatır. */
  startRun(sourceId: string): Promise<string>;
  finishRun(runId: string, summary: IngestSummary): Promise<void>;
}

export interface Fetcher {
  get(url: string): Promise<{ body: string; contentType: string | null }>;
}

const ADAPTERS = {
  feed_csv: parseCsv,
  feed_xml: parseXml,
  feed_json: parseJson,
} as const;

/** Bir çalışmada en fazla kaç kalem işlenir. Bellek ve süre koruması. */
const MAX_ITEMS_PER_RUN = 50_000;
/** ingest_runs.sample_errors alanında saklanan örnek hata sayısı. */
const MAX_SAMPLE_ERRORS = 20;

export async function runSource(
  source: SourceConfig,
  deps: { fetcher: Fetcher; repository: IngestRepository; now?: () => Date },
): Promise<IngestSummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const startedMs = startedAt.getTime();

  const runId = await deps.repository.startRun(source.id);

  const summary: IngestSummary = {
    sourceId: source.id,
    status: 'failed',
    itemsSeen: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    durationMs: 0,
    sampleErrors: [],
  };

  try {
    if (source.kind === 'manual') {
      throw new Error('Elle yönetilen kaynak otomatik alınamaz.');
    }

    const adapter = ADAPTERS[source.kind as keyof typeof ADAPTERS];
    if (!adapter) {
      throw new Error(`Bu kaynak türü için adaptör yok: ${source.kind}`);
    }

    if (!source.endpointUrl) {
      throw new Error('Kaynak adresi tanımlı değil.');
    }

    // --- 1) Getir ------------------------------------------------------------
    const { body } = await deps.fetcher.get(source.endpointUrl);

    // --- 2) Ayrıştır ---------------------------------------------------------
    const parsed = adapter(body);
    let records: RawRecord[] = parsed.records;

    if (records.length > MAX_ITEMS_PER_RUN) {
      summary.sampleErrors.push({
        externalId: null,
        reason: `Feed ${records.length} kalem içeriyor; ilk ${MAX_ITEMS_PER_RUN} işlendi.`,
      });
      records = records.slice(0, MAX_ITEMS_PER_RUN);
    }

    summary.itemsSeen = records.length;

    for (const warning of parsed.warnings.slice(0, MAX_SAMPLE_ERRORS)) {
      summary.sampleErrors.push({ externalId: null, reason: warning });
    }
    summary.itemsSkipped += parsed.warnings.length;

    // BOŞ FEED KORUMASI: bir feed sessizce boşalırsa (ağ tarafında bir şey
    // bozulduysa) bütün kataloğu stoksuz işaretlemek felakettir. Boş sonuç
    // başarı değil, hata olarak raporlanır ve bayatlatma ÇALIŞTIRILMAZ.
    if (records.length === 0) {
      throw new Error(
        'Feed boş döndü. Katalog korundu; kaynağı kontrol edin.',
      );
    }

    // --- 3) Normalleştir -----------------------------------------------------
    const { offers, errors } = normalizeRecords(records, source.fieldMapping, {
      defaultCurrency: source.currency,
      allowedHosts: source.allowedHosts,
    });

    summary.itemsFailed = errors.length;
    summary.sampleErrors.push(...errors.slice(0, MAX_SAMPLE_ERRORS));

    if (offers.length === 0) {
      throw new Error(
        `${records.length} kalemin hiçbiri doğrulamayı geçemedi. ` +
          `Alan haritası (field_mapping) yanlış olabilir.`,
      );
    }

    // Doğrulamayı geçen oran çok düşükse harita bozulmuş demektir.
    const passRate = offers.length / records.length;
    if (passRate < 0.5) {
      summary.sampleErrors.push({
        externalId: null,
        reason:
          `UYARI: kalemlerin yalnızca %${Math.round(passRate * 100)}'i geçerli. ` +
          `Alan haritasını gözden geçirin.`,
      });
    }

    // --- 4) Kanonik ürünle eşleştir -----------------------------------------
    const withGroups = await matchCanonicalGroups(offers, deps.repository);

    // --- 5) Yaz --------------------------------------------------------------
    const { created, updated } = await deps.repository.upsertOffers(
      source.merchantId,
      source.id,
      withGroups,
    );

    summary.itemsCreated = created;
    summary.itemsUpdated = updated;

    // --- 6) Bayatları işaretle ----------------------------------------------
    const stale = await deps.repository.markStale(source.id, startedAt);
    if (stale > 0) {
      summary.sampleErrors.push({
        externalId: null,
        reason: `${stale} teklif bu beslemede görülmedi, stoksuz işaretlendi.`,
      });
    }

    summary.status =
      summary.itemsFailed > 0 || parsed.warnings.length > 0 ? 'partial' : 'success';
  } catch (error) {
    summary.status = 'failed';
    summary.error = error instanceof Error ? error.message : String(error);
  } finally {
    summary.durationMs = now().getTime() - startedMs;
    summary.sampleErrors = summary.sampleErrors.slice(0, MAX_SAMPLE_ERRORS);
    await deps.repository.finishRun(runId, summary);
  }

  return summary;
}

/**
 * Teklifleri kanonik ürünlere bağlar.
 *
 * Sıra güvenilirlikten zayıfa:
 *   1. GTIN — küresel benzersiz, doğrulanmış kontrol basamağı
 *   2. Marka + normalize başlık imzası
 *   3. Eşleşme yoksa yeni kanonik ürün
 *
 * 2. adım MUHAFAZAKÂRDIR: yalnızca tam imza eşleşmesi kabul edilir. İki farklı
 * ürünü yanlışlıkla birleştirmek, hiç birleştirmemekten çok daha zararlıdır —
 * kullanıcı yanlış ürünü satın alır.
 */
export async function matchCanonicalGroups(
  offers: NormalizedOffer[],
  repository: IngestRepository,
): Promise<Array<NormalizedOffer & { groupId: string | null }>> {
  const gtins = [...new Set(offers.map((o) => o.gtin).filter((g): g is string => !!g))];
  const byGtin = gtins.length > 0
    ? await repository.findGroupsByGtin(gtins)
    : new Map<string, string>();

  // GTIN ile eşleşmeyenler için imza havuzu.
  const unmatched = offers.filter((o) => !o.gtin || !byGtin.has(o.gtin));
  const signatures = [...new Set(unmatched.map((o) => canonicalSignature(o.title, o.brand)))];

  const bySignature = signatures.length > 0
    ? await repository.findGroupsBySignature(signatures)
    : new Map<string, string>();

  // Hâlâ eşleşmeyenler için yeni kanonik ürün aç (aynı beslemede tekrar
  // edenleri tek sefer yaratarak).
  const toCreate = new Map<
    string,
    { title: string; brand: string | null; gtin: string | null; imageUrl: string | null; signature: string }
  >();

  for (const offer of offers) {
    if (offer.gtin && byGtin.has(offer.gtin)) continue;

    const signature = canonicalSignature(offer.title, offer.brand);
    if (bySignature.has(signature)) continue;
    if (toCreate.has(signature)) continue;

    toCreate.set(signature, {
      title: offer.title,
      brand: offer.brand,
      gtin: offer.gtin,
      imageUrl: offer.imageUrls[0] ?? null,
      signature,
    });
  }

  if (toCreate.size > 0) {
    const created = await repository.createGroups([...toCreate.values()]);
    for (const [signature, groupId] of created) {
      bySignature.set(signature, groupId);
    }
  }

  return offers.map((offer) => {
    const viaGtin = offer.gtin ? byGtin.get(offer.gtin) : undefined;
    const viaSignature = bySignature.get(canonicalSignature(offer.title, offer.brand));

    return { ...offer, groupId: viaGtin ?? viaSignature ?? null };
  });
}

/**
 * Kanonik eşleştirme imzası: marka + sadeleştirilmiş başlık.
 *
 * Kelimeler SIRALANIR, böylece "Sony WH-1000XM5 Kulaklık" ile
 * "Kulaklık Sony WH-1000XM5" aynı imzayı üretir. Bu, feed'ler arasında
 * en sık görülen fark biçimidir.
 *
 * Not: SQL tarafındaki productSync.ts ile AYNI algoritma. İkisi ayrışırsa
 * aynı ürün iki farklı kanonik kayda düşer ve karşılaştırma bozulur.
 */
export function canonicalSignature(title: string, brand: string | null): string {
  const normalizedTitle = normalizeForSignature(title)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0)
    .sort()
    .join(' ');

  return `${normalizeForSignature(brand ?? '')}|${normalizedTitle}`;
}

function normalizeForSignature(value: string): string {
  const map: Record<string, string> = {
    Ğ: 'g', Ü: 'u', Ş: 's', İ: 'i', Ö: 'o', Ç: 'c', I: 'i',
    ğ: 'g', ü: 'u', ş: 's', ı: 'i', ö: 'o', ç: 'c',
    Â: 'a', Î: 'i', Û: 'u', â: 'a', î: 'i', û: 'u',
  };

  return value.replace(/[ĞÜŞİÖÇIğüşıöçÂÎÛâîû]/g, (c) => map[c] ?? c).toLowerCase();
}
