/**
 * Katalog erişim katmanı.
 *
 * Tek bir arayüzün arkasında iki kaynak vardır:
 *   • Supabase yapılandırılmışsa gerçek veritabanı (search_products RPC'si)
 *   • Değilse yerleşik demo veri kümesi
 *
 * Sayfalar hangi kaynağın kullanıldığını bilmez. Bu ayrım sayesinde arayüz,
 * veritabanı kurulmadan geliştirilebilir ve gözden geçirilebilir.
 */

import 'server-only';

import { unstable_cache } from 'next/cache';

import {
  buildCategoryTree,
  collectByKeyset,
  offerSellerName,
  rankShowcase,
} from '@ohaaaa/shared';
import type {
  Category,
  CategoryNode,
  FlashDeal,
  Offer,
  OhaaaaScore,
  PriceDrop,
  PricePoint,
  ProductGroupWithOffers,
  ScoreComponent,
  SearchResult,
  Vendor,
} from '@ohaaaa/shared';

import { isSupabaseConfigured } from '@/lib/env';
import { createAnonClient } from '@/lib/supabase/anon';

import {
  demoCategories,
  demoFlashDeals,
  demoMerchants,
  demoProductGroups,
  demoVendors,
} from './demo';

export type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'offers';

/**
 * KATALOG OKUMALARI İÇİN ÖNBELLEK.
 *
 * NEDEN GEREKLİ -- ÖLÇÜLEN DURUM
 * Sitenin tamamı `force-dynamic` (yerleşimdeki oturum çerezi yüzünden), yani
 * her tıklama sunucuda sıfırdan render ediliyor ve her render bütün katalog
 * sorgularını yeniden atıyor. Canlıda ölçüldü:
 *
 *   veritabanına HİÇ gitmeyen sayfa (/sss)   ~240 ms
 *   katalog okuyan sayfa (/, /magaza, ...)  2.000-6.300 ms
 *
 * Yani sürenin neredeyse tamamı sorgularda. Next.js'te bir bağlantıya
 * tıklamak da aynı sunucu render'ını beklettiği için kullanıcı bunu
 * "butonlar geç yanıt veriyor" diye yaşıyor.
 *
 * NEDEN GÜVENLİ
 * Burada önbelleğe alınan her şey HERKESE AÇIK katalog verisi: kategori,
 * mağaza, vitrin, kampanya. Kullanıcıya özel hiçbir şey yok, dolayısıyla
 * bir ziyaretçinin gördüğü veriyi başkasına göstermek gibi bir risk yok.
 * Oturuma bağlı her şey (sepet, favoriler, hesap) bu katmanın DIŞINDA ve
 * önbelleğe hiç girmiyor.
 *
 * SÜRELER VERİNİN GERÇEK DEĞİŞİM HIZINA GÖRE
 * Katalog günde bir kez beslemeyle tazeleniyor (ölçüldü: `next_refresh_at`
 * ertesi gün). Taksonomi ondan da yavaş değişiyor. Süreler buna göre
 * seçildi; daha uzun tutmak bayat fiyat göstermek olurdu, daha kısa tutmak
 * hiç önbelleklememekle aynı kapıya çıkardı.
 */
const ONBELLEK = {
  /** Kategori ağacı ve listesi: taksonomi göçle değişir, beslemeyle değil. */
  taksonomi: 3600,
  /** Mağaza listesi: yeni ortak eklenmesi nadir. */
  magazalar: 1800,
  /** Vitrin ve kampanyalar: beslemeden etkilenir. */
  vitrin: 900,
  /** Gezinme amaçlı arama (serbest metin YOK): fiyatlar beslemeyle değişir. */
  listeleme: 600,
} as const;

/**
 * Bir katalog okumasını önbelleğe alır.
 *
 * `unstable_cache` anahtarı `anahtar` + fonksiyonun ARGÜMANLARINDAN üretir,
 * dolayısıyla aynı fonksiyonun farklı parametreli çağrıları birbirine
 * karışmaz.
 */
function onbellekle<A extends unknown[], R>(
  anahtar: string,
  fn: (...args: A) => Promise<R>,
  saniye: number,
): (...args: A) => Promise<R> {
  return unstable_cache(fn, ['katalog', anahtar], {
    revalidate: saniye,
    tags: ['katalog'],
  });
}



/**
 * Bir arama sayfasi: sonuclar VE filtreye uyan toplam.
 *
 * Toplam olmadan sayfalama yapilamaz - "sonraki sayfa var mi" sorusunun
 * cevabi bilinmez. SQL bunu ayni sorgunun icinde pencere fonksiyonuyla
 * dondurur; ikinci bir sayim sorgusu yazmiyoruz, cunku iki kopya filtre
 * zamanla ayrisir ve sayfa sayisi sessizce yanlis cikar.
 */
export interface SearchPage {
  results: SearchResult[];
  totalCount: number;
}

/** Filtre seridinin gercek sinirlari (uydurma aralik gostermemek icin). */
export interface SearchFacets {
  minPriceCents: number | null;
  maxPriceCents: number | null;
  categories: Array<{ id: string; slug: string; name: string; count: number }>;
  brands: Array<{ name: string; count: number }>;
  freeShippingCount: number;
}

export interface SearchParams {
  query?: string;
  categoryId?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  sort?: SortOption;
  limit?: number;
  offset?: number;
  /** Seçili markalar. Boş dizi "filtre yok" demektir, "hiçbiri" değil. */
  brands?: string[];
  /** Yalnızca ücretsiz kargolu teklifi olan ürünler. */
  freeShipping?: boolean;
}

/*
 * GÖÇ İLE DAĞITIM ARASINDAKİ PENCERE.
 *
 * `search_products` ve `search_facets` yeni parametreler aldı. Web tarafı
 * Vercel'e göçten ÖNCE çıkarsa, PostgREST o imzayı bulamaz ve arama tamamen
 * kırılır — filtreler değil, ARAMANIN KENDİSİ.
 *
 * Bu yüzden yeni imza bir kez denenir; PostgREST "böyle bir fonksiyon yok"
 * derse (PGRST202) eski imzayla tekrar denenir ve sonuç modül ömrü boyunca
 * hatırlanır. Yani her istekte iki tur atılmaz, yalnızca ilkinde.
 *
 * Geri düşüşte filtreler UYGULANAMAZ; kullanıcıya sessizce yanlış sonuç
 * göstermektense filtre şeridi gizlenir (bkz. searchFacets: eski imzada
 * marka listesi boş döner ve arayüz o bölümü çizmez).
 */
type RpcSignature = 'yeni' | 'eski';
let searchSignature: RpcSignature | null = null;

/** PostgREST'in "bu imzada fonksiyon yok" hatası. */
function isMissingSignature(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST202' ||
    /function .* does not exist|Could not find the function/i.test(error.message ?? '')
  );
}

/**
 * PostgREST tekil ilişkiyi ortama göre dizi ya da nesne döndürür.
 * Bu farkı her çağrı yerinde tekrar ele almak yerine tek yerde açıyoruz.
 */
function unwrapRelation(value: unknown): Record<string, unknown> | null {
  const unwrapped = Array.isArray(value) ? value[0] : value;
  return unwrapped && typeof unwrapped === 'object'
    ? (unwrapped as Record<string, unknown>)
    : null;
}

/** Veri kaynağının hangisi olduğunu arayüze bildirir (demo rozeti için). */
export function isDemoMode(): boolean {
  return !isSupabaseConfigured();
}

/**
 * Türkçe karakterleri ASCII'ye indirger.
 * SQL'deki public.normalize_search() ile aynı davranışı üretir; demo modu
 * ile canlı mod arasında arama sonuçları tutarlı kalsın diye.
 */
function normalize(value: string): string {
  const map: Record<string, string> = {
    Ğ: 'g', Ü: 'u', Ş: 's', İ: 'i', Ö: 'o', Ç: 'c', I: 'i',
    ğ: 'g', ü: 'u', ş: 's', ı: 'i', ö: 'o', ç: 'c',
    Â: 'a', Î: 'i', Û: 'u', â: 'a', î: 'i', û: 'u',
  };
  return value.replace(/[ĞÜŞİÖÇIğüşıöçÂÎÛâîû]/g, (char) => map[char] ?? char).toLowerCase();
}

// ---------------------------------------------------------------------------
// Arama
// ---------------------------------------------------------------------------
async function aramaOku(params: SearchParams): Promise<SearchPage> {
  const supabase = createAnonClient();

  if (supabase) {
    const base = {
      p_query: params.query ?? null,
      p_category_id: params.categoryId ?? null,
      p_min_price: params.minPriceCents ?? null,
      p_max_price: params.maxPriceCents ?? null,
      p_sort: params.sort ?? 'relevance',
      p_limit: params.limit ?? 24,
      p_offset: params.offset ?? 0,
    };
    const withFilters = {
      ...base,
      p_brands: params.brands?.length ? params.brands : null,
      p_free_shipping: params.freeShipping ?? false,
    };

    let response =
      searchSignature === 'eski'
        ? await supabase.rpc('search_products', base)
        : await supabase.rpc('search_products', withFilters);

    if (searchSignature === null && isMissingSignature(response.error)) {
      // Göç henüz uygulanmamış. Aramayı kırmak yerine eski imzaya düşülür.
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'search_products eski imzayla çağrılıyor — filtre göçü uygulanmamış',
        }),
      );
      searchSignature = 'eski';
      response = await supabase.rpc('search_products', base);
    } else if (searchSignature === null && !response.error) {
      searchSignature = 'yeni';
    }

    const { data, error } = response;
    if (error) throw new Error(`Arama başarısız: ${error.message}`);

    const rows = (data ?? []) as Record<string, unknown>[];

    // Toplam her satirda ayni; ilk satirdan okunur. Hic satir yoksa toplam
    // sifirdir - bos sayfa ile "sonuc yok" ayni sey.
    const totalCount = Number(rows[0]?.total_count ?? rows.length);

    /*
     * PARA BIRIMI: RPC DONDURMUYOR, EN IYI TEKLIFTEN OKUNUR.
     *
     * `search_products` donus tipinde para birimi YOK (`p_currency` yalnizca
     * GIRDI filtresi). Kaynak olarak `products.currency` kullaniliyor --
     * `product_groups.price_currency` DEGIL.
     *
     * NEDEN `products.currency`: iki gerekce var.
     *
     *   1) DOGRULUK. Gosterilen tutar `min_price_cents`, yani EN IYI teklifin
     *      fiyati. O tutarin para birimi de o teklifin para birimidir.
     *      Gruptaki ozet sutun degil, teklifin kendisi kaynaktir.
     *
     *   2) GOC AYRISMASI. `product_groups.price_currency` URETIMDE var ama
     *      depo goclerinde YOK; `verify-supabase-queries` bunu hakli olarak
     *      reddetti (ayni sey `gtin_normalized` ile de yasandi). Depoda
     *      tanimli olmayan bir sutuna bagimlilik yazmak, ayrismayi kodun
     *      icine tasimak olurdu. `products.currency` depoda TANIMLI.
     */
    const teklifKimlikleri = rows
      .map((row) => (row.best_offer_id ? String(row.best_offer_id) : null))
      .filter((id): id is string => id !== null);

    const teklifParalari = new Map<string, string>();
    if (teklifKimlikleri.length > 0) {
      const { data: paraSatirlari, error: paraHatasi } = await supabase
        .from('products')
        .select('id, currency')
        .in('id', teklifKimlikleri);

      /*
       * Bu sorgu ARAMAYI KIRMAZ: kirilirsa sonuclar yine gosterilir.
       * Asagidaki esik o durumda `null` verir ve `formatMoney` ham kodu
       * yazar -- yanlis simge basmaktansa kod yazmak dogrudur.
       */
      if (paraHatasi) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'Arama sonuclari icin para birimi okunamadi',
            hata: paraHatasi.message,
          }),
        );
      }

      for (const satir of paraSatirlari ?? []) {
        if (satir.currency) {
          teklifParalari.set(String(satir.id), String(satir.currency).trim());
        }
      }
    }

    const results = rows.map(
      (row: Record<string, unknown>): SearchResult => ({
        groupId: String(row.group_id),
        slug: String(row.slug),
        title: String(row.title),
        brand: row.brand ? String(row.brand) : null,
        imageUrl: row.image_url ? String(row.image_url) : null,
        offerCount: Number(row.offer_count),
        minPriceCents: row.min_price_cents === null ? null : Number(row.min_price_cents),
        maxPriceCents: row.max_price_cents === null ? null : Number(row.max_price_cents),
        currency:
          teklifParalari.get(String(row.best_offer_id ?? '')) ?? 'TRY',
        bestOfferId: row.best_offer_id ? String(row.best_offer_id) : null,
        bestVendorId: row.best_vendor_id ? String(row.best_vendor_id) : null,
        bestVendorName: row.best_vendor_name ? String(row.best_vendor_name) : null,
      }),
    );

    return { results, totalCount };
  }

  return searchDemo(params);
}

/**
 * Filtre seridi verisi.
 *
 * Alinamazsa sayfa yine acilmali: filtreler ikincil bir kolayliktir, arama
 * sonucunun kendisi degil. Bu yuzden hata firlatmaz, bos facet doner.
 */
