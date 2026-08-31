/**
 * Zod şemaları — taşeron API'sinin ve web formlarının giriş doğrulaması.
 *
 * Doğrulama tek bir yerde tanımlanır: backend gelen isteği, frontend ise
 * formu aynı şemayla kontrol eder. Böylece "API kabul etmiyor ama form
 * gönderiyordu" sınıfı hatalar yapısal olarak imkânsız hale gelir.
 */

import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from './money.js';
import { API_SCOPES } from './types.js';
import { useTurkishZodMessages } from './zodTurkish.js';

/*
 * Doğrulama mesajları Türkçeleştirilir. Bu modül içe aktarıldığı anda
 * kurulur — şemaların hepsi buradan geçtiği için web formları, taşeron
 * API'si ve besleme hattı aynı metinleri görür.
 */
useTurkishZodMessages();

/** Kuruş cinsinden tutar: negatif olamaz, ondalık olamaz. */
const centsSchema = z
  .number()
  .int('Tutar kuruş cinsinden tam sayı olmalıdır')
  .nonnegative('Tutar negatif olamaz')
  .max(99_999_999_999, 'Tutar üst sınırı aşıyor');

/*
 * Taşeron beslemesindeki tek bir ürün.
 *
 * İç nesne AYRI tutulur: `.refine()` sonucu bir ZodEffects'tir ve `.shape`
 * taşımaz. Belgelerdeki alan tablosu ile bu tablonun şemaya uyduğunu sınayan
 * test, anahtar listesini buradan okur — elle yazılmış bir liste, şemaya yeni
 * bir alan eklendiğinde sessizce eskir.
 */
const productFeedItemObject = z
  .object({
    /** Taşeronun kendi sistemindeki benzersiz kimlik — upsert anahtarı. */
    external_id: z.string().min(1).max(120),
    sku: z.string().max(120).nullish(),
    title: z.string().min(2).max(300),
    description: z.string().max(20_000).nullish(),
    brand: z.string().max(120).nullish(),

    /** Kanonik ürün eşleştirme ipucu: varsa barkod en güvenilir yoldur. */
    gtin: z
      .string()
      .regex(/^\d{8}$|^\d{12,14}$/, 'GTIN 8, 12, 13 veya 14 haneli olmalıdır')
      .nullish(),
    category_slug: z.string().max(120).nullish(),

    image_urls: z.array(z.string().url()).max(12).default([]),

    price_cents: centsSchema,
    compare_at_price_cents: centsSchema.nullish(),
    currency: z.enum(SUPPORTED_CURRENCIES).default('TRY'),

    stock: z.number().int().min(0).max(1_000_000),
    condition: z.enum(['new', 'refurbished', 'used']).default('new'),

    shipping_fee_cents: centsSchema.default(0),
    free_shipping_threshold_cents: centsSchema.nullish(),
    estimated_delivery_days: z.number().int().min(0).max(90).default(3),

    status: z.enum(['draft', 'active', 'out_of_stock', 'archived']).default('active'),
    attributes: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const productFeedItemSchema = productFeedItemObject.refine(
  (item) =>
    item.compare_at_price_cents == null ||
    item.compare_at_price_cents >= item.price_cents,
  {
    message: 'Üstü çizili fiyat (compare_at_price_cents) satış fiyatından düşük olamaz',
    path: ['compare_at_price_cents'],
  },
);

/** Besleme alanlarının adları — belge tablosu ve testi bunu kaynak alır. */
export const PRODUCT_FEED_FIELDS = Object.keys(
  productFeedItemObject.shape,
) as Array<keyof typeof productFeedItemObject.shape>;

export type ProductFeedItem = z.infer<typeof productFeedItemSchema>;

/**
 * Toplu besleme isteği.
 *
 * 500 sınırı bilinçlidir: tek istekte daha fazlası hem istek zaman aşımına
 * hem de kısmi başarısızlıkta belirsiz duruma yol açar. Taşeronlar
 * sayfalayarak besler; her sayfa idempotenttir.
 */
export const productFeedRequestSchema = z
  .object({
    products: z.array(productFeedItemSchema).min(1).max(500),
    /**
     * true ise, bu istekte GÖNDERİLMEYEN ürünler arşivlenir (tam senkron).
     * Kısmi besleme yapan taşeronlar bunu false bırakmalıdır.
     */
    archive_missing: z.boolean().default(false),
  })
  .strict();

export type ProductFeedRequest = z.infer<typeof productFeedRequestSchema>;

/** Stok/fiyat gibi tek alan güncellemeleri için kısmi şema. */
export const productPatchSchema = z
  .object({
    title: z.string().min(2).max(300).optional(),
    description: z.string().max(20_000).nullish(),
    price_cents: centsSchema.optional(),
    compare_at_price_cents: centsSchema.nullish(),
    stock: z.number().int().min(0).max(1_000_000).optional(),
    shipping_fee_cents: centsSchema.optional(),
    free_shipping_threshold_cents: centsSchema.nullish(),
    estimated_delivery_days: z.number().int().min(0).max(90).optional(),
    status: z.enum(['draft', 'active', 'out_of_stock', 'archived']).optional(),
    image_urls: z.array(z.string().url()).max(12).optional(),
    attributes: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'En az bir alan gönderilmelidir',
  });

export type ProductPatch = z.infer<typeof productPatchSchema>;

/** Ürün listeleme sorgu parametreleri. */
export const productListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['draft', 'active', 'out_of_stock', 'archived']).optional(),
  q: z.string().max(200).optional(),
});

