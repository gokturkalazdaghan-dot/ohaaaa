/**
 * syncProducts() — kanonik ürün eşleştirmesinin iddiaları.
 *
 * NEDEN BU TESTLER ÖNEMLİ
 * Bu fonksiyon sitenin en kritik kararını verir: "gelen bu teklif, hangi
 * ürünün teklifi?" Yanlış eşleştirme (iki FARKLI ürünü birleştirmek) hiç
 * eşleştirmemekten daha zararlıdır — kullanıcı karşılaştırma sayfasında
 * baktığı üründen başkasını satın alır. Buna rağmen fonksiyonun hiç testi
 * yoktu.
 *
 * Testler sahte bir Supabase istemcisiyle çalışır: gerçek bir veritabanı
 * olmadan tüm eşleştirme dalları denenebilsin diye. Sahte istemci yalnızca
 * fonksiyonun GERÇEKTEN kullandığı işlemleri destekler; desteklenmeyen bir
 * çağrı sessizce boş dönmek yerine hata fırlatır, böylece fonksiyon
 * değişince test körleşmez.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { productSignature, syncProducts } from './productSync.js';
import type { ProductFeedItem } from './schemas.js';

// ---------------------------------------------------------------------------
// Sahte Supabase istemcisi
// ---------------------------------------------------------------------------
interface Row {
  [key: string]: unknown;
}

interface Store {
  categories: Row[];
  product_groups: Row[];
  products: Row[];
}

/** Filtreleri sırayla uygulayan basit bir sorgu kurucu. */
class FakeQuery implements PromiseLike<{ data: Row[] | null; error: null }> {
  private rows: Row[];
  private readonly store: Store;
  private readonly table: keyof Store;
  private pendingUpdate: Row | null = null;
  private filters: Array<(row: Row) => boolean> = [];

  constructor(store: Store, table: keyof Store) {
    this.store = store;
    this.table = table;
    this.rows = store[table];
  }

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  /** Yalnızca `not('external_id', 'in', '("a","b")')` biçimi desteklenir. */
  not(column: string, operator: string, raw: string): this {
    if (operator !== 'in') throw new Error(`Sahte istemci '${operator}' desteklemiyor`);
    const values = raw
      .slice(1, -1)
      .split(',')
      .map((part) => part.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
      .filter((part) => part.length > 0);
    this.filters.push((row) => !values.includes(String(row[column])));
    return this;
  }

  update(patch: Row): this {
    this.pendingUpdate = patch;
    return this;
  }

  insert(rows: Row[]): this {
    const inserted = rows.map((row, index) => ({
      id: `new-group-${this.store[this.table].length + index}`,
      ...row,
      // `match_signature` veritabaninda URETILEN bir sutun; sahte istemci de
      // onu hesaplamali, yoksa test gercek davranisi yansitmaz.
      ...(this.table === 'product_groups'
        ? {
            match_signature: productSignature(
              String(row.title ?? ''),
              row.brand === null || row.brand === undefined ? null : String(row.brand),
            ),
          }
        : {}),
    }));
    this.store[this.table].push(...inserted);
    this.rows = inserted;
    return this;
  }

  upsert(rows: Row[], options: { onConflict: string }): this {
    const keys = options.onConflict.split(',');
    for (const row of rows) {
      const existing = this.store[this.table].find((candidate) =>
        keys.every((key) => candidate[key] === row[key]),
      );
      if (existing) Object.assign(existing, row);
      else this.store[this.table].push({ id: `p-${this.store[this.table].length}`, ...row });
    }
    this.rows = rows;
    return this;
  }

  private run(): Row[] {
    const matched = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.pendingUpdate) for (const row of matched) Object.assign(row, this.pendingUpdate);
    return matched;
  }

  then<TResult1 = { data: Row[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.run(), error: null }).then(onfulfilled);
  }
}

function fakeClient(store: Store) {
  return {
    from(table: keyof Store) {
      return new FakeQuery(store, table);
    },
  } as never;
}

function emptyStore(overrides: Partial<Store> = {}): Store {
  const store: Store = { categories: [], product_groups: [], products: [], ...overrides };

  // Onceden var olan gruplarin uretilen sutunu da dolu olmali.
  for (const group of store.product_groups) {
    group.match_signature ??= productSignature(
      String(group.title ?? ''),
      group.brand === null || group.brand === undefined ? null : String(group.brand),
    );
  }

  return store;
}