export async function getSearchFacets(params: SearchParams): Promise<SearchFacets> {
  const empty: SearchFacets = {
    minPriceCents: null,
    maxPriceCents: null,
    categories: [],
    brands: [],
    freeShippingCount: 0,
  };
  const supabase = createAnonClient();

  // Demo modunda facet'ler yerleşik veri kümesinden hesaplanır. Boş dönseydi
  // filtre rayı yerelde HİÇ görünmezdi ve depoyu klonlayan biri arayüzün o
  // parçasını hiç göremezdi — oysa amaç tam tersi: tek komutla dolu bir
  // pazar yeri görmek.
  if (!supabase) return demoFacets(params);

  const baseArgs = {
    p_query: params.query ?? null,
    p_category_id: params.categoryId ?? null,
  };
  const filterArgs = {
    ...baseArgs,
    p_brands: params.brands?.length ? params.brands : null,
    p_free_shipping: params.freeShipping ?? false,
  };

  let facetResponse =
    searchSignature === 'eski'
      ? await supabase.rpc('search_facets', baseArgs)
      : await supabase.rpc('search_facets', filterArgs);

  if (isMissingSignature(facetResponse.error)) {
    searchSignature = 'eski';
    facetResponse = await supabase.rpc('search_facets', baseArgs);
  }

  const { data, error } = facetResponse;

  if (error) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'Filtre verisi alınamadı', error: error.message }),
    );
    return empty;
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    minPriceCents: row.min_price_cents === null || row.min_price_cents === undefined
      ? null
      : Number(row.min_price_cents),
    maxPriceCents: row.max_price_cents === null || row.max_price_cents === undefined
      ? null
      : Number(row.max_price_cents),
    categories: ((row.categories as Record<string, unknown>[] | null) ?? []).map((c) => ({
      id: String(c.id),
      slug: String(c.slug),
      name: String(c.name),
      count: Number(c.count),
    })),
    /* Eski imzada bu alanlar hiç dönmez; boş kalır ve arayüz marka
       bölümünü çizmez. Filtre şeridinin yarısını "0 sonuç" diye göstermek,
       göç uygulanmadığını kullanıcıya bir arıza gibi yansıtırdı. */
    brands: ((row.brands as Record<string, unknown>[] | null) ?? []).map((b) => ({
      name: String(b.name),
      count: Number(b.count),
    })),
    freeShippingCount: Number(row.free_shipping_count ?? 0),
  };
}

/**
 * Demo modu facet hesabı — SQL'deki search_facets ile aynı kuralları izler.
 *
 * Önemli iki kural birebir korunur:
 *   • Fiyat sınırları FİYAT FİLTRESİ UYGULANMADAN hesaplanır; yoksa kullanıcı
 *     aralığı daralttıkça kaydırıcı da daralır ve geri genişletilemez.
 *   • Kategori sayaçları KATEGORİ FİLTRESİ UYGULANMADAN hesaplanır; kullanıcı
 *     başka bir kategoride kaç sonuç olduğunu seçmeden önce görebilmeli.
 */
function demoFacets(params: SearchParams): SearchFacets {
  const matched = searchDemo({ query: params.query, limit: demoProductGroups.length }).results;
  const groupOf = (id: string) => demoProductGroups.find((candidate) => candidate.id === id);

  const secili = (params.brands ?? []).map((b) => b.toLocaleLowerCase('tr'));
  const markaUyar = (id: string) => {
    if (secili.length === 0) return true;
    const brand = groupOf(id)?.brand;
    return Boolean(brand && secili.includes(brand.toLocaleLowerCase('tr')));
  };
  const kargoUyar = (id: string) => !params.freeShipping || hasFreeShipping(id);
  const kategoriUyar = (id: string) =>
    !params.categoryId || groupOf(id)?.categoryId === params.categoryId;

  const inScope = matched.filter((r) => kategoriUyar(r.groupId));

  const prices = inScope
    .filter((r) => markaUyar(r.groupId) && kargoUyar(r.groupId))
    .map((result) => result.minPriceCents)
    .filter((price): price is number => price !== null);

  /* Marka sayacı: MARKA dışındaki filtreler uygulanır — kullanıcı "Sony"
     seçtiğinde diğer markaların sayıları görünür kalmalı, yoksa seçimini
     genişletemez. */
  const brandCounts = new Map<string, number>();
  for (const result of inScope) {
    if (!kargoUyar(result.groupId)) continue;
    const brand = groupOf(result.groupId)?.brand;
    if (!brand?.trim()) continue;
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
  }

  return {
    minPriceCents: prices.length > 0 ? Math.min(...prices) : null,
    maxPriceCents: prices.length > 0 ? Math.max(...prices) : null,
    categories: demoCategories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      count: matched.filter(
        (result) =>
          groupOf(result.groupId)?.categoryId === category.id &&
          markaUyar(result.groupId) &&
          kargoUyar(result.groupId),
      ).length,
    })),
    brands: [...brandCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr')),
    /* Kargo sayacı: KARGO dışındaki filtreler uygulanır. */
    freeShippingCount: inScope.filter(
      (r) => hasFreeShipping(r.groupId) && markaUyar(r.groupId),
    ).length,
  };
}

/** Bir kanonik ürünün ücretsiz kargolu aktif teklifi var mı? */
function hasFreeShipping(groupId: string): boolean {
  const group = demoProductGroups.find((candidate) => candidate.id === groupId);
  return (group?.offers ?? []).some(
    (offer) => offer.stock > 0 && offer.shippingFeeCents === 0,
  );
}

/** Demo modu araması — SQL'deki kelime bazlı AND eşleştirmesini taklit eder. */
function searchDemo(params: SearchParams): SearchPage {
  const tokens = params.query ? normalize(params.query).split(/\s+/).filter(Boolean) : [];

  let results = demoProductGroups.filter((group) => {
    const haystack = normalize(`${group.title} ${group.brand ?? ''}`);

    // Her kelime eşleşmeli (AND semantiği) — tek kelime tutmuyorsa elenir.
    if (!tokens.every((token) => haystack.includes(token))) return false;

    if (params.categoryId && group.categoryId !== params.categoryId) return false;
    if (params.minPriceCents && (group.minPriceCents ?? 0) < params.minPriceCents) return false;
    if (params.maxPriceCents && (group.minPriceCents ?? 0) > params.maxPriceCents) return false;

    /* SQL ile aynı kurallar: marka karşılaştırması büyük/küçük harften
       bağımsız, boş dizi filtre sayılmaz, ücretsiz kargo en az bir aktif
       kargosuz TEKLİF ister (grup bazında değil, teklif bazında). */
    if (params.brands?.length) {
      const secili = params.brands.map((b) => b.toLocaleLowerCase('tr'));
      if (!group.brand || !secili.includes(group.brand.toLocaleLowerCase('tr'))) return false;
    }

    if (params.freeShipping && !hasFreeShipping(group.id)) return false;

    return true;
  });

  const sort = params.sort ?? 'relevance';
  results = [...results].sort((a, b) => {
    if (sort === 'price_asc') return (a.minPriceCents ?? 0) - (b.minPriceCents ?? 0);
    if (sort === 'price_desc') return (b.minPriceCents ?? 0) - (a.minPriceCents ?? 0);
    if (sort === 'offers') return b.offerCount - a.offerCount;
    return a.title.localeCompare(b.title, 'tr');
  });

  const offset = params.offset ?? 0;

  // Toplam dilimlemeden ONCE alinir; canli moddaki total_count ile ayni anlam.
  return {
    results: results.slice(offset, offset + (params.limit ?? 24)).map(toSearchResult),
    totalCount: results.length,
  };
}

function toSearchResult(group: ProductGroupWithOffers): SearchResult {
  // En iyi teklif = en düşük TOPLAM maliyet (ürün + kargo) — SQL ile aynı kural.
  const best = [...group.offers].sort((a, b) => a.totalCostCents - b.totalCostCents)[0];

  return {
    groupId: group.id,
    slug: group.slug,
    title: group.title,
    // Grubun kendi para birimi -- demo yolunda da varsayim YAPILMAZ.
    currency: group.currency,
    brand: group.brand,
    imageUrl: group.imageUrl,
    offerCount: group.offerCount,
    minPriceCents: group.minPriceCents,
    maxPriceCents: group.maxPriceCents,
    bestOfferId: best?.id ?? null,
    // En ucuz teklif bir ortak mağazaya aitse `vendor` boştur; satıcı adını
    // iki türden hangisi olursa olsun tek yerden çözen yardımcıyla okuyoruz.
    // Aksi halde affiliate teklifleri kartta isimsiz görünür.
    bestVendorId: best?.vendorId ?? best?.merchantId ?? null,
    bestVendorName: best ? offerSellerName(best) : null,
  };
}

/** Yazarken tamamlama önerisi. */
export interface SearchSuggestion {
  suggestion: string;
  kind: 'marka' | 'kategori' | 'urun';
  slug: string | null;
  resultCount: number;
}

/**
 * Arama önerileri.
 *
 * Hata FIRLATMAZ. Öneri şeridi aramanın kendisi değil, ona giden kısayoldur;
 * alınamadığında kullanıcı yazmaya devam edip Enter'a basabilmelidir. Bir
 * öneri isteğinin başarısızlığı yüzünden arama kutusunu bozmak, sağladığı
 * kolaylıktan çok daha pahalıya mal olur.
 */
export async function getSearchSuggestions(
  query: string,
  limit = 8,
): Promise<SearchSuggestion[]> {
  const trimmed = query.trim();
  // Tek harf için öneri anlamsız: neredeyse tüm katalog eşleşir.
  if (trimmed.length < 2) return [];

  const supabase = createAnonClient();
  if (!supabase) return demoSuggestions(trimmed, limit);

  const { data, error } = await supabase.rpc('search_suggestions', {
    p_query: trimmed,
    p_limit: limit,
  });

  if (error) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'Öneriler alınamadı', error: error.message }),
    );
    return [];
  }

  return (data ?? []).map(
    (row: Record<string, unknown>): SearchSuggestion => ({
      suggestion: String(row.suggestion),
      kind: row.kind as SearchSuggestion['kind'],
      slug: row.slug ? String(row.slug) : null,
      resultCount: Number(row.result_count),
    }),
  );
}

/**
 * Demo modu önerileri — SQL'deki search_suggestions ile aynı sırayı izler:
 * marka, kategori, ürün. Sonuç vermeyen öneri gösterilmez.
 */
function demoSuggestions(query: string, limit: number): SearchSuggestion[] {
  const q = normalize(query);
  const out: SearchSuggestion[] = [];

  // 1) Markalar
  const brandCounts = new Map<string, number>();
  for (const group of demoProductGroups) {
    if (!group.brand) continue;
    if (!normalize(group.brand).includes(q)) continue;
    brandCounts.set(group.brand, (brandCounts.get(group.brand) ?? 0) + 1);
  }
  for (const [brand, count] of brandCounts) {
    out.push({ suggestion: brand, kind: 'marka', slug: null, resultCount: count });
  }

  // 2) Kategoriler
  for (const category of demoCategories) {
    if (!normalize(category.name).includes(q)) continue;
    const count = demoProductGroups.filter((group) => group.categoryId === category.id).length;
    if (count > 0) {
      out.push({
        suggestion: category.name,
        kind: 'kategori',
        slug: category.slug,
        resultCount: count,
      });
    }
  }

  // 3) Ürünler
  for (const group of demoProductGroups) {
    if (!normalize(`${group.title} ${group.brand ?? ''}`).includes(q)) continue;
    out.push({
      suggestion: group.title,
      kind: 'urun',
      slug: group.slug,
      resultCount: group.offerCount,
    });
  }

  // Baştan eşleşen, içinde geçenden önce gelir — SQL tarafındaki sıralamayla aynı.
  return out
    .sort((a, b) => {
      const rank = (value: string) => (normalize(value).startsWith(q) ? 0 : 1);
      return rank(a.suggestion) - rank(b.suggestion) || b.resultCount - a.resultCount;
    })
    .slice(0, limit);
}

/**
 * Barkoda (GTIN) göre kanonik ürün araması.
 *
 * Barkod, ürün eşleştirmesinin EN GÜVENİLİR sinyalidir: küresel olarak
 * benzersizdir ve yazım farkından etkilenmez. Kamerayla okunan bir barkod bu
 * yüzden metin aramasına çevrilmez, doğrudan burada aranır — "Sony WH-1000XM5"
 * yazıp yanlış modeli bulma ihtimali ortadan kalkar.
 *
 * Bulunamazsa hata değil `null` döner: bilinmeyen bir barkod, kataloğumuzda
 * o ürünün henüz olmaması demektir; kullanıcıya normal arama önerilir.
 */
export async function findGroupByGtin(
  gtin: string,
): Promise<{ slug: string; title: string } | null> {
  const supabase = createAnonClient();

  if (supabase) {
    const { data, error } = await supabase
      .from('product_groups')
      .select('slug, title')
      .eq('gtin', gtin)
      .maybeSingle();

    if (error) throw new Error(`Barkod aranamadı: ${error.message}`);
    if (!data) return null;

    return { slug: String(data.slug), title: String(data.title) };
  }

  // Demo veri kümesinde barkod alanı yok; UYDURULMAZ da. Barkod araması
  // yalnızca gerçek katalogda anlamlıdır, bu yüzden demo modunda "bulunamadı"
  // döner ve arayüz kullanıcıyı metin aramasına yönlendirir.
  return null;
}

