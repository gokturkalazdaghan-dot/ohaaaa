/**
 * Belge tablosu ile şemanın AYNI ŞEYİ söylediğinin kanıtı.
 *
 * Bu test, elle yazılmış bir referans tablosunun kabul edilebilir olmasının
 * TEK sebebidir. Tablo kodun yanında durur ama koddan türetilmez; türetilmiş
 * gibi davranmasını sağlayan şey burada yapılan çapraz kontroldür.
 *
 * "Zorunlu" iddiası ŞEMA İÇİ YAPIYA BAKARAK değil, DAVRANIŞLA sınanır:
 * geçerli bir gövdeden alan çıkarılır ve şemanın reddedip reddetmediğine
 * bakılır. Zod'un iç yapısına dokunmayan tek güvenilir yol budur; sürüm
 * yükseltmesi testi kırmaz, gerçek bir sözleşme değişikliği kırar.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { PRODUCT_FEED_FIELDS, productFeedItemSchema } from './schemas.js';

import { FEED_FIELDS } from './feedFields.js';

/** Her alanı dolu, geçerli bir kalem. */
function validItem(): Record<string, unknown> {
  return {
    external_id: 'SKU-1',
    sku: 'SKU-1',
    title: 'Örnek Ürün',
    description: 'Açıklama',
    brand: 'Marka',
    gtin: '1234567890123',
    category_slug: 'elektronik',
    image_urls: ['https://example.com/a.jpg'],
    price_cents: 10_000,
    compare_at_price_cents: 12_000,
    currency: 'TRY',
    stock: 5,
    condition: 'new',
    shipping_fee_cents: 0,
    free_shipping_threshold_cents: 50_000,
    estimated_delivery_days: 3,
    status: 'active',
    attributes: { renk: 'siyah' },
  };
}

test('gecerli kalem sema tarafindan kabul ediliyor (temel varsayim)', () => {
  assert.equal(productFeedItemSchema.safeParse(validItem()).success, true);
});

test('belgelenen her alan semada var', () => {
  for (const field of FEED_FIELDS) {
    assert.ok(
      (PRODUCT_FEED_FIELDS as string[]).includes(field.name),
      `belgede olan '${field.name}' alani semada yok`,
    );
  }
});

test('semadaki her alan belgelenmis', () => {
  const documented = new Set(FEED_FIELDS.map((f) => f.name));
  for (const name of PRODUCT_FEED_FIELDS as string[]) {
    assert.ok(
      documented.has(name),
      `semada olan '${name}' alani belgelenmemis — API dokumantasyonu eksik kaldi`,
    );
  }
});

test('"zorunlu" denen alanlar gercekten zorunlu', () => {
  for (const field of FEED_FIELDS.filter((f) => f.required)) {
    const item = validItem();
    delete item[field.name];
    assert.equal(
      productFeedItemSchema.safeParse(item).success,
      false,
      `'${field.name}' zorunlu diye belgelenmis ama semaya gore degil`,
    );
  }
});

test('"istege bagli" denen alanlar gercekten istege bagli', () => {
  for (const field of FEED_FIELDS.filter((f) => !f.required)) {
    const item = validItem();
    delete item[field.name];
    const result = productFeedItemSchema.safeParse(item);
    assert.equal(
      result.success,
      true,
      `'${field.name}' istege bagli diye belgelenmis ama semaya gore zorunlu`,
    );
  }
});

test('belgelenen varsayilanlar semanin uyguladigi degerlerle ayni', () => {
  // Yalnizca zorunlu alanlar gonderilir; geri kalanini sema doldurur.
  const parsed = productFeedItemSchema.parse({
    external_id: 'SKU-1',
    title: 'Örnek Ürün',
    price_cents: 10_000,
    stock: 5,
  }) as Record<string, unknown>;

  /*
   * Belgedeki varsayilan INSANA gore yazilmis bir metin ('TRY', '[]', '3').
   * JSON olarak okunabiliyorsa oyle okunur, okunamiyorsa duz metin sayilir —
   * boylece tabloya `"TRY"` gibi tirnakli, okunmasi zor bir deger yazmak
   * gerekmiyor ama karsilastirma yine deger uzerinden yapiliyor.
   */
  const asValue = (text: string): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };

  for (const field of FEED_FIELDS) {
    if (field.fallback === undefined) continue;
    assert.deepEqual(
      parsed[field.name],
      asValue(field.fallback),
      `'${field.name}' varsayilani belgede '${field.fallback}' ama sema baskasini uyguluyor`,
    );
  }
});

test('varsayilani olan her alan belgede de varsayilan tasiyor', () => {
  // Ters yon: sema bir deger dolduruyorsa belge sessiz kalmamali.
  const parsed = productFeedItemSchema.parse({
    external_id: 'SKU-1',
    title: 'Örnek Ürün',
    price_cents: 10_000,
    stock: 5,
  }) as Record<string, unknown>;

  const required = new Set(FEED_FIELDS.filter((f) => f.required).map((f) => f.name));

  for (const field of FEED_FIELDS) {
    if (required.has(field.name)) continue;
    const applied = parsed[field.name];
    const semaDolduruyor = applied !== undefined && applied !== null;
    assert.equal(
      semaDolduruyor,
      field.fallback !== undefined,
      semaDolduruyor
        ? `'${field.name}' icin sema '${JSON.stringify(applied)}' uyguluyor ama belgede varsayilan yazmiyor`
        : `'${field.name}' belgede varsayilan tasiyor ama sema bir deger uygulamiyor`,
    );
  }
});
