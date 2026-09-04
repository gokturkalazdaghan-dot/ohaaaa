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
import { buildAuthHeaders } from './auth.js';
import { classifyIngestError, IngestError } from './errors.js';
import { expandSecretPlaceholders, redactError } from './http/redact.js';

/**
 * Veritabanı işlemleri. Arayüz olarak tanımlıdır: hattın tamamı gerçek bir
 * Supabase bağlantısı olmadan test edilebilsin diye.
 */
export interface IngestRepository {
  /**
   * Feed'in kategori degerlerini MEVCUT katalog kategorilerine cozer.
   * → normalize edilmis slug → category_id
   *
   * Yeni kategori ACMAZ. Bulunamayan deger haritaya hic girmez ve cagiran
   * taraf onu `null` (siniflandirilmamis) olarak yazar. Feed'in sozlugu
   * bizim taksonomimizi belirleyemez.
   */
  findCategoryIdsBySlug(slugs: string[]): Promise<Map<string, string>>;
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
      /** Cozulemezse null; kanonik urun siniflandirilmamis acilir. */
      categoryId: string | null;
    }>,
  ): Promise<Map<string, string>>;
  /** Teklifleri (merchant_id, external_id) anahtarıyla upsert eder. */
  upsertOffers(
    merchantId: string,
    sourceId: string,
    rows: Array<
      NormalizedOffer & {
        groupId: string | null;
        fingerprint: string;
        /** Cozulemezse null; teklif siniflandirilmamis yazilir. */
        categoryId: string | null;
      }
    >,
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
  /**
   * `headers` İSTEĞE BAĞLI: `query` kimlik doğrulamasında hiç
   * gönderilmez ve mevcut getiriciler (testlerdeki sahteler dâhil) imza
   * değişmeden çalışmaya devam eder.
   */
  get(
    url: string,
    options?: { headers?: Record<string, string> },
  ): Promise<{ body: string; contentType: string | null }>;
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
    itemsUnclassified: 0,
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
      throw new IngestError(
        'CONFIG_ERROR',
        'Elle yönetilen kaynak otomatik alınamaz.',
        true,
      );
    }

    const adapter = ADAPTERS[source.kind as keyof typeof ADAPTERS];
    if (!adapter) {
      throw new IngestError(
        'CONFIG_ERROR',
        `Bu kaynak türü için adaptör yok: ${source.kind}`,
        true,
      );
    }

    if (!source.endpointUrl) {
      throw new IngestError('CONFIG_ERROR', 'Kaynak adresi tanımlı değil.', true);
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

    /*
     * Başlık tabanlı kimlik doğrulama (bearer/basic) da ortamdan okunur ve
     * üretilen değer maskeleme defterine yazılır. `query` yönteminde bu
     * boş nesne döner -- iki yol tek çağrı noktasından geçsin diye.
     */
    const basliklar = buildAuthHeaders(source);
    const { body } = await deps.fetcher.get(adres, { headers: basliklar });

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
      /*
       * GEÇİCİ sayılıyor: sağlayıcının yarım yayınladığı ya da o an
       * boş dönen bir dosya yaygın bir durumdur ve bir sonraki turda
       * düzelir. Kalıcı saymak, düzelecek bir arızada kaynağı tek
       * denemede öldürmek olurdu -- katalog zaten korunuyor.
       */
      throw new IngestError(
        'PARSER_ERROR',
        'Feed boş döndü. Katalog korundu; kaynağı kontrol edin.',
        false,
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
      /*
       * KALICI: alan haritası düzeltilmeden hiçbir tur bu satırı geçemez.
       * Yeniden denemek, aynı feed'i aynı yanlış haritayla beş kez
       * indirmek olurdu.
       */
      throw new IngestError(
        'VALIDATION_ERROR',
        `${records.length} kalemin hiçbiri doğrulamayı geçemedi. ` +
          `Alan haritası (field_mapping) yanlış olabilir.`,
        true,
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

    // --- 4) Kategori ve kanonik ürünle eşleştir -----------------------------
    /*
     * KATEGORI COZUMLEME YAZMADAN ONCE YAPILIR.
     *
     * Kok neden kaydi: feed'in kategori degeri `normalize.ts` icinde
     * `categorySlug` olarak okunuyordu ama YALNIZCA parmak izi
     * niteliklerine giriyordu -- yani degisiklik tespitine. Ne
     * `products.category_id`'ye ne de `product_groups.category_id`'ye
     * yaziliyordu. Sonucu su: alim BASARIYLA biter, urunler veritabanina
     * girer, ama `/kategori/*` sayfalari `category_id` uzerinden
     * filtreledigi icin BOS kalir. Hatanin en pahali bicimi: her sayac
     * yesil, vitrin bos.
     */
    const categoryIds = await resolveCategoryIds(offers, deps.repository);
    const withGroups = await matchCanonicalGroups(offers, deps.repository, categoryIds);

    /*
     * Siniflandirilamayanlar SAYILIR ve LOGLANIR.
     *
     * Sessiz bir null, E5'in ta kendisidir. Bu satir olmasa "0 urun
     * kategoride gorunuyor" durumunu ancak vitrine bakarak fark ederdik.
     */
    const cozulemeyen = [
      ...new Set(
        offers
          .map((offer) => categorySlugKey(offer.categorySlug))
          .filter((slug): slug is string => !!slug && !categoryIds.has(slug)),
      ),
    ];

    summary.itemsUnclassified = withGroups.filter((row) => row.categoryId === null).length;

    if (summary.itemsUnclassified > 0) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'Kategorisi cozulemeyen teklifler var -- kategori sayfalarinda gorunmezler',
          source_id: source.id,
          items_unclassified: summary.itemsUnclassified,
          items_seen: summary.itemsSeen,
          // Bilinmeyen slug'lar sinirli sayida orneklenir: feed'in kategori
          // sozlugu buyuk olabilir ve log satiri kanit olmali, dokum degil.
          unknown_category_slugs: cozulemeyen.slice(0, 20),
          unknown_category_slug_count: cozulemeyen.length,
        }),
      );
    }

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
    const siniflandirma = classifyIngestError(error);
    summary.errorClass = siniflandirma.errorClass;
    summary.errorPermanent = siniflandirma.permanent;
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
/**
 * Feed'in kategori metnini katalog slug bicimine indirger.
 *
 * "Ev & Yaşam" -> "ev-yasam", "Elektronik" -> "elektronik".
 * `categories.slug` citext oldugu icin buyuk/kucuk harf zaten onemsiz;
 * burada aksan ve noktalama da normalize edilir.
 *
 * BULANIK (fuzzy) ESLESME YOK. Yalnizca tam eslesme kabul edilir:
 * "telefon-aksesuar" degeri "telefon" kategorisine DUSMEZ. Bir urunu
 * yanlis kategoriye koymak, hic koymamaktan zararlidir -- kullanici yanlis
 * vitrinde yanlis urunu gorur ve karsilastirma vaadimiz coker.
 */