// ---------------------------------------------------------------------------
// Ürün detayı
// ---------------------------------------------------------------------------
async function urunGrubunuOku(slug: string): Promise<ProductGroupWithOffers | null> {
  const supabase = createAnonClient();

  if (supabase) {
    const { data, error } = await supabase
      .from('product_groups')
      .select(
        `id, slug, title, brand, gtin, image_url, description, category_id, attributes,
         offer_count, min_price_cents, max_price_cents, rating, rating_count,
         offers:products!group_id (
           id, fulfillment, vendor_id, merchant_id, product_url,
           title, sku, image_urls, price_cents, compare_at_price_cents,
           currency, stock, condition, shipping_fee_cents, free_shipping_threshold_cents,
           estimated_delivery_days, status,
           vendor:vendors!vendor_id ( id, slug, display_name, logo_url, rating ),
           merchant:merchants ( id, slug, display_name, logo_url, homepage_url )
         )`,
      )
      .eq('slug', slug)
      .eq('offers.status', 'active')
      .maybeSingle();

    if (error) throw new Error(`Ürün okunamadı: ${error.message}`);
    if (!data) return null;

    const offers = ((data.offers as Record<string, unknown>[] | null) ?? [])
      .map((row): Offer => {
        const vendor = unwrapRelation(row.vendor);
        const merchant = unwrapRelation(row.merchant);

        const priceCents = Number(row.price_cents);
        const shippingFeeCents = Number(row.shipping_fee_cents);

        return {
          id: String(row.id),
          fulfillment: (row.fulfillment as Offer['fulfillment']) ?? 'marketplace',

          vendorId: row.vendor_id ? String(row.vendor_id) : null,
          vendor: vendor
            ? {
                id: String(vendor.id),
                slug: String(vendor.slug),
                displayName: String(vendor.display_name),
                logoUrl: vendor.logo_url ? String(vendor.logo_url) : null,
                rating: Number(vendor.rating),
              }
            : null,

          merchantId: row.merchant_id ? String(row.merchant_id) : null,
          merchant: merchant
            ? {
                id: String(merchant.id),
                slug: String(merchant.slug),
                displayName: String(merchant.display_name),
                logoUrl: merchant.logo_url ? String(merchant.logo_url) : null,
                homepageUrl: String(merchant.homepage_url),
                rating: null,
              }
            : null,
          productUrl: row.product_url ? String(row.product_url) : null,

          title: String(row.title),
          sku: row.sku ? String(row.sku) : null,
          imageUrls: (row.image_urls as string[] | null) ?? [],
          priceCents,
          compareAtPriceCents:
            row.compare_at_price_cents === null ? null : Number(row.compare_at_price_cents),
          /*
           * TEKLIFIN GERCEK PARA BIRIMI.
           *
           * Burada `'TRY' as const` SABIT yaziliydi ve asil hata buydu:
           * sorgu `currency` kolonunu ZATEN cekiyordu ama esleme onu
           * tamamen yok sayiyordu. Sonuc: GBP fiyatlar urun sayfasinda
           * `₺` ile basiliyor, JSON-LD'de `priceCurrency: "TRY"` gidiyordu.
           *
           * Bu satir, `SearchResult`/`ProductGroup` tiplerine para birimi
           * eklenmesinden BAGIMSIZ bir hataydi: o tipler duzeltildikten
           * sonra bile urun detay sayfasi TRY gostermeye devam etti ve
           * sebebi burasiydi.
           */
          currency: row.currency ? String(row.currency).trim() : 'TRY',
          stock: Number(row.stock),
          condition: row.condition as 'new' | 'refurbished' | 'used',
          shippingFeeCents,
          freeShippingThresholdCents:
            row.free_shipping_threshold_cents === null
              ? null
              : Number(row.free_shipping_threshold_cents),
          estimatedDeliveryDays: Number(row.estimated_delivery_days),
          status: row.status as 'draft' | 'active' | 'out_of_stock' | 'archived',
          totalCostCents: priceCents + shippingFeeCents,
        };
      })
      .sort((a, b) => a.totalCostCents - b.totalCostCents);

    return {
      id: String(data.id),
      slug: String(data.slug),
      title: String(data.title),
      brand: data.brand ? String(data.brand) : null,
      gtin: data.gtin ? String(data.gtin) : null,
      imageUrl: data.image_url ? String(data.image_url) : null,
      description: data.description ? String(data.description) : null,
      categoryId: data.category_id ? String(data.category_id) : null,
      attributes: (data.attributes as Record<string, string> | null) ?? {},
      offerCount: Number(data.offer_count),
      rating: Number(data.rating ?? 0),
      ratingCount: Number(data.rating_count ?? 0),
      minPriceCents: data.min_price_cents === null ? null : Number(data.min_price_cents),
      maxPriceCents: data.max_price_cents === null ? null : Number(data.max_price_cents),
      /*
       * GERCEK para birimi -- grubun TEKLIFLERINDEN turetilir.
       *
       * Onceki hal bunu HIC tasimiyordu, dolayisiyla gosterim katmani
       * `formatMoney`'nin TRY varsayilanina dusuyordu: GBP fiyatlar `₺` ile
       * basiliyor ve fiyat ~44 kat dusuk gorunuyordu.
       *
       * `product_groups.price_currency` kullanilmadi: uretimde var ama depo
       * goclerinde yok (bkz. searchProducts'taki ayrintili gerekce).
       * `products.currency` hem depoda tanimli hem daha dogru -- gosterilen
       * tutarin kaynagi teklifin kendisi.
       */
      currency: offers[0]?.currency ?? 'TRY',
      offers,
    };
  }

  const group = demoProductGroups.find((candidate) => candidate.slug === slug);
  if (!group) return null;

  return {
    ...group,
    offers: [...group.offers].sort((a, b) => a.totalCostCents - b.totalCostCents),
  };
}

// ---------------------------------------------------------------------------
// Kampanyalar, kategoriler, taşeronlar
// ---------------------------------------------------------------------------
async function kampanyalariOku(limit = 3): Promise<FlashDeal[]> {
  const supabase = createAnonClient();

  if (supabase) {
    const { data, error } = await supabase
      .from('flash_deals')
      .select(
        `id, product_id, headline, deal_price_cents, stock_limit, sold_count, ends_at,
         product:products (
           title, price_cents, image_urls, group_id, currency,
           vendor:vendors!vendor_id ( display_name ),
           group:product_groups!group_id ( slug )
         )`,
      )
      .lte('starts_at', new Date().toISOString())
      .gte('ends_at', new Date().toISOString())
      .order('priority', { ascending: false })
      .limit(limit);

    if (error) {
      /*
       * KESİNTİDE DEMO VERİYE DÜŞÜLMEZ.
       *
       * Buradaki eski hâli `demoFlashDeals`e düşüyordu ve bu, katalogdaki
       * BÜTÜN diğer okumalardan farklıydı (hepsi throw eder). Sonuç:
       * gerçek bir Supabase kesintisinde ana sayfa UYDURMA kampanya
       * fiyatları gösterirdi -- hem de "indirim" iddiasıyla.
       *
       * Fırsat şeridi vitrinin süsü; sayfanın gövdesi değil. Bu yüzden
       * hata yukarı fırlatılır ve çağıran taraf şeridi hiç çizmez.
       * Boş bir şerit, uydurma bir indirimden iyidir.
       */
      throw new Error(`Kampanyalar okunamadı: ${error.message}`);
    }

    return (data ?? []).map((row: Record<string, unknown>): FlashDeal => {
      const rawProduct = row.product;
      const product = (Array.isArray(rawProduct) ? rawProduct[0] : rawProduct) as
        | Record<string, unknown>
        | null;

      const rawVendor = product?.vendor;
      const vendor = (Array.isArray(rawVendor) ? rawVendor[0] : rawVendor) as
        | Record<string, unknown>
        | null;

      const rawGroup = product?.group;
      const group = (Array.isArray(rawGroup) ? rawGroup[0] : rawGroup) as
        | Record<string, unknown>
        | null;

      return {
        id: String(row.id),
        productId: String(row.product_id),
        groupSlug: group?.slug ? String(group.slug) : null,
        headline: String(row.headline),
        title: product?.title ? String(product.title) : 'Ürün',
        imageUrl: (product?.image_urls as string[] | null)?.[0] ?? null,
        originalPriceCents: product?.price_cents ? Number(product.price_cents) : 0,
        dealPriceCents: Number(row.deal_price_cents),
        // Urunun KENDI para birimi; sabit TRY varsayimi kaldirildi.
        currency: product?.currency ? String(product.currency).trim() : 'TRY',
        stockLimit: row.stock_limit === null ? null : Number(row.stock_limit),
        soldCount: Number(row.sold_count),
        vendorName: vendor?.display_name ? String(vendor.display_name) : null,
        endsAt: String(row.ends_at),
      };
    });
  }

  return demoFlashDeals.slice(0, limit);
}

/**
 * Etkin kategorilerin TAMAMI -- alt kategoriler DAHİL.
 *
 * ÖNCEDEN `.is('parent_id', null)` FİLTRESİ VARDI ve bu sessiz bir hataydı:
 * kategori sayfası gelen adresi bu listede arıyor, bulamazsa `notFound()`
 * çağırıyor. Yani `/kategori/bilgisayar` 404 dönüyordu -- oysa ölçüm o
 * kategoride 32.894 grup olduğunu söylüyor, kataloğun neredeyse tamamı.
 * Üç alt kategori (telefon, bilgisayar, kulaklık) toplam 34.249 grupla
 * erişilemez durumdaydı.
 *
 * Menüler düz liste istemiyor; onlar için `getCategoryTree()` var. Burası
 * ham gerçeği döndürür: hangi kategoriler etkin.
 */
async function kategorileriOku(): Promise<Category[]> {
  const supabase = createAnonClient();

  if (supabase) {
    const { data, error } = await supabase
      .from('categories')
      .select('id, parent_id, slug, name, icon')
      .eq('is_active', true)
      .order('sort_order');

    if (error) throw new Error(`Kategoriler okunamadı: ${error.message}`);

    return (data ?? []).map((row) => ({
      id: String(row.id),
      parentId: row.parent_id ? String(row.parent_id) : null,
      slug: String(row.slug),
      name: String(row.name),
      icon: row.icon ? String(row.icon) : null,
    }));
  }

  return demoCategories;
}

/**
 * Bu kategoride gösterilecek ÜRÜN VAR MI?
 *
 * Kapsam ürün aramasıyla AYNI: kendi kategorisi VE alt kategorileri
 * (`search_products` de öyle yapıyor). Farklı kapsam kullansaydık sayfa
 * ürün gösterirken meta veri "boş" diyebilirdi.
 *
 * Sayı değil, VARLIK sorusu: `limit(1)` ile ilk eşleşmede duruyor. Tam
 * sayıya ihtiyaç yok ve 32.894 satırlık bir kategoriyi baştan sona saymanın
 * bedeli bu soru için gereksiz.
 */
async function kategoriDoluMuOku(categoryId: string): Promise<boolean> {
  const supabase = createAnonClient();

  if (!supabase) {
    return demoProductGroups.some(
      (grup) => grup.categoryId === categoryId && grup.offerCount > 0,
    );
  }

  const { data: cocuklar } = await supabase
    .from('categories')
    .select('id')
    .eq('parent_id', categoryId)
    .eq('is_active', true);

  const kapsam = [categoryId, ...(cocuklar ?? []).map((c) => String(c.id))];

  const { data, error } = await supabase
    .from('product_groups')
    .select('id')
    .in('category_id', kapsam)
    .gt('offer_count', 0)
    .limit(1);

  /*
   * Okunamadıysa DOLU varsayılır. Yanılma bedelleri eşit değil: boş sanıp
   * `noindex` vermek, dolu bir kategoriyi dizinden çıkarmak olurdu; dolu
   * sanmanın bedeli ise yalnızca boş bir sayfanın dizine girmesi.
   */
  if (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Kategori dolulugu okunamadi',
        kategori: categoryId,
        hata: error.message,
      }),
    );
    return true;
  }

  return (data ?? []).length > 0;
}

/**
 * Gezinilebilir kategori ağacı: boş dallar elenmiş, sayılar ÖLÇÜLMÜŞ.
 *
 * NEDEN SAYIM GEREKLİ
 * Altı üst kategorinin dördü (moda, spor-outdoor, kozmetik, süpermarket)
 * bugün tamamen boş -- ölçüldü. Menüde durmaları, kullanıcıyı hiçbir ürün
 * olmayan bir sayfaya göndermek demek. Hangisinin boş olduğu veriye bakmadan
 * bilinemez ve yarın değişir; o yüzden sabit bir liste değil, sayım.
 *
 * MALİYET ÖLÇÜLDÜ. Kategori başına bir `count` isteği ~20 ms (sayım
 * `product_groups` üzerinde tek geçiş). Dokuz kategori PARALEL gidiyor,
 * yani tek gidiş-dönüş. Alternatif olan `search_facets` RPC'si tek çağrı
 * ama 530 ms sürüyor (ölçüldü) ve yalnızca ÜST kategorileri sayıyor --
 * alt kategori sayıları olmadan ağaç kurulamaz.
 */
async function kategoriAgaciniOku(): Promise<CategoryNode<Category>[]> {
  const kategoriler = await getCategories();
  if (kategoriler.length === 0) return [];

  const supabase = createAnonClient();

  if (!supabase) {
    // Demo kümesinde grup sayısı yerel olarak sayılabiliyor.
    const sayimlar = new Map<string, number>();
    for (const grup of demoProductGroups) {
      if (!grup.categoryId || grup.offerCount === 0) continue;
      sayimlar.set(grup.categoryId, (sayimlar.get(grup.categoryId) ?? 0) + 1);
    }
    return buildCategoryTree(kategoriler, sayimlar);
  }

  const sayimlar = new Map<string, number>();
  await Promise.all(
    kategoriler.map(async (kategori) => {
      const { count, error } = await supabase
        .from('product_groups')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', kategori.id)
        .gt('offer_count', 0);

      if (error) {
        /*
         * Sayılamayan kategori SIFIR sayılmaz -- bu, ulaşılamayan bir
         * kategoriyi "boş" ilan edip menüden düşürmek olurdu. Bilinmeyen
         * yerine 1 yazmak da uydurma olurdu; kategori listede kalsın diye
         * gerçek sayının bilinmediği açıkça loglanıyor ve kategori
         * görünür bırakılıyor.
         */
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'Kategori grup sayisi okunamadi',
            kategori: kategori.slug,
            hata: error.message,
          }),
        );
        sayimlar.set(kategori.id, 1);
        return;
      }

      sayimlar.set(kategori.id, count ?? 0);
    }),
  );

  return buildCategoryTree(kategoriler, sayimlar);
}