/** Geçerli bir besleme kalemi; testler tek alanı değiştirir. */
function item(overrides: Partial<ProductFeedItem> = {}): ProductFeedItem {
  return {
    external_id: 'X1',
    title: 'Kablosuz Kulaklık',
    brand: 'Marka',
    description: null,
    gtin: null,
    sku: null,
    category_slug: null,
    image_urls: [],
    price_cents: 10_000,
    compare_at_price_cents: null,
    currency: 'TRY',
    stock: 5,
    condition: 'new',
    shipping_fee_cents: 0,
    free_shipping_threshold_cents: null,
    estimated_delivery_days: 2,
    status: 'active',
    attributes: {},
    ...overrides,
  } as ProductFeedItem;
}

const VENDOR = 'vendor-1';

// ---------------------------------------------------------------------------
// Eşleştirme
// ---------------------------------------------------------------------------
test('syncProducts: GTIN eşleşen teklif MEVCUT kanonik ürüne bağlanır', async () => {
  const store = emptyStore({
    product_groups: [{ id: 'g-1', title: 'Bambaşka Bir Ad', brand: 'Başka', gtin: '8690000000001' }],
  });

  const result = await syncProducts(fakeClient(store), VENDOR, [
    item({ gtin: '8690000000001' }),
  ], false);

  assert.equal(result.received, 1);
  assert.equal(result.failed.length, 0);
  // Yeni grup AÇILMAMALI: barkod eşleşti.
  assert.equal(store.product_groups.length, 1);
  assert.equal(store.products[0]?.group_id, 'g-1');
});

test('syncProducts: barkod yoksa marka+başlık imzasıyla eşleşir', async () => {
  const store = emptyStore({
    product_groups: [{ id: 'g-1', title: 'Kablosuz Kulaklık', brand: 'Marka', gtin: null }],
  });

  await syncProducts(fakeClient(store), VENDOR, [item()], false);

  assert.equal(store.product_groups.length, 1);
  assert.equal(store.products[0]?.group_id, 'g-1');
});

test('syncProducts: kelime sırası ve Türkçe karakter imzayı bozmaz', async () => {
  const store = emptyStore({
    product_groups: [{ id: 'g-1', title: 'Kulaklık Kablosuz', brand: 'Marka', gtin: null }],
  });

  await syncProducts(fakeClient(store), VENDOR, [item({ title: 'Kablosuz Kulaklik' })], false);

  // Aynı ürün: "Kulaklık Kablosuz" ile "Kablosuz Kulaklik" tek grupta olmalı.
  assert.equal(store.product_groups.length, 1);
  assert.equal(store.products[0]?.group_id, 'g-1');
});

test('syncProducts: eşleşme yoksa yeni kanonik ürün açar', async () => {
  const store = emptyStore();

  await syncProducts(fakeClient(store), VENDOR, [item()], false);

  assert.equal(store.product_groups.length, 1);
  assert.equal(store.products[0]?.group_id, store.product_groups[0]?.id);
});

test('syncProducts: FARKLI ürünler birleştirilmez', async () => {
  const store = emptyStore();

  await syncProducts(fakeClient(store), VENDOR, [
    item({ external_id: 'A', title: 'Kablosuz Kulaklık', brand: 'Marka' }),
    item({ external_id: 'B', title: 'Kablolu Kulaklık', brand: 'Marka' }),
  ], false);

  assert.equal(store.product_groups.length, 2, 'iki farklı ürün tek gruba düşmemeli');
});

test('syncProducts: aynı beslemedeki tekrar tek grup açar', async () => {
  const store = emptyStore();

  await syncProducts(fakeClient(store), VENDOR, [
    item({ external_id: 'A' }),
    item({ external_id: 'B' }),
  ], false);

  assert.equal(store.product_groups.length, 1, 'aynı ürünün iki teklifi tek grupta olmalı');
  assert.equal(store.products.length, 2);
});

// ---------------------------------------------------------------------------
// Teklif yazımı
// ---------------------------------------------------------------------------
test('syncProducts: stok 0 ise vitrine "active" olarak çıkmaz', async () => {
  const store = emptyStore();

  await syncProducts(fakeClient(store), VENDOR, [item({ stock: 0, status: 'active' })], false);

  // Satıcı 'active' göndermiş olsa bile alınamayan ürün satılabilir gösterilmez.
  assert.equal(store.products[0]?.status, 'out_of_stock');
});

