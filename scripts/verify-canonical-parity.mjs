#!/usr/bin/env node
/**
 * KANONİK ÜRÜN ANAHTARI İKİ YERDE HESAPLANIR — AYRIŞAMAZLAR
 *
 * NEDEN AYRI BİR DOĞRULAMA GEREKİYOR
 *
 *   SQL   `product_groups.canonical_key` ÜRETİLMİŞ sütun; tekilliği o taşır.
 *   JS    Alım hattı, partiyi yazmadan ÖNCE aynı ürüne düşen satırları
 *         kendi içinde birleştirmek için aynı anahtarı hesaplar.
 *
 * Ayrışırlarsa sonuç SESSİZDİR ve tam olarak kaçınmak istediğimiz şeydir:
 * JS bir anahtar hesaplar, veritabanı başka birini üretir, `on conflict`
 * hiç eşleşmez ve HER TUR aynı ürün için yeni bir kanonik satır açılır.
 * Katalog aynı telefonu 400 kez gösterir, fiyat karşılaştırması kendi
 * kendiyle yapılır. Hiçbir hata düşmez, hiçbir test patlamaz.
 *
 * Bu yüzden eşitlik varsayılmıyor, GERÇEK veritabanına sorularak
 * ölçülüyor.
 *
 * Kullanım: DATABASE_URL=postgres://... node scripts/verify-canonical-parity.mjs
 */

import { execFileSync } from 'node:child_process';

import { canonicalProductKey, normalizeGtin } from '../packages/shared/dist/canonicalProduct.js';

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL tanımlı olmalı.');
  process.exit(2);
}

/**
 * Zorlayıcı girdiler.
 *
 * Rastgele değil, ayrışmanın GERÇEKTEN olabileceği yerler: aynı GTIN'in
 * farklı gösterimleri, geçersiz uzunluklar, Türkçe karakterler, boş marka,
 * yalnız boşluktan oluşan MPN, GTIN ile MPN çakışması.
 */
const CASES = [
  // [gtin, brand, mpn, title]
  ['012345678905', null, null, 'Telefon'],
  ['0012345678905', null, null, 'Telefon'],          // aynı ürün, EAN-13
  ['0-12345-67890-5', null, null, 'Telefon'],        // aynı ürün, tireli
  ['  012345678905  ', 'Marka', 'MPN-1', 'Telefon'], // GTIN kazanmalı
  ['123', 'Marka', 'MPN-1', 'Telefon'],              // geçersiz GTIN -> mpn
  ['abc', null, null, 'Telefon'],                    // geçersiz GTIN -> title
  [null, 'Marka', 'MPN-1', 'Telefon'],
  [null, 'MARKA', 'mpn-1', 'TELEFON'],               // büyük/küçük harf
  [null, 'Marka', '   ', 'Telefon'],                 // boş MPN -> title
  [null, '   ', 'MPN-1', 'Telefon'],                 // boş marka -> title
  [null, null, null, 'Kablosuz Kulaklık'],
  [null, 'IĞDIR', null, 'ÇAĞRI ŞİŞE ÖĞÜTÜCÜ'],       // Türkçe
  [null, 'Sony', 'WH-1000XM5', 'Sony WH-1000XM5 Kulaklık'],
  [null, null, null, 'Ürün   çok    boşluklu'],
  [null, 'Apple', null, 'iPhone 15 Pro Max 256GB'],
  ['00000000', null, null, 'Sifir GTIN'],            // geçerli uzunluk, tüm sıfır
  ['12345678', null, null, 'GTIN-8'],
  ['12345678901234', null, null, 'GTIN-14'],
  [null, null, null, ''],                            // boş başlık
];

/** SQL tarafını tek turda sorar — girdi başına bir bağlantı açmak yavaş. */
function sqlDegerleri() {
  const satirlar = CASES.map(
    ([g, b, m, t]) =>
      `select ${lit(g)}::text g, ${lit(b)}::text b, ${lit(m)}::text m, ${lit(t)}::text t`,
  ).join(' union all ');

  const sorgu = `
    with girdi as (${satirlar})
    select coalesce(public.normalize_gtin(g), '<NULL>') || E'\\t'
        || public.canonical_product_key(g, b, m, t)
      from girdi;
  `;

  return execFileSync('psql', [DB, '-tAX', '-c', sorgu], { encoding: 'utf8' })
    .split('\n')
    // Satır sonu atılıyor ama İÇERİK trim EDİLMİYOR: anahtarın sonundaki
    // bir boşluk gerçek bir ayrışmadır ve trim onu gizlerdi.
    .map((s) => s.replace(/\r$/, ''))
    .filter((s) => s.length > 0);
}

function lit(v) {
  return v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
}

const sql = sqlDegerleri();
const bulgular = [];

if (sql.length !== CASES.length) {
  bulgular.push(
    `SQL ${sql.length} satır döndürdü, ${CASES.length} bekleniyordu — ` +
      'karşılaştırma anlamsız olurdu.',
  );
} else {
  CASES.forEach(([g, b, m, t], i) => {
    const [sqlGtin, sqlKey] = sql[i].split('\t');
    const jsGtin = normalizeGtin(g) ?? '<NULL>';
    const jsKey = canonicalProductKey({ gtin: g, brand: b, mpn: m, title: t });

    const girdi = `[${lit(g)}, ${lit(b)}, ${lit(m)}, ${lit(t)}]`;

    if (jsGtin !== sqlGtin) {
      bulgular.push(`${girdi} normalize_gtin — JS: "${jsGtin}"  SQL: "${sqlGtin}"`);
    }
    if (jsKey !== sqlKey) {
      bulgular.push(`${girdi} canonical_key — JS: "${jsKey}"  SQL: "${sqlKey}"`);
    }
  });
}

/*
 * Aynı ürünün üç gösterimi TEK anahtara inmeli. Parite tutup da bu tutmazsa
 * iki taraf "tutarlı biçimde yanlış" demektir — tekilleştirme hiç çalışmaz.
 */
const ucGosterim = new Set(
  ['012345678905', '0012345678905', '0-12345-67890-5'].map((g) =>
    canonicalProductKey({ gtin: g, brand: null, mpn: null, title: 'Telefon' }),
  ),
);
if (ucGosterim.size !== 1) {
  bulgular.push(
    `Aynı GTIN'in üç gösterimi ${ucGosterim.size} farklı anahtar üretti — ` +
      'tekilleştirmenin en sık kaçırdığı durum.',
  );
}

if (bulgular.length > 0) {
  console.error(`\n✗ ${bulgular.length} kanonik anahtar ayrışması bulundu\n`);
  for (const b of bulgular) console.error(`  ${b}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ Kanonik anahtar tutarlı (${CASES.length} vaka, JS = SQL)`);
