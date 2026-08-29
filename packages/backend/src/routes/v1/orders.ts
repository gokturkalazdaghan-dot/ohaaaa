/**
 * /api/v1/orders — taşeronun kendisine düşen alt siparişleri.
 *
 * Taşeron, müşterinin TÜM siparişini değil yalnızca kendi payına düşen
 * `vendor_order` kaydını ve o kayda bağlı kalemleri görür. Bu, split-cart
 * modelinin gizlilik tarafıdır: rakip taşeronun ne sattığı görünmez.
 */

import { Router } from 'express';

import { orderListQuerySchema, vendorOrderPatchSchema } from '@ohaaaa/shared';

import { conflict, notFound } from '../../lib/errors.js';
import type { ServiceClient } from '../../lib/supabase.js';
import { requireScope } from '../../middleware/apiKeyAuth.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';

/** İzin verilen durum geçişleri — geriye dönük geçişler engellenir. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  awaiting_vendor: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function ordersRouter(supabase: ServiceClient): Router {
  const router = Router();

  /** GET /api/v1/orders — taşeronun alt siparişleri, kalemleriyle. */
  router.get(
    '/',
    requireScope('orders:read'),
    validateQuery(orderListQuerySchema),
    async (req, res, next) => {
      try {
        const vendor = req.vendor!;
        const { limit, offset, status, since } = req.query as unknown as {
          limit: number;
          offset: number;
          status?: string;
          since?: string;
        };

        let query = supabase
          .from('vendor_orders')
          .select(
            `id, order_id, status, items_subtotal_cents, shipping_cents,
             commission_cents, payout_cents, commission_rate, carrier,
             tracking_number, created_at,
             order:orders ( order_number, status, shipping_address, created_at ),
             items:order_items ( id, title_snapshot, sku_snapshot, unit_price_cents,
                                 quantity, line_total_cents, product_id )`,
            { count: 'exact' },
          )
          .eq('vendor_id', vendor.vendorId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (status) query = query.eq('status', status);
        if (since) query = query.gte('created_at', since);

        const { data, error, count } = await query;
        if (error) throw new Error(`Siparişler okunamadı: ${error.message}`);

        res.json({ data: data ?? [], meta: { total: count ?? 0, limit, offset } });
      } catch (error) {
        next(error);
      }
    },
  );

  /** PATCH /api/v1/orders/:id — durum ve kargo bilgisi güncelleme. */
  router.patch(
    '/:id',
    requireScope('orders:write'),
    validateBody(vendorOrderPatchSchema),
    async (req, res, next) => {
      try {
        const vendor = req.vendor!;
        const vendorOrderId = req.params.id!;
        const patch = req.body as {
          status?: string;
          carrier?: string | null;
          tracking_number?: string | null;
        };

        const { data: current, error: readError } = await supabase
          .from('vendor_orders')
          .select('id, status')
          .eq('id', vendorOrderId)
          .eq('vendor_id', vendor.vendorId)
          .maybeSingle();

        if (readError) throw new Error(`Sipariş okunamadı: ${readError.message}`);
        if (!current) throw notFound(`Sipariş bulunamadı: ${vendorOrderId}`);

        const updates: Record<string, unknown> = {};
        if (patch.carrier !== undefined) updates.carrier = patch.carrier;
        if (patch.tracking_number !== undefined) updates.tracking_number = patch.tracking_number;

        if (patch.status) {
          const allowed = ALLOWED_TRANSITIONS[String(current.status)] ?? [];

          if (!allowed.includes(patch.status)) {
            throw conflict(
              `'${current.status}' durumundan '${patch.status}' durumuna geçilemez.`,
              { current_status: current.status, allowed_transitions: allowed },
            );
          }

          updates.status = patch.status;
          if (patch.status === 'shipped') updates.shipped_at = new Date().toISOString();
          if (patch.status === 'delivered') updates.delivered_at = new Date().toISOString();
        }

        const { data, error } = await supabase
          .from('vendor_orders')
          .update(updates)
          .eq('id', vendorOrderId)
          .eq('vendor_id', vendor.vendorId)
          .select('id, status, carrier, tracking_number, shipped_at, delivered_at')
          .maybeSingle();

        if (error) throw new Error(`Sipariş güncellenemedi: ${error.message}`);
        if (!data) throw notFound(`Sipariş bulunamadı: ${vendorOrderId}`);

        req.log.info('Alt sipariş güncellendi', {
          vendor_order_id: vendorOrderId,
          new_status: data.status,
        });

        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