test('syncProducts: aynı external_id ile tekrar gönderim mükerrer kayıt açmaz', async () => {
  const store = emptyStore();

  await syncProducts(fakeClient(store), VENDOR, [item({ price_cents: 10_000 })], false);
  const after = await syncProducts(fakeClient(store), VENDOR, [item({ price_cents: 9_000 })], false);

  assert.equal(store.products.length, 1, 'besleme idempotent olmalı');
  assert.equal(store.products[0]?.price_cents, 9_000, 'fiyat güncellenmeli');
  assert.equal(after.created, 0);
  assert.equal(after.updated, 1);
});

test('syncProducts: created/updated sayıları doğru raporlanır', async () => {
  const store = emptyStore();

  const first = await syncProducts(fakeClient(store), VENDOR, [
    item({ external_id: 'A' }),
    item({ external_id: 'B', title: 'Başka Ürün' }),
  ], false);

  assert.equal(first.created, 2);
  assert.equal(first.updated, 0);

  const second = await syncProducts(fakeClient(store), VENDOR, [
    item({ external_id: 'A' }),
    item({ external_id: 'C', title: 'Üçüncü Ürün' }),
  ], false);

  assert.equal(second.created, 1, 'yalnızca C yeni');
  assert.equal(second.updated, 1, 'A güncellendi');
});

// ---------------------------------------------------------------------------
// Tam senkron
// ---------------------------------------------------------------------------
test('syncProducts: archive_missing beslemede olmayanı arşivler, olanı bırakır', async () => {
  const store = emptyStore();

  await syncProducts(fakeClient(store), VENDOR, [
    item({ external_id: 'A' }),
    item({ external_id: 'B', title: 'Başka Ürün' }),
  ], false);

  const result = await syncProducts(fakeClient(store), VENDOR, [item({ external_id: 'A' })], true);

  const a = store.products.find((row) => row.external_id === 'A');
  const b = store.products.find((row) => row.external_id === 'B');

  assert.notEqual(a?.status, 'archived', 'beslemede olan ürün arşivlenmemeli');
  assert.equal(b?.status, 'archived', 'beslemede olmayan ürün arşivlenmeli');
  assert.equal(result.archived, 1);
});

test('syncProducts: archive_missing kapalıyken hiçbir şey arşivlenmez', async () => {
  const store = emptyStore();

  await syncProducts(fakeClient(store), VENDOR, [
    item({ external_id: 'A' }),
    item({ external_id: 'B', title: 'Başka Ürün' }),
  ], false);

  const result = await syncProducts(fakeClient(store), VENDOR, [item({ external_id: 'A' })], false);

  assert.equal(result.archived, 0);
  assert.notEqual(store.products.find((row) => row.external_id === 'B')?.status, 'archived');
});

/*
 * Arşivleme filtresi external_id'leri metin olarak birleştirir. İçinde tırnak
 * geçen bir kimlik kaçırılmazsa filtre bozulur ve YANLIŞ ürünler arşivlenir —
 * satıcının kataloğu sessizce vitrinden düşer.
 */
test('syncProducts: tırnak içeren external_id arşivleme filtresini bozmaz', async () => {
  const store = emptyStore();
  const weird = 'SKU"WITH"QUOTE';

  await syncProducts(fakeClient(store), VENDOR, [
    item({ external_id: weird }),
    item({ external_id: 'B', title: 'Başka Ürün' }),
  ], false);

  await syncProducts(fakeClient(store), VENDOR, [item({ external_id: weird })], true);

  assert.notEqual(
    store.products.find((row) => row.external_id === weird)?.status,
    'archived',
    'beslemede olan tırnaklı kimlik arşivlenmemeli',
  );
});

// ---------------------------------------------------------------------------
// Kategori
// ---------------------------------------------------------------------------
test('syncProducts: kategori slug kimliğe çevrilir, bilinmeyen slug ürünü düşürmez', async () => {
  const store = emptyStore({ categories: [{ id: 'c-1', slug: 'elektronik' }] });

  await syncProducts(fakeClient(store), VENDOR, [
    item({ external_id: 'A', category_slug: 'elektronik' }),
    item({ external_id: 'B', title: 'Başka Ürün', category_slug: 'olmayan-kategori' }),
  ], false);

  assert.equal(store.products.find((row) => row.external_id === 'A')?.category_id, 'c-1');
  // Bilinmeyen kategori ürünü reddetmez: kategorisiz de olsa katalogda kalır.
  assert.equal(store.products.find((row) => row.external_id === 'B')?.category_id, null);
  assert.equal(store.products.length, 2);
});
