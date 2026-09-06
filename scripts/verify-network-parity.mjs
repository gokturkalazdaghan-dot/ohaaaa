#!/usr/bin/env node
/**
 * KAYITLI AĞ LİSTESİ İKİ YERDE — AYRIŞAMAZLAR
 *
 * NEDEN
 *
 *   Kod  `knownNetworks()` — `getProvider` bu listeyi tanır.
 *   DB   `affiliate_networks` — dört yabancı anahtar bu listeye bakar.
 *
 * Ayrışma iki ayrı SESSİZ hataya yol açar:
 *
 *   Kod FAZLA tanırsa   keşif turu programı üretir, veritabanı yazmayı
 *                       reddeder ve tur her seferinde aynı yerde düşer.
 *   DB FAZLA tanırsa    o ağın satırları yazılabilir ama hiçbir sağlayıcı
 *                       onları çözemez: `unknown_network`. Yani veri girer,
 *                       kod onu bir daha hiç işleyemez.
 *
 * İkisi de kendi içinde tutarlı olduğu için ne birim testi ne pgTAP bunu
 * görebilir. Yakalanabilecek tek yer iki kaynağın karşılaştırıldığı burası.
 *
 * Kullanım: DATABASE_URL=postgres://... node scripts/verify-network-parity.mjs
 */

import { execFileSync } from 'node:child_process';

import { knownNetworks } from '../packages/shared/dist/providers/index.js';

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL tanımlı olmalı.');
  process.exit(2);
}

const bulgular = [];

const dbSatirlari = execFileSync(
  'psql',
  [DB, '-tAX', '-c', 'select code from public.affiliate_networks order by code;'],
  { encoding: 'utf8' },
)
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const kod = [...knownNetworks()].sort();

if (dbSatirlari.length === 0) {
  bulgular.push('affiliate_networks BOŞ döndü — karşılaştırma anlamsız olurdu.');
}

for (const ag of kod) {
  if (!dbSatirlari.includes(ag)) {
    bulgular.push(
      `"${ag}" kodda kayıtlı ama veritabanında YOK — keşif turu program üretir, ` +
        'veritabanı yazmayı reddeder ve tur her seferinde aynı yerde düşer.',
    );
  }
}

for (const ag of dbSatirlari) {
  if (!kod.includes(ag)) {
    bulgular.push(
      `"${ag}" veritabanında tanımlı ama kodda sağlayıcısı YOK — satırları ` +
        'yazılabilir ama hiçbir kod yolu onları çözemez (unknown_network).',
    );
  }
}

if (bulgular.length > 0) {
  console.error(`\n✗ ${bulgular.length} ağ listesi ayrışması bulundu\n`);
  for (const b of bulgular) console.error(`  ${b}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ Ağ listesi tutarlı (${kod.length} ağ, kod = veritabanı)`);
