/**
 * IngestRepository'nin Supabase uygulaması.
 *
 * service_role anahtarı RLS'i bypass eder; yetkilendirme bu dosyanın
 * sorumluluğundadır. Her sorgu `merchant_id`/`source_id` ile kapsanır —
 * bir kaynağın alımı başka bir mağazanın verisine dokunamaz.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { describeSignatureError } from '@ohaaaa/shared/product-sync';

import type { IngestRepository } from './pipeline.js';
import { canonicalSignature } from './pipeline.js';
import type { IngestSummary, NormalizedOffer, SourceConfig } from './types.js';
import { redact } from './http/redact.js';

/** Tek sorguda gönderilecek en fazla satır. Daha büyüğü istek sınırını aşar. */
const UPSERT_BATCH_SIZE = 500;

export function createSupabaseRepository(supabase: SupabaseClient): IngestRepository {
  return {
    async findGroupsByGtin(gtins) {
      const result = new Map<string, string>();
      if (gtins.length === 0) return result;

      // GTIN listesi büyük olabilir; parçalayarak sorgula.
      for (const batch of chunk(gtins, 500)) {
        const { data, error } = await supabase
          .from('product_groups')
          .select('id, gtin')
          .in('gtin', batch);

        if (error) throw new Error(`Kanonik ürün sorgusu başarısız: ${error.message}`);

        for (const row of data ?? []) {
          if (row.gtin) result.set(String(row.gtin), String(row.id));
        }
      }

      return result;
    },

    async findGroupsBySignature(signatures) {
      const result = new Map<string, string>();
      if (signatures.length === 0) return result;

      /*
       * İmza artık veritabanında ÜRETİLEN bir sütunda duruyor
       * (`product_groups.match_signature`) ve eşleştirme doğrudan onun
       * üzerinden yapılıyor.
       *
       * Önceden markaya göre aday çekilip imza bellekte karşılaştırılıyordu.
       * O yaklaşım markası boş ya da farklı yazılmış kayıtları hiç bulamıyor,
       * bulduklarında da gereksiz büyük bir küme getiriyordu. İmza sütunu
       * indeksli olduğu için bu sorgu hem doğru hem ucuz.
       *
       * Sütun üretilen olduğu için algoritma değişirse ALTER TABLE ile
       * yeniden hesaplanır; bayat değer kalmaz.
       */
      for (const batch of chunk(signatures, 200)) {
        const { data, error } = await supabase
          .from('product_groups')
          .select('id, match_signature')
          .in('match_signature', batch);

        if (error)
          throw new Error(`Kanonik ürün adayları alınamadı: ${describeSignatureError(error.message)}`);

        const wanted = new Set(signatures);

        for (const row of data ?? []) {
          const signature = String(row.match_signature ?? '');
          if (wanted.has(signature)) result.set(signature, String(row.id));
        }
      }

      return result;
    },

    async createGroups(groups) {
      const result = new Map<string, string>();
      if (groups.length === 0) return result;

      const rows = groups.map((group) => ({
        slug: buildSlug(group.brand, group.title),
        title: group.title,
        brand: group.brand,
        gtin: group.gtin,
        image_url: group.imageUrl,
      }));

      for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
        const { data, error } = await supabase
          .from('product_groups')
          .insert(batch)
          .select('id, title, brand');

        if (error) throw new Error(`Kanonik ürün oluşturulamadı: ${error.message}`);

        for (const row of data ?? []) {
          result.set(
            canonicalSignature(String(row.title), row.brand ? String(row.brand) : null),
            String(row.id),
          );
        }
      }

      return result;
    },

    async upsertOffers(merchantId, sourceId, rows, market) {
      if (rows.length === 0) return { created: 0, updated: 0 };

      // Hangilerinin yeni olduğunu bilmek için önce mevcutları oku.
      const existing = new Set<string>();

      for (const batch of chunk(rows.map((r) => r.externalId), 500)) {
        const { data, error } = await supabase
          .from('products')
          .select('external_id')
          .eq('merchant_id', merchantId)
          .in('external_id', batch);

        if (error) throw new Error(`Mevcut teklifler okunamadı: ${error.message}`);
        for (const row of data ?? []) existing.add(String(row.external_id));
      }

      const now = new Date().toISOString();

      const payload = rows.map((row) => ({
        fulfillment: 'affiliate' as const,
        merchant_id: merchantId,
        source_id: sourceId,
        group_id: row.groupId,
        external_id: row.externalId,
        title: row.title,
        description: row.description,
        brand: row.brand,
        image_urls: row.imageUrls,
        product_url: row.productUrl,
        price_cents: row.priceCents,
        compare_at_price_cents: row.compareAtPriceCents,
        currency: row.currency,
        // Pazar KAYNAKTAN gelir, fiyattan tahmin edilmez. Şema ayrıca
        // pazar ile para biriminin uyumunu zorunlu kılıyor
        // (products_market_currency_uyumlu).
        market,
        // Bir sonraki turda "değişti mi" sorusunu yanıtlayacak olan özet.
        fingerprint: row.fingerprint,
        stock: row.stock,
        shipping_fee_cents: row.shippingFeeCents,
        // Stok yoksa vitrine çıkmaz; feed 'active' dese bile.
        status: row.stock > 0 ? 'active' : 'out_of_stock',
        last_seen_at: now,
        // YENİ satırlarda `touchSeen` henüz eşleşecek bir kayıt bulamaz;
        // damgalar burada da yazılıyor ki ilk turdan itibaren tazelik
        // ölçülebilsin.
        price_checked_at: now,
        stock_checked_at: now,
        offer_checked_at: now,
      }));

      for (const batch of chunk(payload, UPSERT_BATCH_SIZE)) {
        const { error } = await supabase
          .from('products')
          .upsert(batch, { onConflict: 'merchant_id,external_id' });

        if (error) throw new Error(`Teklifler yazılamadı: ${error.message}`);
      }

      const created = rows.filter((row) => !existing.has(row.externalId)).length;
      return { created, updated: rows.length - created };
    },

    /**
     * Bu kaynağın bilinen parmak izleri.
     *
     * Parmak izi NULL olan satırlar haritaya girmez: onlar delta ile hiç
     * işlenmemiş eski kayıtlardır ve NEW sayılıp bir kez yazılarak
     * parmak izi kazanmaları doğru davranış -- "değişmedi" diyip
     * atlamak, onları sonsuza dek izsiz bırakırdı.
     */
    async getFingerprints(sourceId) {
      const harita = new Map<string, string>();
      const SAYFA = 1000;

      /*
       * SAYFALAMA ZORUNLU. PostgREST varsayılan olarak sonuçları
       * sınırlıyor; tek çağrı bir kaynağın on binlerce teklifini
       * döndürmez ve sessizce eksik bir "önceki durum" haritası,
       * değişmemiş ürünleri NEW gibi gösterirdi.
       */
      for (let offset = 0; ; offset += SAYFA) {
        const { data, error } = await supabase
          .from('products')
          .select('external_id, fingerprint')
          .eq('source_id', sourceId)
          .not('fingerprint', 'is', null)
          .range(offset, offset + SAYFA - 1);

        if (error) throw new Error(`Parmak izleri okunamadı: ${error.message}`);
        if (!data || data.length === 0) break;

        for (const row of data) {
          harita.set(String(row.external_id), String(row.fingerprint));
        }

        if (data.length < SAYFA) break;
      }

      return harita;
    },
    /**
     * Görülen tekliflere "gördük ve doğruladık" damgası.
     *
     * Dört damga birden yazılıyor çünkü bir feed satırı bu bilgilerin
     * hepsini aynı anda taşıyor: fiyat, stok ve teklifin kendisi tek bir
     * gözlemden geliyor. Ayrı ayrı yazmak, aynı gözlemi üç farklı ana
     * bölmek olurdu.
     *
     * `last_price_change_at` BURADA YAZILMAZ -- onu tetikleyici, fiyat
     * gerçekten değiştiğinde atıyor.
     */
    async touchSeen(sourceId, externalIds, checkedAt) {
      if (externalIds.length === 0) return;

      const damga = checkedAt.toISOString();

      for (const batch of chunk(externalIds, UPSERT_BATCH_SIZE)) {
        const { error } = await supabase
          .from('products')
          .update({
            last_seen_at: damga,
            price_checked_at: damga,
            stock_checked_at: damga,
            offer_checked_at: damga,
          })
          .eq('source_id', sourceId)
          .in('external_id', batch);

        if (error) throw new Error(`Görülme damgası yazılamadı: ${error.message}`);
      }
    },
    async markStale(sourceId, runStartedAt) {
      /*
       * Bu çalışmada görülmeyen teklifler stoksuz işaretlenir — SİLİNMEZ.
       * Silme geri alınamaz; stoksuz işaretleme bir sonraki başarılı alımda
       * kendiliğinden düzelir.
       */
      const { data, error } = await supabase
        .from('products')
        .update({ status: 'out_of_stock', stock: 0 })
        .eq('source_id', sourceId)
        .lt('last_seen_at', runStartedAt.toISOString())
        .eq('status', 'active')
        .select('id');

      if (error) throw new Error(`Bayat teklifler işaretlenemedi: ${error.message}`);
      return data?.length ?? 0;
    },

    async saveRefreshPlan(sourceId, plan) {
      const { error } = await supabase
        .from('sources')
        .update({
          next_refresh_at: plan.nextRefreshAt.toISOString(),
          refresh_class: plan.freshnessClass,
          // Gerekçeler saklanıyor: sebebini taşımayan bir zamanlama
          // kararı hata ayıklanamaz.
          refresh_reasons: plan.reasons,
          refresh_planned_at: new Date().toISOString(),
        })
        .eq('id', sourceId);

      if (error) throw new Error(`Yenileme planı yazılamadı: ${error.message}`);
    },
    async startRun(sourceId) {
      const { data, error } = await supabase
        .from('ingest_runs')
        .insert({ source_id: sourceId, status: 'running' })
        .select('id')
        .single();

      if (error) throw new Error(`Çalışma kaydı açılamadı: ${error.message}`);
      return String(data.id);
    },

    async finishRun(runId, summary) {
      const { error } = await supabase
        .from('ingest_runs')
        .update({
          status: summary.status,
          finished_at: new Date().toISOString(),
          duration_ms: summary.durationMs,
          items_seen: summary.itemsSeen,
          items_created: summary.itemsCreated,
          items_updated: summary.itemsUpdated,
          items_skipped: summary.itemsSkipped,
          items_failed: summary.itemsFailed,
          // Delta sonucu: kaynağın ne yaptığı. Testlerden elle değil,
          // gerçek sınıflandırmadan geliyor.
          items_new: summary.itemsNew,
          items_changed: summary.itemsChanged,
          items_unchanged: summary.itemsUnchanged,
          items_deleted: summary.itemsDeleted,
          snapshot_complete: summary.snapshotComplete,
          sample_errors: summary.sampleErrors,
          // Veritabanına düz metin kimlik bilgisi YAZILMAZ; `runSource`
          // zaten temizliyor, bu sütun son savunma hattı.
          error: summary.error === null || summary.error === undefined
            ? null
            : redact(summary.error),
        })
        .eq('id', runId);

      if (error) {
        // Çalışma kaydı yazılamazsa hattı düşürmeyiz; veri zaten işlendi.
        console.error(
          JSON.stringify({
            level: 'warn',
            msg: 'Çalışma kaydı güncellenemedi',
            run_id: runId,
            error: error.message,
          }),
        );
      }

      // Kaynağın özet alanlarını tazele (panel bunları okur).
      await supabase
        .from('sources')
        .update({
          last_run_at: new Date().toISOString(),
          last_status: summary.status,
          last_error: summary.error === null || summary.error === undefined
            ? null
            : redact(summary.error),
          last_item_count: summary.itemsSeen,
        })
        .eq('id', summary.sourceId);
    },
  };
}

