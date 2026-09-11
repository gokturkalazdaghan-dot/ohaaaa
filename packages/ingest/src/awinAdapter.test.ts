/**
 * AWIN BESLEME ADAPTÖRÜ — FIXTURE TESTLERİ
 *
 * BUNLAR TEST VERİSİDİR. Hiçbir satır gerçek bir Awin indirmesinden
 * gelmiyor; yapı gerçek beslemelerin biçimini taklit ediyor ama değerler
 * UYDURMA ve öyle olduğu her fixture'ın adında yazıyor (`TEST-...`).
 *
 * NEDEN CANLI TEST YOK
 * Canlı bir indirme, ağın o anki durumuna bağlıdır: satır sayısı değişir,
 * besleme bakımdayken boş döner, anahtar dönerse test kırmızıya döner.
 * Böyle bir test başarısız olduğunda KODUN mu AĞIN mı bozulduğunu
 * söyleyemez. Fixture'lar belirlenimci: aynı girdi her zaman aynı çıktı.
 */
import { strict as assert } from 'node:assert';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';

import { AWIN_FEED_MAPPING } from '@ohaaaa/shared/providers';

import { parseCsv } from './adapters/csv.js';
import { decodeFeedPayload } from './http/payload.js';
import { normalizeCondition, normalizeRecords } from './normalize.js';
import type { FieldMapping } from './types.js';

const MAPPING = AWIN_FEED_MAPPING as unknown as FieldMapping;

/** BTO/Mooncool beslemelerinde GÖRÜLEN sütun sırası; değerler uydurma. */
const BASLIK = [
  'aw_product_id', 'merchant_product_id', 'product_name', 'description',
  'aw_deep_link', 'merchant_image_url', 'search_price', 'rrp_price',
  'currency', 'in_stock', 'ean', 'mpn', 'brand_name', 'merchant_category',
  'delivery_cost',
].join(',');

