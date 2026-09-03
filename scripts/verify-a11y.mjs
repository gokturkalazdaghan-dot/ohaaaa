#!/usr/bin/env node
/**
 * Erişilebilirlik denetimi (axe-core).
 *
 * NEDEN
 * Erişilebilirlik "sonra bakarız" işi değil: kontrast, etiket ve başlık
 * düzeni hataları gözle görülmez ama kullanıcının bir kısmını siteden
 * tamamen dışarıda bırakır. Elle bakarak bulunmaları da mümkün değil —
 * ilk çalıştırmada sitedeki HER birincil düğmenin kontrast sınırının
 * altında olduğu böyle ortaya çıktı.
 *
 * Kullanım:
 *   cd apps/web
 *   NEXT_PUBLIC_SITE_URL=https://www.ohaaaa.com npm run build
 *   NEXT_PUBLIC_SITE_URL=https://www.ohaaaa.com npx next start -p 3137 &
 *
 *   node scripts/verify-a11y.mjs [adres]
 *
 * Çıkış kodu ihlal varsa 1. Yalnızca `violations` toplanır; "incomplete"
 * (makinenin karar veremediği) durumlar gürültü üretir ve elle
 * değerlendirilmeleri gerekir.
 */

import { launchBrowser } from './lib/browser.mjs';
import { readFileSync } from 'node:fs';

const B = (process.argv[2] ?? 'http://127.0.0.1:3137').replace(/\/+$/, '');
const axe = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const PAGES = ['/', '/arama', '/kategori/elektronik', '/urun/sony-wh-1000xm5', '/firsatlar', '/fiyat-takip', '/tasoron', '/tasoron/api', '/favoriler', '/magaza/teknomarkt', '/odeme', '/giris'];

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const all = new Map();

for (const path of PAGES) {
  await page.goto(B + path, { waitUntil: 'networkidle' });
  await page.addScriptTag({ content: axe });
  const res = await page.evaluate(async () => {
    // @ts-ignore
    return await window.axe.run(document, { resultTypes: ['violations'] });
  });
  for (const v of res.violations) {
    const key = v.id;
    if (!all.has(key)) all.set(key, { id: v.id, impact: v.impact, help: v.help, pages: new Set(), nodes: [] });
    const e = all.get(key);
    e.pages.add(path);
    for (const n of v.nodes) e.nodes.push({ html: n.html.slice(0, 120), msg: (n.any?.[0]?.message ?? '').slice(0, 160) });
  }
}

const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const list = [...all.values()].sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));

if (list.length === 0) console.log('✓ axe: ihlal yok');
for (const v of list) {
  console.log(`\n[${v.impact}] ${v.id} — ${v.help}`);
  console.log(`  sayfalar: ${[...v.pages].join(', ')}`);
  const uniq = [...new Map(v.nodes.map(n => [n.html, n])).values()];
  for (const n of uniq.slice(0, 8)) console.log(`   - ${n.html}\n     ${n.msg}`);
}
await browser.close();

process.exit(list.length > 0 ? 1 : 0);
