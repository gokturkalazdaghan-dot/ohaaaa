/**
 * Ürün besleme (Product Sync) servisi.
 *
 * AGREGATÖRÜN ÇEKİRDEĞİ: Farklı taşeronlardan gelen aynı fiziksel ürün
 * tek bir "kanonik ürün" (product_group) altında toplanmalıdır — fiyat
 * karşılaştırması ancak böyle mümkün olur.
 *
 * Eşleştirme sırası (güvenilirlikten zayıfa):
 *   1. GTIN/barkod — küresel olarak benzersizdir, en güvenilir sinyaldir
 *   2. Normalize edilmiş marka + başlık imzası — barkodsuz beslemeler için
 *   3. Eşleşme yoksa yeni kanonik ürün açılır
 *
 * Yanlış eşleştirme (iki farklı ürünü birleştirmek) hiç eşleştirmemekten
 * daha zararlıdır: kullanıcı yanlış ürünü satın alır. Bu yüzden 2. adım
 * bilinçli olarak muhafazakârdır — yalnızca tam imza eşleşmesi kabul edilir.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProductFeedItem } from './schemas.js';

/*
 * NEDEN BU DOSYA `shared` ICINDE?
 *
 * Kanonik urun eslestirmesi ("hangi iki teklif ayni urundur") sitenin en
 * kritik kuralidir ve iki yerden cagrilir: Express API'si ve web
 * uygulamasinin route handler'lari. Iki kopya zamanla ayrisir; ayrisma da
 * sessizdir - bir yol iki farkli urunu birlestirir, kullanici yanlis urunu
 * satin alir. Bu yuzden tek kopya, ikisinin de zaten derledigi pakette.
 *
 * `@supabase/supabase-js` yalnizca TIP olarak alinir (`import type`), yani
 * derlemede silinir. Uretilen JavaScript'te bu paketten hicbir sey yoktur;
 * `shared` calisma zamaninda bagimsiz kalir ve tarayici paketini
 * sismeye ugratmaz.
 */
type ServiceClient = SupabaseClient;

export interface SyncResult {
  received: number;
  created: number;
  updated: number;
  archived: number;
  /** Kısmi başarısızlıklar: geçerli kalemler yine de işlenir. */
  failed: Array<{ external_id: string; reason: string }>;
}

/** Türkçe karakterleri ASCII'ye indirger — SQL'deki normalize_search ile aynı. */
function normalize(value: string): string {
  return value
    .replace(/[ĞÜŞİÖÇIğüşıöçÂÎÛâîû]/g, (char) => {
      const map: Record<string, string> = {
        Ğ: 'G', Ü: 'U', Ş: 'S', İ: 'I', Ö: 'O', Ç: 'C', I: 'I',
        ğ: 'g', ü: 'u', ş: 's', ı: 'i', ö: 'o', ç: 'c',
        Â: 'a', Î: 'i', Û: 'u', â: 'a', î: 'i', û: 'u',
      };
      return map[char] ?? char;
    })
    .toLowerCase();
}

/** Kanonik eşleştirme imzası: marka + sadeleştirilmiş başlık. */
function signature(title: string, brand: string | null | undefined): string {
  const normalizedTitle = normalize(title)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0)
    .sort()               // kelime sırası farkı eşleşmeyi bozmasın
    .join(' ');

  return `${normalize(brand ?? '')}|${normalizedTitle}`;
}