async function tasoronlariOku(): Promise<Vendor[]> {
  const supabase = createAnonClient();

  if (supabase) {
    const { data, error } = await supabase
      .from('vendors')
      .select(
        `id, slug, display_name, description, logo_url, status,
         commission_rate, rating, rating_count, active_product_count`,
      )
      .eq('status', 'approved')
      .order('rating', { ascending: false });

    if (error) throw new Error(`Taşeronlar okunamadı: ${error.message}`);

    return (data ?? []).map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      displayName: String(row.display_name),
      description: row.description ? String(row.description) : null,
      logoUrl: row.logo_url ? String(row.logo_url) : null,
      status: 'approved' as const,
      commissionRate: Number(row.commission_rate),
      rating: Number(row.rating),
      ratingCount: Number(row.rating_count),
      activeProductCount: Number(row.active_product_count),
    }));
  }

  return demoVendors;
}

/** Favori listesinin güncel fiyatları için sade bir kayıt. */
export interface ProductPrice {
  slug: string;
  title: string;
  imageUrl: string | null;
  minPriceCents: number | null;
  offerCount: number;
  /**
   * Fiyatin GERCEK para birimi; bilinmiyorsa TANIMSIZ.
   *
   * Opsiyonel olmasi bilincli: cagiran taraf (FavoritesList) para birimi
   * bilinmeyen kayitta fiyati HIC gostermiyor. Varsayilana dusmek GBP
   * fiyati `₺` ile basmak olurdu.
   */
  currency?: string;
}

/**
 * Verilen adreslerin GÜNCEL fiyatları.
 *
 * Favori listesi tarayıcıda tutulduğu için sunucu kimin neyi kaydettiğini
 * bilmez; liste sayfası elindeki adresleri sorar. Tek sorguda hepsi
 * okunur — ürün başına bir istek, 40 favorisi olan kullanıcıda 40 gidiş
 * dönüş demek olurdu.
 *
 * Bulunamayan adres sessizce atlanır: katalogdan kalkmış bir ürün, favori
 * sayfasını bozmamalı.
 */
export async function getProductPrices(slugs: string[]): Promise<ProductPrice[]> {
  if (slugs.length === 0) return [];

  const supabase = createAnonClient();

  if (supabase) {
    const { data, error } = await supabase
      .from('product_groups')
      .select('id, slug, title, image_url, min_price_cents, offer_count')
      .in('slug', slugs);

    if (error) throw new Error(`Fiyatlar okunamadı: ${error.message}`);

    const satirlar = data ?? [];

    /*
     * PARA BIRIMI: gruptaki aktif teklifin birimi.
     *
     * Bu uc favori listesini besliyor ve fiyat GOSTERIYOR; para birimi
     * olmadan `formatMoney` TRY varsayilanina duser ve GBP fiyat `₺` ile
     * basilir. Kaynak `products.currency` -- `product_groups.price_currency`
     * DEGIL, cunku o sutun depo goclerinde yok (bkz. searchProducts).
     *
     * Slug sayisi favori listesi kadar (onlarca), yani tek ek sorgu ucuz.
     */
    const birimler = new Map<string, string>();
    if (satirlar.length > 0) {
      const { data: paraSatirlari } = await supabase
        .from('products')
        .select('group_id, currency')
        .in('group_id', satirlar.map((row) => String(row.id)))
        .eq('status', 'active');

      for (const satir of paraSatirlari ?? []) {
        const grup = String(satir.group_id);
        if (satir.currency && !birimler.has(grup)) {
          birimler.set(grup, String(satir.currency).trim());
        }
      }
    }

    return satirlar.map((row) => ({
      slug: String(row.slug),
      title: String(row.title),
      imageUrl: row.image_url ? String(row.image_url) : null,
      minPriceCents: row.min_price_cents === null ? null : Number(row.min_price_cents),
      offerCount: Number(row.offer_count),
      // Bilinmiyorsa ALAN YOK: cagiran taraf fiyati hic gostermez.
      currency: birimler.get(String(row.id)),
    }));
  }

  return demoProductGroups
    .filter((group) => slugs.includes(group.slug))
    .map((group) => ({
      slug: group.slug,
      title: group.title,
      imageUrl: group.imageUrl,
      minPriceCents: group.minPriceCents,
      offerCount: group.offerCount,
      currency: group.currency,
    }));
}

/**
 * Bir mağazayı adresinden (slug) okur.
 *
 * Onaylı OLMAYAN mağaza null döner: başvurusu bekleyen ya da askıya alınmış
 * bir mağazanın vitrini herkese açık olmamalı. Aksi hâlde reddedilmiş bir
 * başvurunun sayfası dizinde kalırdı.
 */
export async function getVendorBySlug(slug: string): Promise<Vendor | null> {
  const supabase = createAnonClient();

  if (supabase) {
    const { data, error } = await supabase
      .from('vendors')
      .select(
        `id, slug, display_name, description, logo_url, status,
         commission_rate, rating, rating_count, active_product_count`,
      )
      .eq('slug', slug)
      .eq('status', 'approved')
      .maybeSingle();

    if (error) throw new Error(`Mağaza okunamadı: ${error.message}`);
    if (!data) return null;

    return {
      id: String(data.id),
      slug: String(data.slug),
      displayName: String(data.display_name),
      description: data.description ? String(data.description) : null,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      status: 'approved' as const,
      commissionRate: Number(data.commission_rate),
      rating: Number(data.rating),
      ratingCount: Number(data.rating_count),
      activeProductCount: Number(data.active_product_count),
    };
  }

  return demoVendors.find((vendor) => vendor.slug === slug) ?? null;
}

/**
 * Bir mağazanın vitrini.
 *
 * `search_products` üzerinden GEÇMEZ: o fonksiyon kanonik ürün bazında
 * çalışır ve mağaza filtresi yoktur. Burada mağazanın KENDİ tekliflerinden
 * yola çıkılır — sayfa "bu mağazada neler var" sorusunu yanıtlar.
 *
 * Aynı kanonik ürüne birden çok teklifi olsa bile ürün bir kez listelenir;
 * vitrinde aynı ürünün iki kez görünmesi kataloğu bozuk gösterir.
 */
export async function getVendorProducts(
  vendorId: string,
  options: { limit: number; offset: number },
): Promise<StorePage> {
  return magazaUrunleri('vendor_id', vendorId, options, (offer) => offer.vendorId === vendorId);
}

/**
 * Bir ORTAK MAĞAZANIN vitrinindeki ürünler.
 *
 * Taşeron sürümüyle tek farkı süzülen sütun: `merchant_id`. Gövdeyi
 * kopyalamak yerine ortak yardımcıya veriliyor -- iki kopya, para birimi
 * ya da sayfalama düzeltmesi birine uygulanıp diğerine unutulduğunda
 * sessizce ayrışırdı.
 */
export async function getMerchantProducts(
  merchantId: string,
  options: { limit: number; offset: number },
): Promise<StorePage> {
  return magazaUrunleri(
    'merchant_id',
    merchantId,
    options,
    (offer) => offer.merchantId === merchantId,
  );
}

async function magazaUrunleri(
  sutun: 'vendor_id' | 'merchant_id',
  kimlik: string,
  options: { limit: number; offset: number },
  demoEslesme: (offer: Offer) => boolean,
): Promise<StorePage> {
  const supabase = createAnonClient();

  if (!supabase) {
    const results = demoProductGroups
      .filter((group) => group.offers.some(demoEslesme))
      .map(toSearchResult);

    return {
      results: results.slice(options.offset, options.offset + options.limit),
      totalCount: results.length,
      hasMore: results.length > options.offset + options.limit,
    };
  }

  /*
   * SAYIM AYRI VE PARALEL İSTEKTE.
   *
   * Eskiden `{ count: 'exact' }` ürün sorgusuyla aynı isteğe gömülüydü.
   * İkisi tek bir SQL ifadesi olduğu için 8 sn'lik bütçeyi PAYLAŞIYORLARDI:
   * satırlar 10 ms sürse bile sayım (35.742 satırlık tam tarama, ~1,3 sn
   * sıcak) soğuk istekte bütçeyi aşıyor ve İFADENİN TAMAMI iptal ediliyordu
   * -- yani gösterilebilecek 24 ürün de gidiyordu. Üretimde yaşandı.
   *
   * Ayrılınca her biri kendi bütçesine sahip oluyor ve sayım düşse bile
   * ürünler geliyor.
   *
   * BİR FAZLA SATIR isteniyor: sonraki sayfanın var olup olmadığı sayımdan
   * bağımsız olarak böyle biliniyor. Fazladan satır kullanıcıya gösterilmez.
   */
  const [urunCevabi, sayimCevabi] = await Promise.all([
    supabase
      .from('products')
      .select(
        `price_cents, shipping_fee_cents, currency,
         group:product_groups!group_id (
           id, slug, title, brand, image_url, offer_count,
           min_price_cents, max_price_cents, best_offer_id
         )`,
      )
      .eq(sutun, kimlik)
      .eq('status', 'active')
    /*
     * SIRALAMA `external_id` -- eskiden `updated_at desc` idi ve iki ayrı
     * sorunu vardı.
     *
     * 1) SAYFALAMA BOZUKTU. Toplu besleme binlerce teklifi aynı anda
     *    güncelliyor: 35.742 satır yalnızca 235 farklı `updated_at` değeri
     *    paylaşıyor, ortalama eşitlik kümesi 152 satır (ölçüldü). Eşit
     *    değerler arasında PostgreSQL'in garanti ettiği bir sıra YOKTUR;
     *    sayfa başına 24 kayıtla tek bir küme 6-7 sayfaya yayılıyor ve
     *    kullanıcı aynı ürünü iki sayfada görüp bir başkasını hiç
     *    görmeyebiliyordu. Sessiz bir hata: kimse fark etmez.
     *
     * 2) HER İSTEKTE TABLO BAŞTAN SONA TARANIYORDU. `updated_at` için
     *    (mağaza, zaman) bileşik dizini yok, dolayısıyla 24 satır almak
     *    35.742 satırı tarayıp sıralamayı gerektiriyordu -- ölçüldü:
     *    3.741 ms, ve soğuk istekte 8 sn'lik ifade zaman aşımına takılıp
     *    sayfayı hata ekranına düşürüyordu (üretim log'uyla doğrulandı).
     *
     * `external_id` ikisini birden çözüyor çünkü her iki mağaza türü için
     * de bileşik TEKİL dizin ZATEN VAR:
     *
     *     products_merchant_external_unique  (merchant_id, external_id)
     *     products_vendor_external_id_key    (vendor_id,   external_id)
     *
     * Tekil olduğu için eşitlik yok -- sayfalama kararlı. Dizinin sıralaması
     * sorgunun sıralamasıyla aynı olduğu için sıralama adımı tamamen düşüyor:
     * aynı sorgu 10 ms (ölçüldü), yani 374 kat hızlı. Şema değişmedi.
     *
     * `external_id` mağazanın kendi ürün kimliği: ziyaretçi için anlamı yok
     * ama vitrin sırası zaten anlamlı değildi (bütün ürünler aynı anda
     * güncellenmiş). Anlamlı bir sıra istenirse -- fiyat, popülerlik --
     * o ayrı bir karar ve kendi dizinini gerektirir.
     */
      .order('external_id')
      .range(options.offset, options.offset + options.limit),

    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq(sutun, kimlik)
      .eq('status', 'active'),
  ]);

  const { data, error } = urunCevabi;
  if (error) throw new Error(`Mağaza ürünleri okunamadı: ${error.message}`);

  if (sayimCevabi.error) {
    /*
     * Sayım DÜŞEBİLİR ve bu sayfayı düşürmez. Bilinmeyen sayı `null`
     * kalıyor; arayüz o rakamı hiç yazmıyor. Tahmini bir sayı basmak,
     * ölçmediğimiz bir şeyi ölçmüş gibi göstermek olurdu.
     */
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Magaza urun sayisi okunamadi',
        sutun,
        hata: sayimCevabi.error.message,
      }),
    );
  }

  const satirlar = data ?? [];
  const hasMore = satirlar.length > options.limit;
  const gosterilecek = hasMore ? satirlar.slice(0, options.limit) : satirlar;

  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const row of gosterilecek) {
    const group = unwrapRelation((row as Record<string, unknown>).group);
    if (!group) continue;

    const groupId = String(group.id);
    if (seen.has(groupId)) continue;
    seen.add(groupId);

    results.push({
      groupId,
      slug: String(group.slug),
      title: String(group.title),
      // Satici sayfasinda teklif satiri zaten elde: onun para birimi.
      currency: (row as Record<string, unknown>).currency
        ? String((row as Record<string, unknown>).currency).trim()
        : 'TRY',
      brand: group.brand ? String(group.brand) : null,
      imageUrl: group.image_url ? String(group.image_url) : null,
      offerCount: Number(group.offer_count),
      minPriceCents: group.min_price_cents === null ? null : Number(group.min_price_cents),
      maxPriceCents: group.max_price_cents === null ? null : Number(group.max_price_cents),
      bestOfferId: group.best_offer_id ? String(group.best_offer_id) : null,
      // Vitrin sayfasında "en iyi satıcı" bilgisi anlamsız: zaten o mağazanın
      // sayfasındayız. Kart bunu göstermez.
      bestVendorId: null,
      bestVendorName: null,
    });
  }

  return {
    results,
    totalCount: sayimCevabi.error ? null : (sayimCevabi.count ?? null),
    hasMore,
  };
}

