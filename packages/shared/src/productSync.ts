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

/**
 * `match_signature` sütunu yoksa hatayı ANLAŞILIR hale getirir.
 *
 * Sütun `20260830150000_product_signature.sql` ile geliyor. Göç
 * uygulanmadan bir mağaza ürün göndermeye başlarsa PostgREST'ten dönen
 * ham mesaj ("column product_groups.match_signature does not exist")
 * teknik olarak doğru ama işletmeciye ne yapması gerektiğini söylemez —
 * ve bu, ilk mağaza bağlandığında görülecek hatadır.
 *
 * Yanlış eşleşmeye düşmek yerine yükseltilerek durulur: sütun olmadan
 * imza eşleşmesi yapılamaz ve her teklif kendi kanonik ürününü açar,
 * yani katalog sessizce ve KALICI olarak bozulur.
 */
export function describeSignatureError(message: string): string {
  const missingColumn =
    message.includes('match_signature') &&
    (message.includes('does not exist') || message.includes('schema cache'));

  if (!missingColumn) return message;

  return (
    `${message} — 'product_groups.match_signature' sütunu bulunamadı. ` +
    `Veritabanı göçü uygulanmamış görünüyor: ` +
    `SUPABASE_DB_URL='<bağlantı adresi>' ./scripts/apply-migrations.sh`
  );
}

/**
 * Kanonik eşleştirme imzası: marka + sadeleştirilmiş, SIRALANMIŞ başlık.
 *
 * Aynı hesap veritabanında da `public.product_signature()` olarak vardır ve
 * `product_groups.match_signature` üretilen sütununu doldurur. İkisinin
 * BİREBİR aynı değeri üretmesi zorunludur; ayrışırlarsa arama hiçbir aday
 * bulamaz ve her teklif kendi kanonik ürününü açar — yani karşılaştırma
 * sessizce çalışmaz olur. Kelime sıralaması bu yüzden iki tarafta da bayt
 * sırasıdır (SQL tarafında `collate "C"`).
 */
export function productSignature(title: string, brand: string | null | undefined): string {
  const normalizedTitle = normalize(title)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0)
    .sort()               // kelime sırası farkı eşleşmeyi bozmasın
    .join(' ');

  return `${normalize(brand ?? '')}|${normalizedTitle}`;
}

/** Dosya içi kısa ad. */
const signature = productSignature;

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
  /*
   * Ön filtre İMZA sütunu üzerinden yapılır, başlık eşitliği üzerinden değil.
   *
   * Önceden `.in('title', başlıklar)` kullanılıyordu; bu, imzayı işlevsiz
   * bırakıyordu: imza yalnızca başlık zaten harfi harfine aynıysa
   * karşılaştırılıyordu, o durumda da hiçbir şey katmıyordu. Sonuçta iki
   * satıcı "Kablosuz Kulaklık" ve "Kulaklık Kablosuz" yazdığında iki ayrı
   * kanonik ürün oluşuyor ve fiyatları hiç karşılaştırılmıyordu — sitenin
   * var olma sebebi olan işlev sessizce çalışmıyordu.
   */
  const unmatchedSignatures = [
    ...new Set(
      items
        .filter((item) => !item.gtin || !groupIdByGtin.has(item.gtin))
        .map((item) => signature(item.title, item.brand)),
    ),
  ];

  const groupIdBySignature = new Map<string, string>();

  if (unmatchedSignatures.length > 0) {
    const { data, error } = await supabase
      .from('product_groups')
      .select('id, match_signature')
      .in('match_signature', unmatchedSignatures);

    if (error) throw new Error(`Kanonik ürün adayları okunamadı: ${describeSignatureError(error.message)}`);

    for (const row of data ?? []) {
      if (row.match_signature) groupIdBySignature.set(String(row.match_signature), String(row.id));
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
    // match_signature ÜRETİLEN bir sütun: yazılmaz, veritabanı hesaplar.
    // Geri okunması, JS ile SQL'in aynı değeri ürettiğini de doğrular.
    const { data, error } = await supabase
      .from('product_groups')
      .insert(toCreate)
      .select('id, title, brand, gtin, match_signature');

    if (error) throw new Error(`Kanonik ürün oluşturulamadı: ${describeSignatureError(error.message)}`);

    for (const row of data ?? []) {
      const rowSignature = row.match_signature
        ? String(row.match_signature)
        : signature(String(row.title), row.brand ? String(row.brand) : null);

      if (row.gtin) groupIdByGtin.set(String(row.gtin), String(row.id));
      groupIdBySignature.set(rowSignature, String(row.id));
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
