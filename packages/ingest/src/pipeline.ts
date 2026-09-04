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

import { productSignature as canonicalSignature } from '@ohaaaa/shared/product-sync';
import {
  canonicalFingerprint,
  classifyDelta,
  needsWrite,
  type FingerprintInput,
} from '@ohaaaa/shared';
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
import { planNextRefresh } from './refreshSignals.js';
import { expandSecretPlaceholders, redactError } from './http/redact.js';

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
    rows: Array<NormalizedOffer & { groupId: string | null; fingerprint: string }>,
    /** Tekliflerin yazılacağı pazar — kaynağın pazarı. */
    market: SourceConfig['market'],
  ): Promise<{ created: number; updated: number }>;
  /**
   * Bu kaynağın bilinen parmak izleri: dış kimlik → parmak izi.
   *
   * Delta karşılaştırmasının "önceki durum" tarafı. Parmak izi olmayan
   * (eski) satırlar haritaya GİRMEZ; onlar NEW sayılır ve bir kez
   * yazılarak parmak izi kazanırlar.
   */
  getFingerprints(sourceId: string): Promise<Map<string, string>>;
  /**
   * Bu turda GÖRÜLEN tüm teklifleri damgalar: `last_seen_at` ve tazelik
   * damgaları (`price_checked_at`, `stock_checked_at`, `offer_checked_at`).
   *
   * DEĞİŞMEYEN TEKLİFLER DE DAMGALANIR ve bu zorunlu.
   *
   * Delta yalnızca NEW/CHANGED'i yazdığı için, UNCHANGED tekliflerin
   * `last_seen_at`'i eski turda kalır. `markStale` "bu turda görülmeyeni
   * stoksuz işaretle" dediğinden, damgalanmasalardı DEĞİŞMEYEN HER ÜRÜN
   * katalogdan düşerdi -- delta'nın yan etkisi olarak.
   *
   * Kavramsal olarak da doğru: bir teklifi GÖRDÜK ve DOĞRULADIK, ama
   * DEĞİŞMEDİ. "Kontrol ettik" ile "değişti" ayrı olaylar.
   */
  touchSeen(sourceId: string, externalIds: string[], checkedAt: Date): Promise<void>;
  /** Bu çalışmada görülmeyen teklifleri stoksuz işaretler. */
  markStale(sourceId: string, runStartedAt: Date): Promise<number>;
  /**
   * Bir sonraki yoklama planını kaynağa yazar.
   *
   * Plan yalnızca bellekte kalsaydı zamanlayıcı onu göremezdi;
   * uyarlanabilir yoklamanın tek anlamlı çıktısı bu kalıcı yazma.
   */
  saveRefreshPlan(
    sourceId: string,
    plan: {
      nextRefreshAt: Date;
      freshnessClass: string;
      reasons: readonly string[];
    },
  ): Promise<void>;
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
    itemsNew: 0,
    itemsChanged: 0,
    itemsUnchanged: 0,
    itemsDeleted: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    durationMs: 0,
    // Aksi kanıtlanana kadar TAM DEĞİL. Güvenli varsayılan: bir hata
    // yolunda buraya hiç gelinmezse silme/bayatlatma yapılmasın.
    snapshotComplete: false,
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

    /*
     * --- 1) Getir ------------------------------------------------------------
     *
     * KİMLİK BİLGİSİ ADRESTEN DEĞİL ORTAMDAN GELİR.
     *
     * `sources.endpoint_url` sütununda jetonun kendisi değil şablonu durur
     * (`...?token=${OHAAAA_FEED_TOKEN}`). Gerçek değer burada, çalışma
     * anında ortamdan okunur; böylece veritabanında, yedeklerde ve panelde
     * düz metin bir kimlik bilgisi hiç bulunmaz. Genişletme aynı anda
     * değeri maskeleme defterine yazar: bu noktadan sonra hiçbir hata
     * metni ya da günlük satırı onu taşıyamaz.
     *
     * Yer tutucu içermeyen adres bu işlemden DEĞİŞMEDEN geçer -- kimlik
     * bilgisi gerektirmeyen açık feed'ler için ek bir kural yok.
     */
    const adres = expandSecretPlaceholders(source.endpointUrl);
    const { body } = await deps.fetcher.get(adres);

    // --- 2) Ayrıştır ---------------------------------------------------------
    const parsed = adapter(body);
    let records: RawRecord[] = parsed.records;

    /*
     * KIRPMA, ANLIK GÖRÜNTÜYÜ EKSİK YAPAR.
     *
     * Önce bu bayrak yoktu ve `markStale` kırpılmış bir turdan sonra da
     * çalışıyordu: 60.000 kalemlik bir feed'de sınırın ötesindeki 10.000
     * teklif HER TURDA "bu beslemede görülmedi" sayılıp stoksuz
     * işaretleniyordu -- kısmi bir anlık görüntüden toplu
     * geçersizleştirme. Sıralama değişirse de her turda başka 10.000'i
     * gidip geliyordu.
     */
    let kirpildi = false;
    if (records.length > MAX_ITEMS_PER_RUN) {
      kirpildi = true;
      summary.sampleErrors.push({
        externalId: null,
        reason: `Feed ${records.length} kalem içeriyor; ilk ${MAX_ITEMS_PER_RUN} işlendi. `
          + 'Anlık görüntü eksik sayıldı; bu turda bayatlatma yapılmayacak.',
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

    /*
     * ANLIK GÖRÜNTÜ TAM MI?
     *
     * İki koşul: feed kırpılmadı VE kalemlerin çoğu doğrulamayı geçti.
     * Düşük geçiş oranı, alan haritasının bozulduğunu gösterir; o
     * durumda "kaynakta yok" ile "ayrıştıramadık" ayırt edilemez ve
     * silme kararı verilemez.
     */
    summary.snapshotComplete = !kirpildi && passRate >= 0.5;

    // --- 4) Kanonik ürünle eşleştir -----------------------------------------
    const withGroups = await matchCanonicalGroups(offers, deps.repository);

    // --- 5) DELTA: neyin gerçekten değiştiği --------------------------------
    /*
     * Buradan önce hat, her turda TÜM teklifleri yazıyordu. 50.000 üründe
     * hiçbiri değişmese bile 50.000 yazma ve 50.000 tetikleyici. Asıl
     * zarar maliyet değil gürültü: gerçekten değişen üç fiyat,
     * değişmeyen 49.997'nin arasında kayboluyordu.
     */
    const oncekiIzler = await deps.repository.getFingerprints(source.id);

    const izli = withGroups.map((offer) => ({
      offer,
      fingerprint: canonicalFingerprint(fingerprintInput(offer, source)),
    }));

    const delta = classifyDelta({
      previous: oncekiIzler,
      current: izli.map((k) => fingerprintInput(k.offer, source)),
      snapshotComplete: summary.snapshotComplete,
    });

    /*
     * DÖRT SAYAÇ DA KAYDEDİLİR.
     *
     * Önce yalnızca UNCHANGED taşınıyordu; NEW/CHANGED/DELETED hesaplanıp
     * atılıyordu. DELETED özellikle önemli: bir kaynağın sessizce ürün
     * kaybetmeye başladığını gösteren tek sinyal o.
     */
    summary.itemsNew = delta.counts.NEW;
    summary.itemsChanged = delta.counts.CHANGED;
    summary.itemsUnchanged = delta.counts.UNCHANGED;
    summary.itemsDeleted = delta.counts.DELETED;

    const yazilacakKimlikler = new Set(
      needsWrite(delta).map((e) => e.externalId),
    );

    const yazilacaklar = izli
      .filter((k) => yazilacakKimlikler.has(k.offer.externalId))
      .map((k) => ({ ...k.offer, fingerprint: k.fingerprint }));

    // --- 6) GÖRÜLEN HER TEKLİFİ DAMGALA -------------------------------------
    /*
     * Yazmadan ÖNCE ve delta sınıfından BAĞIMSIZ.
     *
     * Bu çağrı olmadan delta bir regresyon üretiyordu: değişmeyen
     * teklifler yazılmadığı için `last_seen_at`'leri eskide kalıyor,
     * ardından `markStale` hepsini stoksuz işaretliyordu.
     */
    await deps.repository.touchSeen(
      source.id,
      izli.map((k) => k.offer.externalId),
      startedAt,
    );

    // --- 7) Yaz (yalnızca değişenler) ---------------------------------------
    if (yazilacaklar.length > 0) {
      const { created, updated } = await deps.repository.upsertOffers(
        source.merchantId,
        source.id,
        yazilacaklar,
        source.market,
      );
      summary.itemsCreated = created;
      summary.itemsUpdated = updated;
    }

    // --- 8) Bayatları işaretle — YALNIZCA TAM ANLIK GÖRÜNTÜDE ---------------
    /*
     * `markStale` "bu turda görülmeyeni stoksuz işaretle" demek. Eksik
     * bir anlık görüntüde bu, ağ hatası yüzünden kataloğun bir kısmını
     * yok etmektir -- alım hattının en pahalı arızası.
     *
     * SİLME değil stoksuz işaretleme olması ayrı bir güvenlik katmanı:
     * bir sonraki tam turda kendiliğinden düzelir.
     */
    if (summary.snapshotComplete) {
      const stale = await deps.repository.markStale(source.id, startedAt);
      if (stale > 0) {
        summary.sampleErrors.push({
          externalId: null,
          reason: `${stale} teklif bu beslemede görülmedi, stoksuz işaretlendi.`,
        });
      }
    } else {
      summary.sampleErrors.push({
        externalId: null,
        reason: 'Anlık görüntü eksik: bayatlatma atlandı, katalog korundu.',
      });
    }

    summary.status =
      summary.itemsFailed > 0 || parsed.warnings.length > 0 || !summary.snapshotComplete
        ? 'partial'
        : 'success';
  } catch (error) {
    summary.status = 'failed';
    /*
     * SON BARİYER. Hata metinleri `politeClient` içinde zaten maskelenerek
     * üretiliyor; burada bir kez daha temizleniyor çünkü bu alan doğrudan
     * `ingest_runs.error` ve `sources.last_error` sütunlarına yazılıyor ve
     * hata her zaman bizim ürettiğimiz sınıflardan gelmiyor (fetch, JSON
     * ayrıştırıcı ya da Supabase istemcisi kendi metnini üretebilir).
     */
    summary.error = redactError(error);
  } finally {
    summary.durationMs = now().getTime() - startedMs;
    summary.sampleErrors = summary.sampleErrors.slice(0, MAX_SAMPLE_ERRORS);

    /*
     * YENİLEME PLANI — BAŞARIDA DA BAŞARISIZLIKTA DA.
     *
     * `finally` içinde ve bu kasıtlı: alım başarısız olduğunda da bir
     * sonraki deneme zamanı belirlenmeli. Yalnızca başarı yolunda
     * yazılsaydı, çöken bir kaynağın `next_refresh_at`'i eski değerinde
     * donar ve zamanlayıcı onu ya hiç denemez ya da eski plana göre
     * döverdi.
     *
     * Hesap özetin TAMAMLANMIŞ hâlini kullanıyor: durum, delta sayaçları
     * ve anlık görüntü tamlığı bu noktada belli.
     */
    try {
      const refresh = planNextRefresh(summary, now());
      await deps.repository.saveRefreshPlan(source.id, {
        nextRefreshAt: refresh.nextRefreshAt,
        freshnessClass: refresh.plan.freshnessClass,
        reasons: refresh.plan.reasons,
      });
    } catch (error) {
      /*
       * PLAN YAZILAMAZSA ALIM BAŞARISIZ SAYILMAZ.
       *
       * Veri zaten yazıldı; turu başarısız ilan etmek daha büyük zarar
       * olurdu. Sorun görünür kalıyor: örnek hatalara ekleniyor ve
       * çalışma kaydında duruyor.
       */
      summary.sampleErrors.push({
        externalId: null,
        reason:
          'Yenileme planı yazılamadı: ' +
          (error instanceof Error ? error.message : String(error)),
      });
    }

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
/**
 * Kanonik eşleştirme imzası.
 *
 * Burada AYRI bir kopyası vardı; taşeron beslemesindeki ve veritabanındaki
 * hesapla birebir aynıydı ama bağımsızdı. Üç kopyanın zamanla ayrışması
 * kaçınılmazdı ve ayrışma sessiz olurdu: aynı ürün iki farklı imza alır,
 * iki ayrı kanonik ürün açılır, fiyatlar karşılaştırılmaz.
 *
 * Tek kaynak artık `@ohaaaa/shared`; veritabanındaki
 * `public.product_signature()` de aynı değeri üretir.
 */
export { canonicalSignature };


/**
 * Normalleştirilmiş teklifi parmak izi girdisine çevirir.
 *
 * Buraya HANGİ alanların girdiği, "değişim" tanımının kendisidir.
 * Zaman damgaları ve tarama kimliği bilerek dışarıda: girselerdi her
 * tarama "değişti" derdi ve delta tespiti anlamını tamamen kaybederdi.
 */
function fingerprintInput(
  offer: NormalizedOffer & { groupId: string | null },
  source: SourceConfig,
): FingerprintInput {
  return {
    externalId: offer.externalId,
    // Pazar parmak izine GİRER: aynı dış kimliğe sahip TR ve DE teklifi
    // aynı entity gibi karşılaştırılmamalı.
    market: source.market,
    merchantId: source.merchantId,
    title: offer.title,
    priceCents: offer.priceCents,
    currency: offer.currency,
    // Stok DURUMU, adedi değil: 12'den 11'e düşmek kullanıcı için hiçbir
    // şey değiştirmez ve her stok hareketini değişim saymak kuyruğu
    // anlamsız işle doldururdu.
    inStock: offer.stock > 0,
    productUrl: offer.productUrl,
    shippingFeeCents: offer.shippingFeeCents,
    attributes: {
      brand: offer.brand ?? '',
      gtin: offer.gtin ?? '',
      category: offer.categorySlug ?? '',
    },
  };
}