/**
 * Bir mağaza vitrininin tek sayfası.
 *
 * `totalCount` NULL OLABİLİR ve bu bilinçli. Toplam sayı, 35.742 satırlık
 * bir mağazada tabloyu baştan sona saymayı gerektiriyor (~1,3 sn sıcak,
 * ölçüldü) ve soğuk istekte 8 sn'lik ifade zaman aşımına takılabiliyor.
 * Eskiden sayım ürün sorgusuyla AYNI istekte gidiyordu, dolayısıyla sayım
 * düştüğünde SAYFANIN TAMAMI hata ekranına düşüyordu -- üretimde yaşandı.
 *
 * Artık ikisi ayrı ve paralel: ürünler her hâlükârda geliyor, sayı
 * gelemezse `null` kalıyor ve arayüz o rakamı hiç yazmıyor. Yardımcı bir
 * sayının sayfayı düşürmesi, gösterilebilecek 24 ürünü gösterememek demek.
 *
 * `hasMore` sayımdan BAĞIMSIZ: bir fazla satır istenip gelip gelmediğine
 * bakılıyor. Böylece sayı bilinmese de "sonraki sayfa" doğru çalışıyor.
 */
export interface StorePage {
  results: SearchResult[];
  /** Toplam ürün; SAYILAMADIYSA null -- tahmin edilmez. */
  totalCount: number | null;
  /** Bu sayfadan sonrası var mı. */
  hasMore: boolean;
}

/**
 * Bir mağaza vitrini -- taşeron da olabilir, ortak mağaza da.
 *
 * NEDEN ORTAK BİR TİP
 * `/magaza/[slug]` rotası yalnızca `vendors` tablosunu okuyordu. O tablo
 * üretimde BOŞ (0 satır, ölçüldü); kataloğun tamamını sağlayan ortak
 * mağazanın (Back to the Office, 35.742 aktif teklif) hiç sayfası yoktu ve
 * `/magaza/back-to-the-office` 404 dönüyordu. İki tablo aynı sayfayı
 * besleyebilir ama alanları farklı; ortak tip farkı TİPTE tutuyor,
 * sayfanın içine `if (merchant)` serpiştirmek yerine.
 */
export interface StoreProfile {
  /** Hangi tablodan geldiği. Sayfa bunu göstermez, sorgular kullanır. */
  kind: 'vendor' | 'merchant';
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  /**
   * Puan ve oy sayısı. Ortak mağazalarda HER ZAMAN 0/0 olur: onların
   * puanını biz toplamıyoruz ve ağdan gelen bir puan da yok. Sayfa zaten
   * `ratingCount > 0` değilse puanı hiç çizmiyor, dolayısıyla sıfır burada
   * "puan yok" demek -- "kötü mağaza" değil.
   */
  rating: number;
  ratingCount: number;
}

/**
 * Adrese göre mağaza: önce taşeron, sonra ortak mağaza.
 *
 * SIRA ÖNEMLİ VE SABİT. İki tabloda aynı adres bulunabilir; taşeronu önce
 * denemek kararı belirli kılıyor. Rastgele ya da "hangisi önce dönerse"
 * davranışı, aynı adresin bazen bir mağazayı bazen diğerini göstermesi
 * demek olurdu.
 */
async function magazayiOku(slug: string): Promise<StoreProfile | null> {
  const tasoron = await getVendorBySlug(slug);
  if (tasoron) {
    return {
      kind: 'vendor',
      id: tasoron.id,
      slug: tasoron.slug,
      displayName: tasoron.displayName,
      description: tasoron.description,
      logoUrl: tasoron.logoUrl,
      rating: tasoron.rating,
      ratingCount: tasoron.ratingCount,
    };
  }

  const supabase = createAnonClient();

  if (!supabase) {
    const magaza = demoMerchants.find((m) => m.slug === slug);
    if (!magaza) return null;
    return {
      kind: 'merchant',
      id: magaza.id,
      slug: magaza.slug,
      displayName: magaza.displayName,
      description: null,
      logoUrl: magaza.logoUrl,
      rating: 0,
      ratingCount: 0,
    };
  }

  /*
   * `description` SEÇİLMİYOR: anon rolüne o sütunun okuma izni verilmemiş
   * (ölçüldü -- izin verilen sütunlar id, slug, display_name, homepage_url,
   * logo_url, country_code, network, status, created_at, updated_at).
   * İstemek sorgunun tamamını düşürürdü.
   *
   * `status = 'active'` filtresi satır güvenliğinin zaten zorladığı şeyi
   * açıkça yazıyor: başvurusu süren mağazanın vitrini olmaz.
   */
  const { data, error } = await supabase
    .from('merchants')
    .select('id, slug, display_name, logo_url')
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw new Error(`Magaza okunamadi: ${error.message}`);
  if (!data) return null;

  return {
    kind: 'merchant',
    id: String(data.id),
    slug: String(data.slug),
    displayName: String(data.display_name),
    description: null,
    logoUrl: data.logo_url ? String(data.logo_url) : null,
    rating: 0,
    ratingCount: 0,
  };
}

/** Bir mağazanın vitrinindeki ürünler -- taşeron ya da ortak mağaza. */
async function magazaVitriniOku(
  store: StoreProfile,
  options: { limit: number; offset: number },
): Promise<StorePage> {
  if (store.kind === 'vendor') return getVendorProducts(store.id, options);
  return getMerchantProducts(store.id, options);
}

/**
 * Site haritasına girecek ortak mağazalar.
 *
 * Teklifi olmayan mağaza listelenmez: ürünsüz bir vitrin ince içeriktir ve
 * tarama bütçesini boşa harcar.
 *
 * SAYI DEĞİL VARLIK SORULUYOR. İlk hâli mağaza başına `count: 'exact'`
 * yapıyordu ve o sayım 35.742 satırlık bir mağazada tabloyu baştan sona
 * tarıyor (~1,3 sn). Site haritası zaten 35 sayfalık ürün okuması yapıyor;
 * üstüne bu gelince mağaza sorgusu düşüyor ve harita ortak mağazaları HİÇ
 * listelemiyordu -- canlıda ölçüldü, `/magaza` girişi 0 taneydi.
 *
 * Soru aslında "kaç tane" değil "en az bir tane var mı". `limit(1)` ilk
 * eşleşmede duruyor: aynı cevap, 1,8 ms (ölçüldü) -- 750 kat ucuz.
 */
export async function getActiveMerchants(): Promise<Array<{ slug: string }>> {
  const supabase = createAnonClient();
  if (!supabase) return demoMerchants.map((m) => ({ slug: m.slug }));

  const { data, error } = await supabase
    .from('merchants')
    .select('id, slug')
    .eq('status', 'active')
    .limit(50);

  if (error) throw new Error(`Ortak magazalar okunamadi: ${error.message}`);

  const magazalar = data ?? [];
  if (magazalar.length === 0) return [];

  const sonuc = await Promise.all(
    magazalar.map(async (magaza) => {
      const { data: teklif } = await supabase
        .from('products')
        .select('id')
        .eq('merchant_id', String(magaza.id))
        .eq('status', 'active')
        .limit(1);

      return { slug: String(magaza.slug), teklifiVar: (teklif ?? []).length > 0 };
    }),
  );

  return sonuc.filter((m) => m.teklifiVar).map((m) => ({ slug: m.slug }));
}

/** Ürün sayfasındaki "Bunlara da bakın" bloğu. */
async function benzerGruplariOku(
  slug: string,
  limit = 4,
  context?: { categoryId: string | null; minPriceCents: number | null },
): Promise<SearchResult[]> {
  /*
   * ÖNCEKİ HALİ HER ÜRÜN SAYFASINDA AYNI 4 ÜRÜNÜ GÖSTERİYORDU.
   *
   * "En çok mağaza teklifi olanlar" katalog genelinde sabit bir listedir;
   * ürünle hiçbir ilgisi yoktur. Bir kulaklık sayfasında buzdolabı önermek
   * bölümü işe yaramaz kılar ve daha kötüsü, ziyaretçiye sitenin ürünü
   * anlamadığını gösterir.
   *
   * Sıralama: önce AYNI KATEGORİ, sonra BENZER FİYAT BANDI. İkisi birlikte
   * "bunun yerine şunu da alabilirim" sorusunun pratik karşılığıdır.
   */
  const categoryId = context?.categoryId ?? undefined;

  // Fiyat bandı: yarısı ile iki katı arası. Kulaklık sayfasında 200 TL'lik
  // bir kılıf da 20.000 TL'lik bir televizyon da alternatif değildir.
  const price = context?.minPriceCents ?? null;
  const minPriceCents = price ? Math.floor(price / 2) : undefined;
  const maxPriceCents = price ? price * 2 : undefined;

  // Fazladan iste: kendi kendini eleyecek ve bant dışı kalanlar olacak.
  const wanted = limit + 1;

  if (categoryId) {
    const sameBand = await searchProducts({
      categoryId,
      minPriceCents,
      maxPriceCents,
      sort: 'offers',
      limit: wanted,
    });

    const picked = sameBand.results.filter((result) => result.slug !== slug);
    if (picked.length >= limit) return picked.slice(0, limit);

    // Bant çok darsa fiyat koşulunu bırak, kategoriyi koru: aynı kategoriden
    // uzak fiyatlı bir ürün, başka kategoriden bir üründen daha alakalıdır.
    const sameCategory = await searchProducts({ categoryId, sort: 'offers', limit: wanted });
    const merged = [...picked, ...sameCategory.results].filter(
      (result) => result.slug !== slug,
    );

    const unique = [...new Map(merged.map((result) => [result.slug, result])).values()];
    if (unique.length >= limit) return unique.slice(0, limit);

    // Kategori de yetmiyorsa katalog geneliyle tamamla — bölümü boş
    // bırakmaktansa az alakalı göstermek yeğdir.
    const fallback = await searchProducts({ sort: 'offers', limit: wanted });
    const all = [...unique, ...fallback.results].filter((result) => result.slug !== slug);
    return [...new Map(all.map((result) => [result.slug, result])).values()].slice(0, limit);
  }

  const { results } = await searchProducts({ sort: 'offers', limit: wanted });
  return results.filter((result) => result.slug !== slug).slice(0, limit);
}

/**
 * Ürün grubunun günlük en düşük fiyat geçmişi.
 *
 * Demo modunda gerçek gözlem yoktur. UYDURMA GEÇMİŞ ÜRETİLMEZ: sahte bir
 * fiyat eğrisi, sitenin en güvene dayalı iddiasını ("bu indirim gerçek mi")
 * temelinden çürütür. Demo modunda boş dizi döner ve arayüz bölümü hiç
 * göstermez.
 */
async function fiyatGecmisiniOku(
  groupId: string,
  days = 90,
): Promise<PricePoint[]> {
  const supabase = createAnonClient();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc('price_history', {
    p_group_id: groupId,
    p_days: days,
  });

  if (error) {
    // Geçmiş ikincil bir bilgidir; alınamazsa ürün sayfası yine açılmalı.
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Fiyat geçmişi alınamadı',
        groupId,
        error: error.message,
      }),
    );
    return [];
  }

  return (data ?? []).map((row: { day: string; min_price_cents: number | string }) => ({
    day: String(row.day).slice(0, 10),
    minPriceCents: Number(row.min_price_cents),
  }));
}

// ---------------------------------------------------------------------------
// Değerlendirmeler
// ---------------------------------------------------------------------------

export interface ProductReview {
  id: string;
  productRating: number;
  vendorRating: number;
  title: string | null;
  body: string | null;
  createdAt: string;
  /** Yazarın görünen adı. Tam ad gösterilmez; bkz. aşağıdaki not. */
  authorLabel: string;
  vendorName: string | null;
}

/**
 * Bir kanonik ürünün yayındaki değerlendirmeleri.
 *
 * Demo modunda BOŞ döner ve uydurma yorum üretilmez. Sahte değerlendirme,
 * bu sitenin tek sermayesi olan güveni bitirir; yerleşik veri kümesinde
 * ürün ve fiyat var ama yorum yok, olmayacak da.
 */
export async function getProductReviews(
  groupId: string,
  limit = 20,
): Promise<ProductReview[]> {
  const supabase = createAnonClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('reviews')
    .select(
      `id, product_rating, vendor_rating, title, body, created_at,
       author:users!inner ( email ),
       vendor:vendors ( display_name )`,
    )
    .eq('group_id', groupId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'Değerlendirmeler alınamadı', error: error.message }),
    );
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>): ProductReview => {
    const author = unwrapRelation(row.author);
    const vendor = unwrapRelation(row.vendor);

    /*
     * Yazar adı olarak e-postanın YALNIZCA ilk harfi ve alan adı öncesi
     * kısaltması gösterilir ("a***@"). Tam e-posta göstermek, yorum yazan
     * her müşterinin adresini herkese açık hale getirirdi — hem KVKK
     * açısından savunulamaz hem de spam toplayıcılara davetiye.
     */
    const email = String(author?.email ?? '');
    const local = email.split('@')[0] ?? '';
    const authorLabel = local.length > 0 ? `${local[0]}${'*'.repeat(Math.min(local.length - 1, 4))}` : 'Müşteri';

    return {
      id: String(row.id),
      productRating: Number(row.product_rating),
      vendorRating: Number(row.vendor_rating),
      title: row.title ? String(row.title) : null,
      body: row.body ? String(row.body) : null,
      createdAt: String(row.created_at),
      authorLabel,
      vendorName: vendor?.display_name ? String(vendor.display_name) : null,
    };
  });
}