export function categorySlugKey(value: string | null | undefined): string | null {
  if (!value) return null;

  /*
   * TURKCE 'I' TUZAGI.
   *
   * JavaScript'te 'İ'.toLowerCase() 'i' + U+0307 (birlesen nokta) uretir --
   * tek karakter degil IKI karakter. Basit bir [ğüşıöç] haritasi bunu
   * yakalamaz ve 'ELEKTRONİK' degeri 'elektroni-k' olarak slug'lanip
   * katalogdaki 'elektronik' ile ESLESMEZ. Bu testle yakalandi; gercek bir
   * feed'de sessizce butun bir kategorinin siniflandirilamamasi demekti.
   *
   * Cozum: noktali/noktasiz I acikca ele alinir, kalan aksanlar NFD ile
   * ayristirilip birlesen isaretler atilir (ğ->g, ü->u, ş->s, ö->o, ç->c).
   */
  const slug = value
    .trim()
    .replace(/İ/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || null;
}

/**
 * Feed'de gecen kategori degerlerini MEVCUT katalog kategorilerine cozer.
 *
 * Tek sorguda, tekillestirilmis slug listesiyle. Yeni kategori ACILMAZ:
 * taksonomi urun kararidir, feed karari degil.
 */
export async function resolveCategoryIds(
  offers: NormalizedOffer[],
  repository: IngestRepository,
): Promise<Map<string, string>> {
  const slugs = [
    ...new Set(
      offers
        .map((offer) => categorySlugKey(offer.categorySlug))
        .filter((slug): slug is string => slug !== null),
    ),
  ];

  if (slugs.length === 0) return new Map<string, string>();

  return repository.findCategoryIdsBySlug(slugs);
}

export async function matchCanonicalGroups(
  offers: NormalizedOffer[],
  repository: IngestRepository,
  /**
   * Cozulmus kategori haritasi. Bos gecilebilir: o durumda her sey
   * siniflandirilmamis olur ve mevcut davranis aynen korunur.
   */
  categoryIds: Map<string, string> = new Map(),
): Promise<Array<NormalizedOffer & { groupId: string | null; categoryId: string | null }>> {
  const categoryOf = (offer: NormalizedOffer): string | null => {
    const key = categorySlugKey(offer.categorySlug);
    return key ? categoryIds.get(key) ?? null : null;
  };

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
    {
      title: string;
      brand: string | null;
      gtin: string | null;
      imageUrl: string | null;
      signature: string;
      categoryId: string | null;
    }
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
      // Kanonik urun de siniflandirilir: vitrin kartlari `product_groups`
      // uzerinden listelenir, teklif satirlari uzerinden degil.
      categoryId: categoryOf(offer),
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

    return {
      ...offer,
      groupId: viaGtin ?? viaSignature ?? null,
      categoryId: categoryOf(offer),
    };
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