function slugify(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function syncProducts(
  supabase: ServiceClient,
  vendorId: string,
  items: ProductFeedItem[],
  archiveMissing: boolean,
): Promise<SyncResult> {
  const failed: SyncResult['failed'] = [];

  // ---- 1) Kategori sluglarını tek sorguda kimliğe çevir ---------------------
  const categorySlugs = [
    ...new Set(items.map((item) => item.category_slug).filter((s): s is string => Boolean(s))),
  ];

  const categoryIdBySlug = new Map<string, string>();

  if (categorySlugs.length > 0) {
    const { data, error } = await supabase
      .from('categories')
      .select('id, slug')
      .in('slug', categorySlugs);

    if (error) throw new Error(`Kategoriler okunamadı: ${error.message}`);

    for (const row of data ?? []) {
      categoryIdBySlug.set(String(row.slug).toLowerCase(), String(row.id));
    }
  }

  // ---- 2) Kanonik ürün gruplarını çöz --------------------------------------
  const groupIdByItem = await resolveProductGroups(supabase, items, categoryIdBySlug, failed);

  // ---- 3) Teklifleri upsert et ---------------------------------------------
  // (vendor_id, external_id) benzersiz kısıtı sayesinde besleme idempotenttir:
  // aynı sayfa iki kez gönderilse de mükerrer kayıt oluşmaz.
  const existingIds = new Set<string>();
  {
    const { data, error } = await supabase
      .from('products')
      .select('external_id')
      .eq('vendor_id', vendorId)
      .in('external_id', items.map((item) => item.external_id));

    if (error) throw new Error(`Mevcut ürünler okunamadı: ${error.message}`);
    for (const row of data ?? []) existingIds.add(String(row.external_id));
  }

  const rows = items
    .filter((item) => groupIdByItem.has(item.external_id))
    .map((item) => ({
      vendor_id: vendorId,
      group_id: groupIdByItem.get(item.external_id) ?? null,
      external_id: item.external_id,
      sku: item.sku ?? null,
      title: item.title,
      description: item.description ?? null,
      brand: item.brand ?? null,
      category_id: item.category_slug
        ? categoryIdBySlug.get(item.category_slug.toLowerCase()) ?? null
        : null,
      image_urls: item.image_urls,
      price_cents: item.price_cents,
      compare_at_price_cents: item.compare_at_price_cents ?? null,
      currency: item.currency,
      stock: item.stock,
      condition: item.condition,
      shipping_fee_cents: item.shipping_fee_cents,
      free_shipping_threshold_cents: item.free_shipping_threshold_cents ?? null,
      estimated_delivery_days: item.estimated_delivery_days,
      // Stok bittiyse taşeron 'active' göndermiş olsa bile vitrine çıkmaz.
      status: item.stock === 0 && item.status === 'active' ? 'out_of_stock' : item.status,
      attributes: item.attributes,
    }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from('products')
      .upsert(rows, { onConflict: 'vendor_id,external_id' });

    if (error) throw new Error(`Ürünler yazılamadı: ${error.message}`);
  }

  // ---- 4) Tam senkron modunda eksikleri arşivle ----------------------------
  let archived = 0;

  if (archiveMissing) {
    const feedIds = items.map((item) => item.external_id);

    // PostgREST'te "listede OLMAYAN" filtresi: not.in
    const { data, error } = await supabase
      .from('products')
      .update({ status: 'archived' })
      .eq('vendor_id', vendorId)
      .neq('status', 'archived')
      .not('external_id', 'in', `(${feedIds.map((id) => `"${id.replace(/"/g, '""')}"`).join(',')})`)
      .select('id');

    if (error) throw new Error(`Eksik ürünler arşivlenemedi: ${error.message}`);
    archived = data?.length ?? 0;
  }

  const created = rows.filter((row) => !existingIds.has(row.external_id)).length;

  return {
    received: items.length,
    created,
    updated: rows.length - created,
    archived,
    failed,
  };
}

/**
 * Her besleme kalemini bir kanonik ürüne bağlar; gerekiyorsa yenisini açar.
 * @returns external_id -> group_id eşlemesi
 */
async function resolveProductGroups(
  supabase: ServiceClient,
  items: ProductFeedItem[],
  categoryIdBySlug: Map<string, string>,
  failed: SyncResult['failed'],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  // --- Adım 1: GTIN ile eşleştir (en güvenilir) ----------------------------
  const gtins = [...new Set(items.map((i) => i.gtin).filter((g): g is string => Boolean(g)))];
  const groupIdByGtin = new Map<string, string>();

  if (gtins.length > 0) {
    const { data, error } = await supabase
      .from('product_groups')
      .select('id, gtin')
      .in('gtin', gtins);

    if (error) throw new Error(`Kanonik ürünler okunamadı: ${error.message}`);
    for (const row of data ?? []) {
      if (row.gtin) groupIdByGtin.set(String(row.gtin), String(row.id));
    }
  }

  // --- Adım 2: barkodsuz kalemler için imza ile eşleştir --------------------
  const unmatchedTitles = items
    .filter((item) => !item.gtin || !groupIdByGtin.has(item.gtin))
    .map((item) => item.title);

  const groupIdBySignature = new Map<string, string>();

  if (unmatchedTitles.length > 0) {
    // Aday havuzunu daraltmak için başlıklara göre ön filtre; imza
    // karşılaştırması bellekte yapılır.
    const { data, error } = await supabase
      .from('product_groups')
      .select('id, title, brand')
      .in('title', unmatchedTitles);

    if (error) throw new Error(`Kanonik ürün adayları okunamadı: ${error.message}`);

    for (const row of data ?? []) {
      groupIdBySignature.set(
        signature(String(row.title), row.brand ? String(row.brand) : null),
        String(row.id),
      );
    }
  }

  // --- Adım 3: eşleşmeyenler için yeni kanonik ürün aç ---------------------
  const toCreate: Array<Record<string, unknown>> = [];
  const createKeyByIndex: string[] = [];
  const seenSignatures = new Set<string>();

  for (const item of items) {
    const itemSignature = signature(item.title, item.brand);

    const matchedId =
      (item.gtin ? groupIdByGtin.get(item.gtin) : undefined) ??
      groupIdBySignature.get(itemSignature);

    if (matchedId) {
      result.set(item.external_id, matchedId);
      continue;
    }

    // Aynı beslemede tekrar eden yeni ürün iki kez yaratılmamalı.
    const dedupeKey = item.gtin ?? itemSignature;
    if (seenSignatures.has(dedupeKey)) continue;
    seenSignatures.add(dedupeKey);

    toCreate.push({
      slug: `${slugify(`${item.brand ?? ''} ${item.title}`)}-${Math.random().toString(36).slice(2, 8)}`,
      title: item.title,
      brand: item.brand ?? null,
      gtin: item.gtin ?? null,
      category_id: item.category_slug
        ? categoryIdBySlug.get(item.category_slug.toLowerCase()) ?? null
        : null,
      description: item.description ?? null,
      image_url: item.image_urls[0] ?? null,
    });
    createKeyByIndex.push(dedupeKey);
  }

  if (toCreate.length > 0) {
    const { data, error } = await supabase
      .from('product_groups')
      .insert(toCreate)
      .select('id, title, brand, gtin');

    if (error) throw new Error(`Kanonik ürün oluşturulamadı: ${error.message}`);

    for (const row of data ?? []) {
      const key = row.gtin
        ? String(row.gtin)
        : signature(String(row.title), row.brand ? String(row.brand) : null);
      groupIdByGtin.set(key, String(row.id));
      groupIdBySignature.set(
        signature(String(row.title), row.brand ? String(row.brand) : null),
        String(row.id),
      );
    }
  }

  // --- Adım 4: kalan kalemleri yeni gruplara bağla -------------------------
  for (const item of items) {
    if (result.has(item.external_id)) continue;

    const itemSignature = signature(item.title, item.brand);
    const groupId =
      (item.gtin ? groupIdByGtin.get(item.gtin) : undefined) ??
      groupIdBySignature.get(itemSignature);

    if (groupId) {
      result.set(item.external_id, groupId);
    } else {
      failed.push({
        external_id: item.external_id,
        reason: 'Kanonik ürün eşleştirilemedi',
      });
    }
  }

  return result;
}

export const __testing = { signature, slugify, normalize };