export interface ReviewableItem {
  orderItemId: string;
  groupId: string;
  vendorId: string;
  title: string;
  imageUrl: string | null;
  vendorName: string;
  productSlug: string | null;
  deliveredAt: string | null;
}

/**
 * Kullanıcının değerlendirebileceği kalemler: TESLİM EDİLMİŞ ve HENÜZ
 * DEĞERLENDİRİLMEMİŞ siparişler.
 *
 * Kullanıcının oturumuyla okunur; RLS zaten yalnızca kendi siparişlerini
 * gösterir. Burada ayrıca `user_id` süzmüyoruz — iki yerde tutulan bir
 * kural, bir yerde unutulduğunda sessizce delinir. Tek kaynak RLS.
 */
export async function getReviewableItems(): Promise<ReviewableItem[]> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('order_items')
    .select(
      `id, title_snapshot, image_url_snapshot, vendor_id,
       vendor:vendors!vendor_id ( display_name ),
       product:products!product_id ( group_id, group:product_groups!group_id ( slug ) ),
       vendor_order:vendor_orders!vendor_order_id ( status, delivered_at ),
       review:reviews ( id )`,
    )
    .eq('vendor_order.status', 'delivered')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'Değerlendirilecek siparişler alınamadı', error: error.message }),
    );
    return [];
  }

  return (data ?? [])
    .filter((row: Record<string, unknown>) => {
      // Zaten değerlendirilmiş kalem listede durmamalı: yapılacak iş gibi
      // görünüp tıklandığında reddedilen bir satır, kullanıcıyı yanıltır.
      const review = row.review;
      return Array.isArray(review) ? review.length === 0 : !review;
    })
    .map((row: Record<string, unknown>): ReviewableItem | null => {
      const vendor = unwrapRelation(row.vendor);
      const product = unwrapRelation(row.product);
      const group = product ? unwrapRelation(product.group) : null;
      const vendorOrder = unwrapRelation(row.vendor_order);

      // Ürün silinmişse grup bağı kopar; o kalem değerlendirilemez.
      if (!product?.group_id) return null;

      return {
        orderItemId: String(row.id),
        groupId: String(product.group_id),
        vendorId: String(row.vendor_id),
        title: String(row.title_snapshot),
        imageUrl: row.image_url_snapshot ? String(row.image_url_snapshot) : null,
        vendorName: String(vendor?.display_name ?? 'Mağaza'),
        productSlug: group?.slug ? String(group.slug) : null,
        deliveredAt: vendorOrder?.delivered_at ? String(vendorOrder.delivered_at) : null,
      };
    })
    .filter((item): item is ReviewableItem => item !== null);
}

/* ===========================================================================
 * ALICININ SİPARİŞLERİ
 * ---------------------------------------------------------------------------
 * Sipariş verildikten sonra alıcının gidecek hiçbir yeri yoktu: sipariş
 * geçmişi sayfası hiç yazılmamıştı. Sipariş numarası yalnızca ödeme
 * ekranında bir kez görünüyor, sonra kayboluyordu. Kargo takip numarası
 * veritabanında duruyor ve biçimi doğrulanıyor ama alıcıya gösterildiği bir
 * yer yoktu — yani numarayı satıcı giriyor, alıcı göremiyordu.
 *
 * Sorgu RLS ALTINDA çalışır: `orders_customer_read` politikası kullanıcıyı
 * kendi siparişlerine kilitler. Burada ayrıca `user_id` süzmüyorum; süzsem
 * bile koruma politikadan gelir, koddan değil.
 *
 * Misafir siparişleri bu listede GÖRÜNMEZ: hesaba bağlı olmadıkları için
 * kime ait olduklarını doğrulayacak bir yol yok. Bir sipariş numarasını
 * bilenin o siparişi görebilmesi, numarayı tahmin eden herkese kapıyı
 * açardı.
 * =========================================================================== */

export interface CustomerOrderItem {
  title: string;
  imageUrl: string | null;
  quantity: number;
  lineTotalCents: number;
  productSlug: string | null;
}

export interface CustomerVendorOrder {
  id: string;
  vendorName: string;
  vendorSlug: string | null;
  status: 'awaiting_vendor' | 'accepted' | 'preparing' | 'shipped' | 'delivered' | 'cancelled';
  carrierName: string | null;
  trackingNumber: string | null;
  /** Firma kendi takip sayfasını verdiyse hazır bağlantı; yoksa null. */
  trackingUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  items: CustomerOrderItem[];
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  createdAt: string;
  grandTotalCents: number;
  paidAt: string | null;
  /** Aynı sipariş birden çok mağazaya bölünmüş olabilir. */
  vendorOrders: CustomerVendorOrder[];
}

export async function getCustomerOrders(limit = 20): Promise<CustomerOrder[]> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('orders')
    .select(
      `id, order_number, created_at, grand_total_cents, paid_at,
       vendor_orders:vendor_orders (
         id, status, carrier, tracking_number, shipped_at, delivered_at,
         vendor:vendors!vendor_id ( display_name, slug ),
         items:order_items (
           title_snapshot, image_url_snapshot, quantity, line_total_cents,
           product:products!product_id ( group:product_groups!group_id ( slug ) )
         )
       )`,
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'Siparişler alınamadı', error: error.message }),
    );
    return [];
  }

  /*
   * Kargo firmasının adı ve takip bağlantısı ayrı bir tablodan gelir.
   * Sipariş sorgusuna gömmek yerine tek seferde okunur: bir alıcının 20
   * siparişi için aynı yedi satırı yirmi kez getirmenin anlamı yok.
   */
  const carriers = new Map<string, { name: string; url: string | null }>();
  const { data: carrierRows } = await supabase
    .from('carriers')
    .select('code, name, tracking_url');

  for (const row of carrierRows ?? []) {
    carriers.set(String(row.code), {
      name: String(row.name),
      url: row.tracking_url ? String(row.tracking_url) : null,
    });
  }

  return (data ?? []).map((order: Record<string, unknown>): CustomerOrder => {
    const vendorOrderRows = (order.vendor_orders as Array<Record<string, unknown>> | null) ?? [];

    return {
      id: String(order.id),
      orderNumber: String(order.order_number),
      createdAt: String(order.created_at),
      grandTotalCents: Number(order.grand_total_cents ?? 0),
      paidAt: order.paid_at ? String(order.paid_at) : null,
      vendorOrders: vendorOrderRows.map((vo): CustomerVendorOrder => {
        const vendor = unwrapRelation(vo.vendor);
        const carrierCode = vo.carrier ? String(vo.carrier) : null;
        const carrier = carrierCode ? (carriers.get(carrierCode) ?? null) : null;
        const trackingNumber = vo.tracking_number ? String(vo.tracking_number) : null;

        return {
          id: String(vo.id),
          vendorName: String(vendor?.display_name ?? 'Mağaza'),
          vendorSlug: vendor?.slug ? String(vendor.slug) : null,
          status: vo.status as CustomerVendorOrder['status'],
          // Kod çözülemiyorsa ham kod gösterilir: "yurtici" demek, hiçbir şey
          // dememekten iyidir.
          carrierName: carrier?.name ?? carrierCode,
          trackingNumber,
          trackingUrl:
            carrier?.url && trackingNumber
              ? carrier.url.replace('{no}', encodeURIComponent(trackingNumber))
              : null,
          shippedAt: vo.shipped_at ? String(vo.shipped_at) : null,
          deliveredAt: vo.delivered_at ? String(vo.delivered_at) : null,
          items: ((vo.items as Array<Record<string, unknown>> | null) ?? []).map((item) => {
            const product = unwrapRelation(item.product);
            const group = product ? unwrapRelation(product.group) : null;

            return {
              title: String(item.title_snapshot),
              imageUrl: item.image_url_snapshot ? String(item.image_url_snapshot) : null,
              quantity: Number(item.quantity ?? 1),
              lineTotalCents: Number(item.line_total_cents ?? 0),
              productSlug: group?.slug ? String(group.slug) : null,
            };
          }),
        };
      }),
    };
  });
}

/* ===========================================================================
 * ADRES DEFTERİ
 * ---------------------------------------------------------------------------
 * Okuma da RLS altındadır (`addresses_own_all`): sorgu `user_id` ile
 * süzmese bile kullanıcı yalnızca kendi satırlarını görür.
 * =========================================================================== */

export interface SavedAddress {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  city: string;
  district: string;
  addressLine: string;
  postalCode: string | null;
  isDefault: boolean;
}

export async function getSavedAddresses(): Promise<SavedAddress[]> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('addresses')
    .select('id, label, full_name, phone, city, district, address_line, postal_code, is_default')
    // Varsayılan en üstte: ödeme formunda ilk sırayı o almalı.
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'Adresler alınamadı', error: error.message }),
    );
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    label: row.label ? String(row.label) : null,
    fullName: String(row.full_name),
    phone: String(row.phone),
    city: String(row.city),
    district: String(row.district),
    addressLine: String(row.address_line),
    postalCode: row.postal_code ? String(row.postal_code) : null,
    isDefault: Boolean(row.is_default),
  }));
}

/* ===========================================================================
 * ÜRÜN SORULARI
 * =========================================================================== */

export interface ProductQuestion {
  id: string;
  body: string;
  askerName: string;
  createdAt: string;
  answer: string | null;
  answerVendorName: string | null;
  answeredAt: string | null;
}

export async function getProductQuestions(groupId: string): Promise<ProductQuestion[]> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('product_questions')
    .select(
      `id, body, created_at, answer, answered_at,
       asker:users!user_id ( full_name ),
       vendor:vendors!answer_vendor_id ( display_name )`,
    )
    .eq('group_id', groupId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  return data.map((row: Record<string, unknown>) => {
    const asker = unwrapRelation(row.asker);
    const vendor = unwrapRelation(row.vendor);

    return {
      id: String(row.id),
      body: String(row.body),
      // Soru soranın TAM ADI gösterilmez: alışveriş alışkanlığı kişisel bir
      // veri ve soru herkese açık. Baş harf kimliği taşımadan sorular
      // birbirinden ayırt edilebilsin diye yeter.
      askerName: maskName(asker?.full_name ? String(asker.full_name) : null),
      createdAt: String(row.created_at),
      answer: row.answer ? String(row.answer) : null,
      answerVendorName: vendor?.display_name ? String(vendor.display_name) : null,
      answeredAt: row.answered_at ? String(row.answered_at) : null,
    };
  });
}

function maskName(fullName: string | null): string {
  if (!fullName) return 'Ohaaaa kullanıcısı';
  return fullName
    .trim()
    .split(/\s+/)
    .map((part) => {
      const ilk = part.charAt(0);
      return ilk ? `${ilk.toLocaleUpperCase('tr-TR')}**` : '';
    })
    .join(' ')
    .trim();
}

/**
 * Oturum açmış kullanıcı bu ürünü satan onaylı bir mağazanın sahibi mi?
 *
 * Yetkinin KENDİSİ veritabanında (`can_answer_question` + tetikleyici);
 * buradaki okuma yalnızca arayüzün cevap kutusunu gösterip göstermeyeceğine
 * karar verir. Arayüzün yanılması bir yetki açığı üretmez: yetkisiz bir
 * cevap denemesi veritabanında geri alınır.
 */
export async function getAnswerVendorId(groupId: string): Promise<string | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('products')
    .select('vendor_id, vendor:vendors!vendor_id ( owner_id, status )')
    .eq('group_id', groupId)
    .limit(50);

  for (const row of data ?? []) {
    const vendor = unwrapRelation((row as Record<string, unknown>).vendor);
    if (vendor?.owner_id === user.id && vendor?.status === 'approved') {
      return String((row as Record<string, unknown>).vendor_id);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fiyatı düşenler
// ---------------------------------------------------------------------------
/**
 * Fiyatı düşen ürün grupları — `/firsatlar` sayfalarının verisi.
 *
 * Veritabanındaki `price_drops()` fonksiyonunu çağırır. O fonksiyon düşüşü
 * BİZİM kendi fiyat gözlemlerimizden (`price_points`) hesaplar; mağazanın
 * üstü çizili fiyatını kullanmaz ve en az iki ölçüm ister.
 *
 * DEMO MODUNDA BOŞ DÖNER.
 * Demo katalogunda fiyat geçmişi yoktur. Olmayan bir geçmişten "bu ürün
 * %30 düştü" cümlesi üretmek, uydurma indirim göstermek olurdu — sayfanın
 * bütün varlık nedenine aykırı. Boş liste, sayfanın dürüst boş durumunu
 * gösterir.
 */
export async function getPriceDrops(options?: {
  days?: number;
  minDropRatio?: number;
  categoryId?: string | null;
  limit?: number;
}): Promise<PriceDrop[]> {
  const supabase = createAnonClient();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc('price_drops', {
    p_days: options?.days ?? 30,
    p_min_drop_ratio: options?.minDropRatio ?? 0.05,
    p_category_id: options?.categoryId ?? null,
    p_limit: options?.limit ?? 24,
  });

  if (error) {
    // Fırsat listesi bir vitrindir, sayfanın gövdesi değil. Okunamazsa
    // sayfa "şu an fırsat listesi hazırlanamadı" der; demo veriyle
    // doldurmak sahte indirim üretmek olurdu.
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Fiyatı düşenler okunamadı',
        error: error.message,
      }),
    );
    throw new Error(`Fiyatı düşenler okunamadı: ${error.message}`);
  }

  const satirlar = (data ?? []) as Record<string, unknown>[];

  /*
   * PARA BIRIMI: `price_drops` RPC'si de dondurmuyor (donus tipi olculdu).
   * `searchProducts` ile ayni kaynak: `products.currency`. Grup basina bir
   * aktif teklifin para birimi yeterli -- bir grubun teklifleri ayni para
   * biriminde olur (market izolasyonu kisiti bunu zorunlu kiliyor).
   */
  const grupKimlikleri = satirlar.map((row) => String(row.group_id));

  const grupParalari = new Map<string, string>();
  if (grupKimlikleri.length > 0) {
    const { data: paraSatirlari, error: paraHatasi } = await supabase
      .from('products')
      .select('group_id, currency')
      .in('group_id', grupKimlikleri)
      .eq('status', 'active');

    if (paraHatasi) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'Fiyati dusenler icin para birimi okunamadi',
          hata: paraHatasi.message,
        }),
      );
    }

    for (const satir of paraSatirlari ?? []) {
      const grup = String(satir.group_id);
      if (satir.currency && !grupParalari.has(grup)) {
        grupParalari.set(grup, String(satir.currency).trim());
      }
    }
  }

  return satirlar.map((row: Record<string, unknown>): PriceDrop => ({
    groupId: String(row.group_id),
    slug: String(row.slug),
    title: String(row.title),
    imageUrl: row.image_url ? String(row.image_url) : null,
    categoryId: row.category_id ? String(row.category_id) : null,
    currentPriceCents: Number(row.current_price_cents),
    referencePriceCents: Number(row.reference_price_cents),
    currency: grupParalari.get(String(row.group_id)) ?? 'TRY',
    dropRatio: Number(row.drop_ratio),
    observedDays: Number(row.observed_days),
    offerCount: Number(row.offer_count),
  }));
}

