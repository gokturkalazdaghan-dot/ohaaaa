#!/usr/bin/env node
/**
 * JavaScript ve SQL imza hesaplarının BİREBİR aynı olduğunu doğrular.
 *
 * NEDEN AYRI BİR DOĞRULAMA GEREKİYOR
 * Kanonik eşleştirme imzası iki yerde hesaplanır:
 *   • JavaScript — `productSignature()`, besleme sırasında adayları aramak için
 *   • SQL        — `public.product_signature()`, `match_signature` üretilen
 *                  sütununu doldurmak için
 *
 * İkisi ayrışırsa arama HİÇBİR aday bulamaz; her teklif kendi kanonik ürününü
 * açar ve fiyat karşılaştırması sessizce çalışmaz olur. Hiçbir test patlamaz,
 * hiçbir hata günlüğe düşmez — site çalışır görünür ama var olma sebebini
 * yerine getirmez. Bu yüzden eşitlik makineye doğrulatılır.
 *
 * Kullanım:  DATABASE_URL=postgres://... node scripts/verify-signature-parity.mjs
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { productSignature } from '../packages/shared/dist/productSync.js';

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL tanımlı olmalı.');
  process.exit(2);
}

/**
 * Zorlayıcı girdiler.
 *
 * Rastgele metin değil, ayrışmanın GERÇEKTEN olabileceği yerler seçildi:
 * Türkçe karakterler, noktalama, çoklu boşluk, rakam/harf sıralaması,
 * boş marka, tekrar eden kelimeler, büyük/küçük harf.
 */
const CASES = [
  ['Kablosuz Kulaklık', 'Marka'],
  ['Kulaklik  KABLOSUZ', 'marka'],
  ['Sony WH-1000XM5 Kulaklık', 'Sony'],
  ['Sony 5 WH-1000XM5 Kulaklık ürün', 'Sony'],
  ['ÇAĞRI ŞİŞE ÖĞÜTÜCÜ', 'IĞDIR'],
  ['iPhone 15 Pro Max 256GB', 'Apple'],
  ['Ürün   çok    boşluklu', null],
  ['Noktalama!!! var, burada.', 'Ünlü Marka'],
  ['tekrar tekrar tekrar', 'A'],
  ['123 456 abc', ''],
  ['ĞÜŞİÖÇ ğüşıöç ÂÎÛ âîû', 'Test'],
  ['a', 'b'],
];

/** Tek bir psql çağrısında hepsini hesapla: her vaka için ayrı bağlantı açma. */
const values = CASES.map(
  ([title, brand]) =>
    `(${quote(title)}, ${brand === null ? 'null' : quote(brand)})`,
).join(', ');

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const output = execFileSync(
  'psql',
  [
    DB,
    '-tAc',
    `select public.product_signature(t.title, t.brand)
       from (values ${values}) as t(title, brand);`,
  ],
  { encoding: 'utf8' },
);

// Boş satırlar filtrelenmez: imza boş STRING olabilir ve o da karşılaştırılmalı.
const sqlResults = output.split('\n').slice(0, CASES.length);

let failures = 0;

CASES.forEach(([title, brand], index) => {
  const fromJs = productSignature(title, brand);
  const fromSql = sqlResults[index];

  if (fromJs !== fromSql) {
    failures += 1;
    console.error(`✗ İmza ayrışması: title=${JSON.stringify(title)} brand=${JSON.stringify(brand)}`);
    console.error(`    JS  : ${JSON.stringify(fromJs)}`);
    console.error(`    SQL : ${JSON.stringify(fromSql)}`);
  }
});

if (failures > 0) {
  console.error(
    `\n${failures} vakada JavaScript ve SQL imzaları ayrıştı.\n` +
      'Bu, fiyat karşılaştırmasının sessizce çalışmaması demektir:\n' +
      'aynı ürünün teklifleri farklı kanonik ürünlere düşer.',
  );
  process.exit(1);
}

console.log(`✓ İmza eşitliği doğrulandı (${CASES.length} vaka, JS = SQL)`);