/** Alım için etkin kaynakları, mağaza bilgileriyle birlikte okur. */
export async function loadSources(
  supabase: SupabaseClient,
  /*
   * `id` süzgeci SOURCE_SYNC işleyicisi için eklendi: iş yükü yalnızca
   * kaynak kimliği taşıyor ve kaynak veritabanından YENİDEN çözülüyor.
   * İkinci bir yükleyici yazmak, "etkin kaynak" ve "aktif satıcı"
   * koşullarını iki yerde tutmak olurdu.
   */
  filter: { slug?: string; id?: string } = {},
): Promise<SourceConfig[]> {
  let query = supabase
    .from('sources')
    .select(
      `id, slug, merchant_id, kind, endpoint_url, field_mapping, currency, market,
       merchant:merchants!inner ( id, status, homepage_url, deeplink_template )`,
    )
    .eq('is_enabled', true)
    .eq('merchants.status', 'active');

  if (filter.slug) query = query.eq('slug', filter.slug);
  if (filter.id) query = query.eq('id', filter.id);

  const { data, error } = await query;
  if (error) throw new Error(`Kaynaklar okunamadı: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const rawMerchant = row.merchant;
    const merchant = (Array.isArray(rawMerchant) ? rawMerchant[0] : rawMerchant) as
      | Record<string, unknown>
      | null;

    const homepage = merchant?.homepage_url ? String(merchant.homepage_url) : '';
    let host = '';
    try {
      host = new URL(homepage).hostname;
    } catch {
      host = '';
    }

    return {
      id: String(row.id),
      slug: String(row.slug),
      merchantId: String(row.merchant_id),
      kind: row.kind as SourceConfig['kind'],
      endpointUrl: row.endpoint_url ? String(row.endpoint_url) : null,
      fieldMapping: (row.field_mapping ?? {}) as SourceConfig['fieldMapping'],
      currency: String(row.currency ?? 'TRY'),
      market: (String(row.market ?? 'TR') as SourceConfig['market']),
      allowedHosts: host ? [host] : [],
    };
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/** Kanonik ürün için benzersiz slug. Sonek çakışmayı önler. */
function buildSlug(brand: string | null, title: string): string {
  const map: Record<string, string> = {
    ğ: 'g', ü: 'u', ş: 's', ı: 'i', ö: 'o', ç: 'c',
  };

  const base = `${brand ?? ''} ${title}`
    .toLowerCase()
    .replace(/[ğüşıöç]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);

  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