// ---------------------------------------------------------------------------
// Ohaaaa skoru
// ---------------------------------------------------------------------------
/**
 * Bir teklifin Ohaaaa skoru.
 *
 * Hesabın tamamı veritabanındaki `ohaaaa_score()` fonksiyonunda. Burada
 * ikinci bir formül YOK: iki kopya zamanla ayrışır ve aynı ürün için iki
 * farklı sayı üretmeye başlar.
 *
 * DEMO MODUNDA NULL DÖNER. Demo katalogunda fiyat geçmişi yok; skorun en ağır
 * bileşeni ölçülemez. Eksik veriyle bir sayı uydurmaktansa arayüz "bu teklif
 * için skor üretemedik" der.
 */
export async function getOhaaaaScore(productId: string): Promise<OhaaaaScore | null> {
  const supabase = createAnonClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc('ohaaaa_score', {
    p_product_id: productId,
    p_days: 90,
  });

  if (error) {
    // Skor ürün sayfasının yardımcı bilgisi; okunamazsa sayfa skorsuz
    // çizilir. Hatayı yukarı fırlatıp bütün ürün sayfasını düşürmek,
    // eksik bir rozet için fazla ağır bir bedel.
    console.error(
      JSON.stringify({ level: 'error', msg: 'Ohaaaa skoru okunamadı', error: error.message }),
    );
    return null;
  }

  const row = data as Record<string, unknown> | null;
  if (!row || row.available === false) {
    // `available:false` iki sebeple gelir: ürün yok, ya da ölçülebilen
    // ağırlık eşiğin altında. İkincisinde bileşenler yine dolu gelir ve
    // arayüz NEYİ ölçemediğimizi gösterebilir.
    if (!row || !Array.isArray(row.components)) return null;
  }

  return {
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    maxScore: Number(row.max_score ?? 100),
    measuredWeight: Number(row.measured_weight ?? 0),
    totalWeight: Number(row.total_weight ?? 100),
    confidence: (row.confidence as OhaaaaScore['confidence']) ?? 'yetersiz',
    windowDays: Number(row.window_days ?? 90),
    components: (row.components as ScoreComponent[]) ?? [],
  };
}


/**
 * Arama kutusunun ipuçları -- KATALOGDAN, elle yazılmış listeden değil.
 *
 * NEDEN DEĞİŞTİ
 * Önceki hâl sabit bir liste kullanıyordu: iPhone 15, kulaklık, airfryer,
 * koşu ayakkabısı, süpürge. Bunların HİÇBİRİ katalogda yok (katalog bugün
 * %100 bilgisayar donanımı, ölçüldü) -- yani "Popüler" diye sunulan her
 * öneri tıklanınca BOŞ sonuç veriyordu. Aynı satırda "5.000 TL altında..."
 * yazıyordu; katalogda tek bir TRY fiyat yok, 35.742 teklifin tamamı GBP.
 *
 * Kullanıcıya olmayan ürünü önermek ve olmayan para biriminde fiyat örneği
 * vermek, sitenin en görünür yerinde yanlış bilgi vermektir.
 *
 * Artık ipuçları gerçek katalogdan geliyor: `search_facets` marka sayaçlarını
 * çoktan azalana doğru döndürüyor, yani en üsttekiler gerçekten en çok ürünü
 * olan markalar ve hepsi tıklanınca sonuç veriyor.
 */
export interface SearchHints {
  /** Katalogda gerçekten ürünü olan markalar, çoktan aza. */
  brands: string[];
  /** Örnek cümle için: katalogun GERÇEK para birimi ve gerçek bir fiyat. */
  example: { brand: string; currency: string; priceCents: number } | null;
}

async function aramaIpuclariniOku(limit = 5): Promise<SearchHints> {
  const supabase = createAnonClient();
  if (!supabase) return { brands: [], example: null };

  const { data, error } = await supabase.rpc('search_facets', {
    p_query: null,
    p_category_id: null,
  });

  if (error) {
    /*
     * İpucu yoksa şerit HİÇ çizilmiyor. Sabit listeye geri düşmek, tam da
     * kaldırdığımız hatayı geri getirmek olurdu.
     */
    console.warn(
      JSON.stringify({ level: 'warn', msg: 'Arama ipuclari okunamadi', hata: error.message }),
    );
    return { brands: [], example: null };
  }

  const satir = (data ?? {}) as Record<string, unknown>;
  const markalar = ((satir.brands as Record<string, unknown>[] | null) ?? [])
    .map((b) => String(b.name))
    .filter((ad) => ad.trim().length > 0)
    .slice(0, limit);

  if (markalar.length === 0) return { brands: [], example: null };

  /*
   * Örnek eşik, O MARKANIN gerçekten var olan en ucuz teklifinden türetiliyor.
   *
   * Neden en ucuz: örnek cümle "şu fiyatın altında" diyor ve kullanıcı onu
   * tıkladığında SONUÇ GÖRMELİ. En ucuz teklifin üstündeki herhangi bir eşik
   * bunu garanti eder. Uydurma yuvarlak bir sayı yazmak (100, 5000) katalogla
   * ilgisi olmayan bir eşik önermek olurdu -- tam olarak kaldırdığımız hata.
   */
  const ilkMarka = markalar[0] as string;
  const { data: ornek } = await supabase
    .from('products')
    .select('price_cents, currency')
    .eq('brand', ilkMarka)
    .eq('status', 'active')
    .gt('stock', 0)
    .order('price_cents', { ascending: true })
    .limit(1);

  const teklif = (ornek ?? [])[0];
  if (!teklif) return { brands: markalar, example: null };

  /*
   * En ucuz tekliften bir üst "yuvarlak" basamağa çıkılıyor (10 / 50 / 100 /
   * 500 / 1.000 birim). Böylece eşik hem okunabilir hem de en az bir ürünü
   * KESİNLIKLE kapsıyor.
   */
  const birim = Math.max(1, Math.ceil(Number(teklif.price_cents) / 100));
  const basamak = [10, 50, 100, 500, 1000, 5000].find((b) => b > birim) ?? birim * 2;

  return {
    brands: markalar,
    example: {
      brand: ilkMarka,
      currency: String(teklif.currency).trim(),
      priceCents: basamak * 100,
    },
  };
}

// ---------------------------------------------------------------------------
// Önbelleğe alınmış katalog okumaları
// ---------------------------------------------------------------------------
/*
 * Aşağıdaki dışa açık adlar, yukarıdaki HAM okumaların önbelleğe alınmış
 * hâlleridir. Çağıran taraf hiçbir şey bilmez: aynı ad, aynı imza.
 */

/** Etkin kategorilerin tamamı (alt kategoriler dahil). */
export const getCategories = onbellekle('kategoriler', kategorileriOku, ONBELLEK.taksonomi);

/** Gezinilebilir kategori ağacı -- boş dallar elenmiş, sayılar ölçülmüş. */
export const getCategoryTree = onbellekle('kategori-agaci', kategoriAgaciniOku, ONBELLEK.taksonomi);

/** Bu kategoride gösterilecek ürün var mı. */
export const categoryHasProducts = onbellekle(
  'kategori-dolu-mu',
  kategoriDoluMuOku,
  ONBELLEK.listeleme,
);

/** Onaylı taşeronlar. */
export const getVendors = onbellekle('tasoronlar', tasoronlariOku, ONBELLEK.magazalar);

/** Ana sayfadaki kampanya şeridi. */
export const getFlashDeals = onbellekle('kampanyalar', kampanyalariOku, ONBELLEK.vitrin);

/** Vitrin basamakları. */
export const getShowcaseTiers = onbellekle('vitrin', vitriniOku, ONBELLEK.vitrin);

/** Bir kanonik ürünün tam kaydı (teklifleriyle). */
export const getProductGroup = onbellekle('urun-grubu', urunGrubunuOku, ONBELLEK.listeleme);

/** Adrese göre mağaza -- taşeron ya da ortak mağaza. */
export const getStoreBySlug = onbellekle('magaza', magazayiOku, ONBELLEK.magazalar);

/** Bir mağazanın vitrinindeki ürünler. */
export const getStoreProducts = onbellekle('magaza-vitrini', magazaVitriniOku, ONBELLEK.listeleme);

/** Ürün sayfasındaki "Bunlara da bakın" bloğu. */
export const getRelatedGroups = onbellekle('benzer-urunler', benzerGruplariOku, ONBELLEK.listeleme);

/** Bir grubun fiyat geçmişi. */
export const getPriceHistory = onbellekle('fiyat-gecmisi', fiyatGecmisiniOku, ONBELLEK.listeleme);

/** Arama kutusunun katalogdan türetilen ipuçları. */
export const getSearchHints = onbellekle('arama-ipuclari', aramaIpuclariniOku, ONBELLEK.vitrin);

/** Serbest metin ARAMASI OLMAYAN listeleme -- kategori, sıralama, sayfalama. */
const listelemeOnbellekli = onbellekle('listeleme', aramaOku, ONBELLEK.listeleme);

/**
 * Ürün araması.
 *
 * SERBEST METİN ARAMASI ÖNBELLEĞE ALINMAZ ve bu bilinçli: kullanıcının
 * yazdığı her sorgu ayrı bir önbellek anahtarı üretir, yani anahtar uzayı
 * sınırsızdır. Sınırsız anahtar, önbelleği doldurup asıl işe yarayan
 * girdileri (kategori listeleri, ana sayfa) dışarı atar -- yani önbellek
 * kendi kendini bozar.
 *
 * Gezinme amaçlı çağrılar (kategori sayfası, ana sayfa, sıralama, sayfalama)
 * SINIRLI sayıda kombinasyona sahip ve sayfa başına saniyeler kazandırıyor;
 * onlar önbelleğe alınıyor.
 */
export async function searchProducts(params: SearchParams): Promise<SearchPage> {
  if (params.query && params.query.trim().length > 0) return aramaOku(params);
  return listelemeOnbellekli(params);
}

// ---------------------------------------------------------------------------
// Site haritası
// ---------------------------------------------------------------------------
/** Site haritasına girecek bir ürün grubu. */
export interface SitemapProduct {
  slug: string;
  /** Öncelik hesabı için: çok teklifli ürünler karşılaştırma vaadini taşır. */
  offerCount: number;
}

/**
 * Bir okumada kaç grup isteniyor.
 *
 * 1.000 keyset sayfası ~38 ms (ölçüldü, konumdan BAĞIMSIZ). Daha büyük
 * parçalar tek istekte daha çok satır getirir ama PostgREST yanıtını ve
 * bellek tepe noktasını büyütür; 1.000 ikisinin arasında duruyor.
 */
const HARITA_SAYFA_BOYUTU = 1000;

/**
 * Site haritası için TÜM ürün adresleri.
 *
 * NEDEN `searchProducts` KULLANILMIYOR
 * Kullanılıyordu ve sessizce kırıktı. `search_products` işlevi istenen
 * limiti kesiyor:
 *
 *     limit greatest(1, least(coalesce(p_limit, 24), 100))
 *
 * yani site haritası 45.000 ürün isteyip 100 alıyordu. Ölçülen sonuç:
 * canlı sitemap.xml'de 34.510 üründen 100'ü vardı -- kapsam %0,29. Koddaki
 * `MAX_PRODUCTS = 45_000` sabiti bir niyet beyanıydı, etkisi yoktu.
 *
 * NEDEN KEYSET SAYFALAMA (offset değil)
 * `offset` doğrusal olarak yavaşlar: veritabanı atladığı satırları yine de
 * okur. Ölçüldü -- 20.000'inci satırdan 1.000 kayıt almak 736 ms, aynı işi
 * `slug > sonSlug` ile yapmak 38 ms. Katalog büyüdükçe fark açılır ve
 * offset eninde sonunda ifade zaman aşımına çarpar.
 *
 * `slug` bu iş için doğru anahtar: BENZERSİZ (tekil dizin var), dolayısıyla
 * sayfa sınırında kayıt atlanmaz veya iki kez gelmez. `offer_count` ile
 * sıralamak cazipti ama eşit değerler sayfalar arasında kayar.
 */
