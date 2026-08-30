/**
 * /api/v1/products — taşeron ürün besleme uç noktaları.
 *
 * Tüm uç noktalar `req.vendor.vendorId` ile kapsanır. İstemciden gelen
 * hiçbir vendor_id değerine güvenilmez: service_role istemcisi RLS'i
 * bypass ettiği için yetkilendirme bu satırların sorumluluğundadır.
 */

import { Router } from 'express';

import {
  productFeedRequestSchema,
  productListQuerySchema,
  productPatchSchema,
  type ProductFeedRequest,
} from '@ohaaaa/shared';

import { notFound } from '../../lib/errors.js';
import type { ServiceClient } from '../../lib/supabase.js';
import { requireScope } from '../../middleware/apiKeyAuth.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { syncProducts } from '../../services/productSync.js';

export function productsRouter(supabase: ServiceClient): Router {
  const router = Router();

  /**
   * POST /api/v1/products
   * Toplu ürün beslemesi (upsert). İdempotenttir: aynı `external_id` ile
   * tekrar gönderim mükerrer kayıt oluşturmaz, mevcut kaydı günceller.
   */
  router.post(
    '/',
    requireScope('products:write'),
    validateBody(productFeedRequestSchema),
    async (req, res, next) => {
      try {
        const vendor = req.vendor!;
        const body = req.body as ProductFeedRequest;

        const result = await syncProducts(
          supabase,
          vendor.vendorId,
          body.products,
          body.archive_missing,
        );

        req.log.info('Ürün beslemesi işlendi', {
          received: result.received,
          created: result.created,
          updated: result.updated,
          archived: result.archived,
          failed: result.failed.length,
        });

        // 207 değil 200: kısmi hatalar gövdede raporlanır, HTTP semantiği
        // basit tutulur — taşeron entegrasyonlarının çoğu 2xx/4xx ayrımı yapar.
        res.status(200).json({
          data: {
            received: result.received,
            created: result.created,
            updated: result.updated,
            archived: result.archived,
            failed: result.failed,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /** GET /api/v1/products — taşeronun kendi kataloğu. */
  router.get(
    '/',
    requireScope('products:read'),
    validateQuery(productListQuerySchema),
    async (req, res, next) => {
      try {
        const vendor = req.vendor!;
        const { limit, offset, status, q } = req.query as unknown as {
          limit: number;
          offset: number;
          status?: string;
          q?: string;
        };

        let query = supabase
          .from('products')
          .select(
            `id, external_id, sku, title, brand, price_cents, compare_at_price_cents,
             currency, stock, status, condition, shipping_fee_cents,
             estimated_delivery_days, image_urls, group_id, updated_at`,
            { count: 'exact' },
          )
          .eq('vendor_id', vendor.vendorId)
          .order('updated_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (status) query = query.eq('status', status);
        if (q) query = query.ilike('title', `%${q}%`);

        const { data, error, count } = await query;
        if (error) throw new Error(`Ürünler okunamadı: ${error.message}`);

        res.json({
          data: data ?? [],
          meta: { total: count ?? 0, limit, offset },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /** PATCH /api/v1/products/:externalId — tek ürün kısmi güncelleme. */
  router.patch(
    '/:externalId',
    requireScope('products:write'),
    validateBody(productPatchSchema),
    async (req, res, next) => {
      try {
        const vendor = req.vendor!;
        const externalId = req.params.externalId!;

        const { data, error } = await supabase
          .from('products')
          .update(req.body as Record<string, unknown>)
          .eq('vendor_id', vendor.vendorId)
          .eq('external_id', externalId)
          .select('id, external_id, title, price_cents, stock, status')
          .maybeSingle();

        if (error) throw new Error(`Ürün güncellenemedi: ${error.message}`);
        if (!data) throw notFound(`Ürün bulunamadı: ${externalId}`);

        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * DELETE /api/v1/products/:externalId
   * Ürün fiziksel olarak SİLİNMEZ, arşivlenir: geçmiş siparişlerin kalem
   * anlık görüntüleri korunur ve taşeron yanlışlıkla sildiğinde geri alınabilir.
   */
  router.delete('/:externalId', requireScope('products:write'), async (req, res, next) => {
    try {
      const vendor = req.vendor!;
      const externalId = req.params.externalId!;

      const { data, error } = await supabase
        .from('products')
        .update({ status: 'archived' })
        .eq('vendor_id', vendor.vendorId)
        .eq('external_id', externalId)
        .select('id, external_id, status')
        .maybeSingle();

      if (error) throw new Error(`Ürün arşivlenemedi: ${error.message}`);
      if (!data) throw notFound(`Ürün bulunamadı: ${externalId}`);

      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