function satir(o: Record<string, string> = {}): string {
  const d: Record<string, string> = {
    aw_product_id: 'TEST-1', merchant_product_id: 'TEST-SKU-1',
    product_name: 'TEST Kablosuz Klavye', description: 'TEST aciklama',
    aw_deep_link: 'https://www.awin1.com/pclick.php?p=1&a=3074081&m=61655',
    merchant_image_url: 'https://cdn.test.invalid/1.jpg',
    search_price: '25.99', rrp_price: '35.99', currency: 'GBP',
    in_stock: '1', ean: '5099206039292', mpn: 'TEST-MPN-1',
    brand_name: 'TESTMarka', merchant_category: 'computers', delivery_cost: '4.99',
    ...o,
  };
  return BASLIK.split(',').map((k) => {
    const v = d[k] ?? '';
    return /[",]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  }).join(',');
}

const HOSTLAR = ['www.awin1.com', 'www.backtotheoffice.co.invalid'];
const SECENEK = { defaultCurrency: 'GBP', allowedHosts: HOSTLAR };

function calistir(csv: string) {
  return normalizeRecords(parseCsv(csv).records, MAPPING, SECENEK);
}

// --- 1) NORMAL ÜRÜN --------------------------------------------------------
test('fixture: normal urun butun alanlariyla geciyor', () => {
  const { offers, errors } = calistir(`${BASLIK}\n${satir()}`);
  assert.equal(errors.length, 0);
  assert.equal(offers.length, 1);
  const o = offers[0]!;
  assert.equal(o.externalId, 'TEST-1');
  assert.equal(o.priceCents, 2599);
  assert.equal(o.compareAtPriceCents, 3599, 'rrp > fiyat ise ustu cizili dolar');
  assert.equal(o.currency, 'GBP');
  // GTIN-13 -> GTIN-14'e sifir dolgulu: GS1 kurali, kanonik esitlik icin sart.
  assert.equal(o.gtin, '05099206039292');
  assert.equal(o.sku, 'TEST-SKU-1', 'SKU artik dusmuyor');
  assert.equal(o.mpn, 'TEST-MPN-1', 'MPN kanonik anahtar icin gerekli');
  assert.equal(o.shippingFeeCents, 499);
  assert.equal(o.stock, 1);
});

// --- 2) GZIP ---------------------------------------------------------------
test('fixture: gzip govde sihirli bayttan cozuluyor', () => {
  const duz = `${BASLIK}\n${satir()}`;
  const gz = gzipSync(Buffer.from(duz, 'utf8'));
  // Bicim DOSYA ADINDAN degil ICERIKTEN anlasilmali.
  assert.equal(decodeFeedPayload(gz), duz);
});

// --- 3) EKSİK İSTEĞE BAĞLI ALANLAR ----------------------------------------
test('fixture: eksik istege bagli alanlar null kaliyor, satir dusmuyor', () => {
  const { offers, errors } = calistir(
    `${BASLIK}\n${satir({ ean: '', mpn: '', rrp_price: '', brand_name: '', merchant_image_url: '' })}`,
  );
  assert.equal(errors.length, 0);
  const o = offers[0]!;
  assert.equal(o.gtin, null);
  assert.equal(o.mpn, null);
  assert.equal(o.brand, null);
  assert.equal(o.compareAtPriceCents, null);
  assert.deepEqual(o.imageUrls, []);
  assert.equal(o.priceCents, 2599, 'zorunlu alanlar hala saglam');
});

// --- 4) GEÇERSİZ FİYAT -----------------------------------------------------
test('fixture: sifir/negatif/okunamayan fiyat ELENIYOR', () => {
  for (const p of ['0', '0.00', '-5', 'bedava', '']) {
    const { offers, errors } = calistir(`${BASLIK}\n${satir({ search_price: p })}`);
    assert.equal(offers.length, 0, `fiyat ${JSON.stringify(p)} kabul edildi`);
    assert.equal(errors.length, 1);
  }
});

// --- 5) GEÇERSİZ SATIR (adres mağazaya ait değil) --------------------------
test('fixture: izinsiz alan adi ELENIYOR -- acik yonlendirme korumasi', () => {
  const { offers, errors } = calistir(
    `${BASLIK}\n${satir({ aw_deep_link: 'https://kotu.invalid/p/1' })}`,
  );
  assert.equal(offers.length, 0);
  assert.match(errors[0]!.reason, /mağazaya ait değil/);
});

// --- 6) MÜKERRER external_id ----------------------------------------------
test('fixture: ayni external_id bir kez giriyor', () => {
  const { offers, errors } = calistir(`${BASLIK}\n${satir()}\n${satir({ search_price: '31.50' })}`);
  assert.equal(offers.length, 1, 'ikinci kopya elenmeli');
  assert.equal(offers[0]!.priceCents, 2599, 'ILK satir kazanir -- belirlenimci');
  assert.equal(errors.length, 1);
});

// --- 7) PARA BİRİMLERİ -----------------------------------------------------
test('fixture: GBP/USD/EUR feed sutunundan okunuyor', () => {
  for (const [pb, bekle] of [['GBP', 'GBP'], ['USD', 'USD'], ['eur', 'EUR']] as const) {
    const { offers } = calistir(`${BASLIK}\n${satir({ currency: pb })}`);
    assert.equal(offers[0]!.currency, bekle);
  }
  /*
   * BOS ya da UC HARF OLMAYAN sutun kaynagin para birimine duser.
   * Bu fixture GERCEK BIR HATA yakaladi: `??` yalnizca null/undefined'i
   * yakaladigi icin bos sutun `''` uretiyordu ve teklif PARA BIRIMSIZ
   * yaziliyordu (products.currency char(3) + currencies FK -> yigin duserdi).
   */
  for (const bozuk of ['', '   ', 'GB', 'Pound', '£']) {
    const { offers } = calistir(`${BASLIK}\n${satir({ currency: bozuk })}`);
    assert.equal(offers[0]!.currency, 'GBP', `bozuk para birimi: ${JSON.stringify(bozuk)}`);
  }
});

// --- 8) STOK DURUMU --------------------------------------------------------
test('fixture: stok bicimleri dogru yorumlanıyor', () => {
  // BOS sutun "stokta" sayilir (100) -- mevcut ve KASITLI davranis: bir
  // beslemenin stok sutununu doldurmamasi "hepsi tukendi" demek degildir.
  const bekle: Array<[string, number]> = [['1', 1], ['0', 0], ['42', 42], ['', 100]];
  for (const [ham, n] of bekle) {
    const { offers } = calistir(`${BASLIK}\n${satir({ in_stock: ham })}`);
    assert.equal(offers[0]?.stock ?? 0, n, `in_stock=${JSON.stringify(ham)}`);
  }
});

// --- 9) İNDİRİMLİ FİYAT ----------------------------------------------------
test('fixture: rrp fiyattan DUSUKSE sahte indirim uretilmiyor', () => {
  const { offers } = calistir(`${BASLIK}\n${satir({ search_price: '40.00', rrp_price: '35.99' })}`);
  assert.equal(offers[0]!.compareAtPriceCents, null, 'ustu cizili < fiyat ise yok sayilir');
});

// --- 10) DEEPLINK ----------------------------------------------------------
test('fixture: ag tiklama adresi DEGISTIRILMEDEN tasiniyor', () => {
  const link = 'https://www.awin1.com/pclick.php?p=99&a=3074081&m=61655';
  const { offers } = calistir(`${BASLIK}\n${satir({ aw_deep_link: link })}`);
  assert.equal(offers[0]!.productUrl, link);
});

// --- 11) BÜYÜK YIĞIN -------------------------------------------------------
test('fixture: 5000 satirlik yigin tam ve sirali isleniyor', () => {
  const satirlar = Array.from({ length: 5000 }, (_, i) =>
    satir({ aw_product_id: `TEST-${i}`, search_price: `${10 + (i % 90)}.00` }));
  const { offers, errors } = calistir(`${BASLIK}\n${satirlar.join('\n')}`);
  assert.equal(offers.length, 5000);
  assert.equal(errors.length, 0);
  assert.equal(offers[0]!.externalId, 'TEST-0');
  assert.equal(offers[4999]!.externalId, 'TEST-4999');
});

// --- 12) IDEMPOTENCY -------------------------------------------------------
test('fixture: ayni girdi ayni ciktiyi uretiyor (parmak izi sabit)', () => {
  const csv = `${BASLIK}\n${satir()}\n${satir({ aw_product_id: 'TEST-2' })}`;
  assert.deepEqual(calistir(csv).offers, calistir(csv).offers);
});

// --- 13) BOZUK BESLEME -----------------------------------------------------
test('fixture: bozuk besleme yigini DUSURMUYOR', () => {
  // Eksik sutunlu satir + tirnagi kapanmamis satir + bos satir
  const csv = [BASLIK, satir(), 'TEST-3,eksik,satir', '', satir({ aw_product_id: 'TEST-4' })].join('\n');
  const { offers } = calistir(csv);
  assert.ok(offers.length >= 2, 'saglam satirlar yine de geciyor');
  assert.ok(offers.some((o) => o.externalId === 'TEST-4'));
});

// --- 14) KISMİ MAĞAZA HATASI ----------------------------------------------
test('fixture: bir magazanin satirlari bozukken digerleri etkilenmiyor', () => {
  const csv = [
    BASLIK,
    satir({ aw_product_id: 'TEST-A1' }),
    satir({ aw_product_id: 'TEST-B1', aw_deep_link: 'https://baska-magaza.invalid/p' }),
    satir({ aw_product_id: 'TEST-A2' }),
  ].join('\n');
  const { offers, errors } = calistir(csv);
  assert.deepEqual(offers.map((o) => o.externalId), ['TEST-A1', 'TEST-A2']);
  assert.equal(errors.length, 1, 'yalnizca bozuk magazanin satiri eleniyor');
});

// --- 15) DURUM NORMALİZASYONU ---------------------------------------------
test('fixture: urun durumu semanin tanidigi uce indirgeniyor', () => {
  assert.equal(normalizeCondition('New'), 'new');
  assert.equal(normalizeCondition('  BRAND NEW '), 'new');
  assert.equal(normalizeCondition('Refurbished'), 'refurbished');
  assert.equal(normalizeCondition('pre-owned'), 'used');
  assert.equal(normalizeCondition('second hand'), 'used');
  // TANINMAYAN -> null, 'new' DEGIL: bilmedigimizi "sifir urun" diye
  // yazmak cikarim olurdu; null semanin varsayilanina birakir.
  assert.equal(normalizeCondition('A-stock'), null);
  assert.equal(normalizeCondition(''), null);
  assert.equal(normalizeCondition(null), null);
});