export async function getSitemapProducts(max = 45_000): Promise<SitemapProduct[]> {
  const supabase = createAnonClient();

  if (!supabase) {
    return demoProductGroups
      .filter((grup) => grup.offerCount > 0)
      .map((grup) => ({ slug: grup.slug, offerCount: grup.offerCount }));
  }

  return collectByKeyset<SitemapProduct>({
    max,
    pageSize: HARITA_SAYFA_BOYUTU,
    key: (urun) => urun.slug,
    fetchPage: async (sonSlug, limit) => {
      let sorgu = supabase
        .from('product_groups')
        .select('slug, offer_count')
        .gt('offer_count', 0)
        .order('slug')
        .limit(limit);

      if (sonSlug !== null) sorgu = sorgu.gt('slug', sonSlug);

      const { data, error } = await sorgu;

      if (error) {
        /*
         * YARIM LİSTE SESSİZCE YAYIMLANMAZ. Bir sayfa okunamazsa o ana kadar
         * toplananı döndürmek, Google'a "kalan ürünler artık yok" demenin
         * yumuşak hâli olurdu. Hata yukarı çıkıyor ve site haritası kendi
         * yedeğine (statik sayfalar) düşüyor -- eksik değil, dürüst.
         */
        throw new Error(`Site haritasi urunleri okunamadi: ${error.message}`);
      }

      return (data ?? []).map((satir) => ({
        slug: String(satir.slug),
        offerCount: Number(satir.offer_count),
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Vitrin basamakları
// ---------------------------------------------------------------------------
/**
 * Vitrinde gösterilen bir ürün.
 *
 * `score` GERÇEK Ohaaaa skorudur (`ohaaaa_score`). Ölçülemediğinde `null`
 * gelir ve HİÇBİR YERDE doldurulmaz -- ne burada ne arayüzde.
 */
export interface ShowcaseProduct {
  slug: string;
  title: string;
  brand: string | null;
  imageUrl: string;
  minPriceCents: number | null;
  offerCount: number;
  currency?: string;
  score: number | null;
}

/**
 * Vitrinin bir basamağı: bir satıcı ve onun öne çıkan ürünleri.
 *
 * BASAMAK SIRASI NEYE GÖRE
 * Satıcıları sıralamak için ölçebildiğimiz tek şey kataloğa kaç aktif teklif
 * koydukları. `merchants.partner_rank` sütunu var ama HERKESE AÇIK DEĞİL
 * (anon rolüne o sütunun okuma izni verilmemiş -- ölçüldü), dolayısıyla
 * ziyaretçiye çizilen bir bölümde kullanılamaz. Teklif sayısı hem okunabilir
 * hem de gerçekten ölçülmüş bir büyüklük.
 *
 * Yalnızca `status = 'active'` mağazalar görünür; bunu satır güvenliği
 * (RLS) zaten zorluyor. Başvurusu sürenler (`prospect`) vitrinde yer almaz
 * -- henüz satmadıkları bir şeyi öneriyor gibi görünmemeliyiz.
 */
export interface ShowcaseTier {
  merchantSlug: string;
  merchantName: string;
  /** Satıcının aktif teklif sayısı -- basamak sırasının ölçülen dayanağı. */
  offerCount: number;
  products: ShowcaseProduct[];
}

/**
 * Basamak başına kaç aday grup taranır.
 *
 * Havuz büyüdükçe seçim iyileşir ama `.in(...)` listesi GET adresine yazılır
 * ve adres uzunluğunun pratik bir sınırı var (daha önce ölçüldü: ~6 KB'ta
 * istekler düşüyor). 24 uuid ≈ 0,9 KB; üç basamakta 72 uuid ≈ 2,7 KB.
 */
const VITRIN_ADAY_HAVUZU = 24;

/**
 * Basamak başına kaç adayın skoru gerçekten hesaplanır.
 *
 * `ohaaaa_score` ürün başına ayrı bir RPC çağrısıdır; havuzun tamamını
 * puanlamak 24 gidiş-dönüş demek olurdu. En umutlu adaylar (en çok teklifle
 * karşılaştırılabilenler) puanlanır, gerisi yedek sırayla dizilir.
 */
const VITRIN_PUANLAMA_BUTCESI = 8;

/** Bir teklifin kargo dahil toplamı. */
function toplamMaliyet(satir: Record<string, unknown>): number {
  return Number(satir.price_cents ?? 0) + Number(satir.shipping_fee_cents ?? 0);
}

/** Demo kümesinden basamak üretir (Supabase yapılandırılmamışken). */
function demoShowcaseTiers(tiers: number, perTier: number): ShowcaseTier[] {
  const sayac = new Map<string, number>();
  for (const grup of demoProductGroups) {
    for (const teklif of grup.offers) {
      if (!teklif.merchant) continue;
      sayac.set(teklif.merchant.slug, (sayac.get(teklif.merchant.slug) ?? 0) + 1);
    }
  }

  return [...sayac.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, tiers)
    .map(([slug, adet]) => {
      const adaylar = demoProductGroups
        .filter((grup) => grup.offers.some((t) => t.merchant?.slug === slug))
        .map((grup) => ({
          slug: grup.slug,
          title: grup.title,
          brand: grup.brand,
          imageUrl: grup.imageUrl ?? '',
          minPriceCents: grup.minPriceCents,
          offerCount: grup.offerCount,
          currency: grup.currency,
          // Demo kümesinde fiyat geçmişi yok; skor gerçekten ölçülemez.
          score: null,
          totalCostCents: grup.minPriceCents,
        }));

      const ad = demoProductGroups
        .flatMap((g) => g.offers)
        .find((t) => t.merchant?.slug === slug)?.merchant?.displayName ?? slug;

      return {
        merchantSlug: slug,
        merchantName: ad,
        offerCount: adet,
        products: rankShowcase(adaylar, perTier).map(({ totalCostCents: _t, ...urun }) => urun),
      };
    })
    .filter((basamak) => basamak.products.length > 0);
}

/**
 * Vitrin basamakları: en iyi satıcıdan başlayarak, her satıcının öne çıkan
 * ürünleri.
 *
 * SIRALAMA GERÇEK SKORLA BAŞLAR. Her basamağın adayları `ohaaaa_score` ile
 * puanlanır; puanı olanlar öne geçer. Bugün kataloğun tamamında ölçülebilen
 * ağırlık eşiğin altında (her ürünün tek bir fiyat gözlemi var), yani hiçbir
 * ürün skor üretmiyor -- bu ÖLÇÜLDÜ. O yüzden sıralama şimdilik yedek ölçüte
 * düşüyor ve arayüz hangi ölçütü kullandığını yazıyor. İkinci besleme fiyat
 * geçmişini iki gözleme çıkardığında skor yolu kendiliğinden devreye girer;
 * burada değiştirilecek bir şey kalmaz.
 */
async function vitriniOku(options?: {
  tiers?: number;
  perTier?: number;
}): Promise<ShowcaseTier[]> {
  const tiers = Math.max(1, options?.tiers ?? 3);
  const perTier = Math.max(1, options?.perTier ?? 5);

  const supabase = createAnonClient();
  if (!supabase) return demoShowcaseTiers(tiers, perTier);

  const { data: magazaSatirlari, error: magazaHatasi } = await supabase
    .from('merchants')
    .select('id, slug, display_name')
    .eq('status', 'active')
    .limit(20);

  if (magazaHatasi) {
    /*
     * Vitrin bir BÖLÜM, sayfanın gövdesi değil. Okunamazsa boş dönülür ve
     * bileşen hiç çizilmez; demo veriyle doldurmak gerçek katalog varken
     * sahte mağaza göstermek olurdu.
     */
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Vitrin magazalari okunamadi',
        hata: magazaHatasi.message,
      }),
    );
    return [];
  }

  const magazalar = magazaSatirlari ?? [];
  if (magazalar.length === 0) return [];

  /*
   * SAYIMLAR VE ADAY GRUPLAR AYNI ANDA.
   *
   * Ana sayfa dinamik çiziliyor (her istekte), dolayısıyla buradaki her
   * gidiş-dönüş doğrudan yanıt süresine biniyor. Aday grup sorgusu
   * mağazalara hiç bakmıyor, dolayısıyla sayımları beklemesi gereksizdi.
   * Havuz sınırı seçilen basamak sayısına göre değil İSTENEN sayıya göre
   * hesaplanıyor -- en fazla o kadar basamak olabilir.
   *
   * Görseli olmayan grup vitrine alınmaz: boş bir kare vitrine zarar verir.
   */
  const [sayimlar, grupCevabi] = await Promise.all([
    Promise.all(
      magazalar.map(async (magaza) => {
        const { count } = await supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('merchant_id', String(magaza.id))
          .eq('status', 'active');
        return { magaza, adet: count ?? 0 };
      }),
    ),
    supabase
      .from('product_groups')
      .select('id, slug, title, brand, image_url, min_price_cents, offer_count')
      .gt('offer_count', 0)
      .not('image_url', 'is', null)
      .order('offer_count', { ascending: false })
      .limit(VITRIN_ADAY_HAVUZU * tiers),
  ]);

  const secilenler = sayimlar
    .filter((x) => x.adet > 0)
    .sort((a, b) => b.adet - a.adet)
    .slice(0, tiers);

  if (secilenler.length === 0) return [];

  const { data: grupSatirlari, error: grupHatasi } = grupCevabi;

  if (grupHatasi) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Vitrin adaylari okunamadi',
        hata: grupHatasi.message,
      }),
    );
    return [];
  }

  const gruplar = grupSatirlari ?? [];
  if (gruplar.length === 0) return [];

  const grupKimlikleri = gruplar.map((g) => String(g.id));

  /*
   * BASAMAKLAR BİRBİRİNİ BEKLEMEZ.
   *
   * Basamak başına iki gidiş-dönüş var (teklifler, sonra skorlar). Sırayla
   * yapılsaydı üç basamak altı gidiş-dönüş demek olurdu ve hepsi dinamik ana
   * sayfanın yanıt süresine eklenirdi. Basamaklar birbirinin verisine hiç
   * bakmıyor, dolayısıyla paralel çalışabilirler; sıra `secilenler`
   * dizilimiyle korunuyor.
   */
  const basamakSonuclari = await Promise.all(
    secilenler.map(async ({ magaza, adet }): Promise<ShowcaseTier | null> => {
      /*
       * Bu mağazanın aday gruplardaki EN UCUZ teklifi.
       *
       * Skoru teklif başına hesaplıyoruz (fonksiyonun imzası ürün kimliği
       * istiyor), dolayısıyla grubu temsil edecek tek bir teklif seçilmeli.
       * Kargo dahil en ucuz olanı seçmek, kullanıcının o gruptan gerçekte
       * alacağı teklifle aynı olanı seçmektir.
       */
      const { data: teklifSatirlari, error: teklifHatasi } = await supabase
        .from('products')
        .select('id, group_id, currency, price_cents, shipping_fee_cents')
        .in('group_id', grupKimlikleri)
        .eq('merchant_id', String(magaza.id))
        .eq('status', 'active')
        .gt('stock', 0);

      if (teklifHatasi) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'Vitrin teklifleri okunamadi',
            magaza: String(magaza.slug),
            hata: teklifHatasi.message,
          }),
        );
        return null;
      }

      const enUcuz = new Map<string, { id: string; currency?: string; toplam: number }>();
      for (const satir of teklifSatirlari ?? []) {
        const grup = String(satir.group_id);
        const toplam = toplamMaliyet(satir);
        const onceki = enUcuz.get(grup);
        if (!onceki || toplam < onceki.toplam) {
          enUcuz.set(grup, {
            id: String(satir.id),
            currency: satir.currency ? String(satir.currency).trim() : undefined,
            toplam,
          });
        }
      }

      if (enUcuz.size === 0) return null;

      type Aday = ShowcaseProduct & { totalCostCents: number | null; offerId: string };

      const adaylar: Aday[] = gruplar
        .filter((g) => enUcuz.has(String(g.id)))
        .map((g) => {
          const teklif = enUcuz.get(String(g.id)) as { id: string; currency?: string; toplam: number };
          return {
            slug: String(g.slug),
            title: String(g.title),
            brand: g.brand ? String(g.brand) : null,
            imageUrl: String(g.image_url),
            minPriceCents: g.min_price_cents === null ? null : Number(g.min_price_cents),
            offerCount: Number(g.offer_count),
            currency: teklif.currency,
            score: null,
            totalCostCents: teklif.toplam,
            offerId: teklif.id,
          };
        });

      /*
       * Puanlama bütçesi en umutlu adaylara harcanır. "Umutlu" ölçülebilir bir
       * şey: skorun karşılaştırma bileşeni ancak grupta birden çok teklif
       * varsa açılıyor, dolayısıyla önce yedek sırayla dizip baştan alıyoruz.
       */
      const puanlanacaklar = rankShowcase(adaylar, VITRIN_PUANLAMA_BUTCESI);
      const puanlar = await Promise.all(
        puanlanacaklar.map(async (aday) => ({
          slug: aday.slug,
          score: (await getOhaaaaScore(aday.offerId).catch(() => null))?.score ?? null,
        })),
      );
      const puanHaritasi = new Map(puanlar.map((p) => [p.slug, p.score]));

      const puanli = adaylar.map((aday) => ({
        ...aday,
        score: puanHaritasi.get(aday.slug) ?? null,
      }));

      const secilen = rankShowcase(puanli, perTier);
      if (secilen.length === 0) return null;

      return {
        merchantSlug: String(magaza.slug),
        merchantName: String(magaza.display_name),
        offerCount: adet,
        products: secilen.map(({ totalCostCents: _t, offerId: _o, ...urun }) => urun),
      };
  }),
  );

  return basamakSonuclari.filter((basamak): basamak is ShowcaseTier => basamak !== null);
}