/** Taşeronun alt sipariş durumunu güncellemesi. */
export const vendorOrderPatchSchema = z
  .object({
    status: z.enum(['accepted', 'preparing', 'shipped', 'delivered', 'cancelled']).optional(),
    carrier: z.string().max(120).nullish(),
    tracking_number: z.string().max(120).nullish(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'En az bir alan gönderilmelidir',
  })
  .refine((v) => v.status !== 'shipped' || Boolean(v.tracking_number), {
    message: 'Kargoya verildi (shipped) durumu için takip numarası zorunludur',
    path: ['tracking_number'],
  });

export const orderListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .enum(['awaiting_vendor', 'accepted', 'preparing', 'shipped', 'delivered', 'cancelled'])
    .optional(),
  since: z.string().datetime().optional(),
});

/** Taşeron başvuru formu (web). */
export const vendorApplicationSchema = z.object({
  display_name: z.string().min(2, 'Mağaza adı en az 2 karakter olmalı').max(120),
  slug: z
    .string()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])$/, 'Yalnızca küçük harf, rakam ve tire kullanın'),
  legal_name: z.string().min(2).max(200),
  tax_id: z.string().min(10).max(11).regex(/^\d+$/, 'Vergi/TC kimlik numarası yalnızca rakam içermeli'),
  support_email: z.string().email('Geçerli bir e-posta girin'),
  support_phone: z.string().max(30).optional(),
  website_url: z.string().url('Geçerli bir adres girin').optional().or(z.literal('')),
  description: z.string().min(20, 'En az 20 karakterlik bir tanıtım yazın').max(2000),
});

export type VendorApplication = z.infer<typeof vendorApplicationSchema>;

/** API anahtarı oluşturma. */
export const createApiKeySchema = z.object({
  name: z.string().min(2, 'Anahtara tanıyabileceğiniz bir isim verin').max(80),
  environment: z.enum(['live', 'test']).default('live'),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'En az bir yetki seçin'),
  expires_in_days: z.number().int().min(1).max(3650).nullish(),
});

/** Ödeme (simülasyon) formu. */
export const checkoutSchema = z.object({
  email: z.string().email('Geçerli bir e-posta girin'),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1, 'Sepetiniz boş')
    .max(100),
  shipping_address: z.object({
    full_name: z.string().min(3, 'Ad soyad giriniz').max(120),
    phone: z.string().min(10, 'Telefon numarası giriniz').max(30),
    city: z.string().min(2).max(60),
    district: z.string().min(2).max(60),
    address_line: z.string().min(10, 'Açık adres giriniz').max(500),
    postal_code: z.string().max(10).optional(),
  }),
  notes: z.string().max(1000).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
