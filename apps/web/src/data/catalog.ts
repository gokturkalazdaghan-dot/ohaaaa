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

import { offerSellerName
} from '@ohaaaa/shared';
import type {
  Category,
  FlashDeal,
  Offer,
  PricePoint,
  ProductGroupWithOffers,
  SearchResult,
  Vendor,
} from '@ohaaaa/shared';

import { isSupabaseConfigured } from '@/lib/env';
import { createAnonClient } from '@/lib/supabase/anon';

import { demoCategories, demoFlashDeals, demoProductGroups, demoVendors } from './demo';

export type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'offers';

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
export async function searchProducts(params: SearchParams): Promise<SearchPage> {
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
export async function getProductGroup(slug: string): Promise<ProductGroupWithOffers | null> {
  const supabase = createAnonClient();

  if (supabase) {
    const { data, error } = await supabase
      .from('product_groups')
      .select(
        `id, slug, title, brand, image_url, description, category_id, attributes,
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
          currency: 'TRY' as const,
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
      imageUrl: data.image_url ? String(data.image_url) : null,
      description: data.description ? String(data.description) : null,
      categoryId: data.category_id ? String(data.category_id) : null,
      attributes: (data.attributes as Record<string, string> | null) ?? {},
      offerCount: Number(data.offer_count),
      rating: Number(data.rating ?? 0),
      ratingCount: Number(data.rating_count ?? 0),
      minPriceCents: data.min_price_cents === null ? null : Number(data.min_price_cents),
      maxPriceCents: data.max_price_cents === null ? null : Number(data.max_price_cents),
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
export async function getFlashDeals(limit = 3): Promise<FlashDeal[]> {
  const supabase = createAnonClient();

  if (supabase) {
    const { data, error } = await supabase
      .from('flash_deals')
      .select(
        `id, product_id, headline, deal_price_cents, stock_limit, sold_count, ends_at,
         product:products (
           title, price_cents, image_urls, group_id,
           vendor:vendors!vendor_id ( display_name ),
           group:product_groups!group_id ( slug )
         )`,
      )
      .lte('starts_at', new Date().toISOString())
      .gte('ends_at', new Date().toISOString())
      .order('priority', { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Kampanyalar okunamadı:", error.message);
      return demoFlashDeals.slice(0, limit);
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
        stockLimit: row.stock_limit === null ? null : Number(row.stock_limit),
        soldCount: Number(row.sold_count),
        vendorName: vendor?.display_name ? String(vendor.display_name) : null,
        endsAt: String(row.ends_at),
      };
    });
  }

  return demoFlashDeals.slice(0, limit);
}

export async function getCategories(): Promise<Category[]> {
  const supabase = createAnonClient();

  if (supabase) {
    const { data, error } = await supabase
      .from('categories')
      .select('id, parent_id, slug, name, icon')
      .is('parent_id', null)
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

export async function getVendors(): Promise<Vendor[]> {
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
      .select('slug, title, image_url, min_price_cents, offer_count')
      .in('slug', slugs);

    if (error) throw new Error(`Fiyatlar okunamadı: ${error.message}`);

    return (data ?? []).map((row) => ({
      slug: String(row.slug),
      title: String(row.title),
      imageUrl: row.image_url ? String(row.image_url) : null,
      minPriceCents: row.min_price_cents === null ? null : Number(row.min_price_cents),
      offerCount: Number(row.offer_count),
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
): Promise<SearchPage> {
  const supabase = createAnonClient();

  if (!supabase) {
    const results = demoProductGroups
      .filter((group) => group.offers.some((offer) => offer.vendorId === vendorId))
      .map(toSearchResult);

    return {
      results: results.slice(options.offset, options.offset + options.limit),
      totalCount: results.length,
    };
  }

  const { data, error, count } = await supabase
    .from('products')
    .select(
      `price_cents, shipping_fee_cents,
       group:product_groups!group_id (
         id, slug, title, brand, image_url, offer_count,
         min_price_cents, max_price_cents, best_offer_id
       )`,
      { count: 'exact' },
    )
    .eq('vendor_id', vendorId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .range(options.offset, options.offset + options.limit - 1);

  if (error) throw new Error(`Mağaza ürünleri okunamadı: ${error.message}`);

  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const row of data ?? []) {
    const group = unwrapRelation((row as Record<string, unknown>).group);
    if (!group) continue;

    const groupId = String(group.id);
    if (seen.has(groupId)) continue;
    seen.add(groupId);

    results.push({
      groupId,
      slug: String(group.slug),
      title: String(group.title),
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

  return { results, totalCount: count ?? results.length };
}

/** Ürün sayfasındaki "Bunlara da bakın" bloğu. */
export async function getRelatedGroups(
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
export async function getPriceHistory(
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
