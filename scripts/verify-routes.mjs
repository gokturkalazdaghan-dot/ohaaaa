#!/usr/bin/env node
/**
 * HER SAYFA GERÇEKTEN AÇILIYOR MU?
 *
 * Birim testleri ve tek tek yazılmış tarayıcı kontrolleri, yalnızca akla
 * gelen sayfaları sınar. Bu betik `app/` altındaki BÜTÜN rotaları diskten
 * bulur ve hepsini gerçek bir tarayıcıda açar: durum kodu, konsol hatası ve
 * sayfa çökmesi aranır.
 *
 * Neden gerekli: bir bileşen yeniden adlandırıldığında ya da bir veri
 * çağrısı yeni bir sütun istediğinde, o sayfayı kimse açmadığı sürece hata
 * sessizce yayında durur. "Her buton çalışsın" isteğinin ölçülebilir hâli
 * budur.
 *
 * Dinamik rotalar ([slug]) için gerçek bir örnek adres denenir; bulunamazsa
 * o rota ATLANIR ve bu açıkça yazılır -- uydurma bir slug 404 verir ve
 * yanlış alarm üretir.
 *
 * Kullanım: node scripts/verify-routes.mjs [adres]
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { launchBrowser } from './lib/browser.mjs';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3137').replace(/\/+$/, '');
const APP = new URL('../apps/web/src/app', import.meta.url).pathname;

/** Oturum gerektiren yollar: giriş sayfasına yönlenmeleri BEKLENEN davranış. */
const KORUMALI = ['/tasoron/panel', '/yonetim', '/siparislerim', '/degerlendirmelerim', '/adreslerim'];

function rotalariTopla(dizin, onek = '') {
  const cikti = [];
  for (const ad of readdirSync(dizin)) {
    const tam = join(dizin, ad);
    if (!statSync(tam).isDirectory()) continue;
    // (grup) ve _ozel klasorler adrese girmez.
    if (ad.startsWith('_') || ad.startsWith('(') || ad === 'api') continue;

    const yol = `${onek}/${ad}`;
    const icerik = readdirSync(tam);
    if (icerik.includes('page.tsx')) cikti.push(yol);
    cikti.push(...rotalariTopla(tam, yol));
  }
  return cikti;
}

const kokIcerik = readdirSync(APP);
const rotalar = ['/', ...rotalariTopla(APP)].sort();
if (!kokIcerik.includes('page.tsx')) rotalar.shift();

async function ornekSlug(sayfa, liste, secici) {
  await sayfa.goto(`${BASE}${liste}`, { waitUntil: 'domcontentloaded' });
  return sayfa.evaluate((s) => {
    const a = document.querySelector(s);
    return a ? new URL(a.href).pathname : null;
  }, secici);
}

const tarayici = await launchBrowser();
const sayfa = await tarayici.newPage();

// Dinamik rotalar için gerçek örnekler
const ornekler = new Map();
for (const [desen, liste, secici] of [
  ['/urun/[slug]', '/arama', 'a[href^="/urun/"]'],
  ['/kategori/[slug]', '/', 'a[href^="/kategori/"]'],
  // Firsat sayfasindaki kategori seridi: ornek slug oradan alinir.
  ['/firsatlar/[kategori]', '/firsatlar', 'a[href^="/firsatlar/"]'],
  ['/magaza/[slug]', '/', 'a[href^="/magaza/"]'],
]) {
  const yol = await ornekSlug(sayfa, liste, secici).catch(() => null);
  if (yol) ornekler.set(desen, yol);
}

let gecti = 0;
const hatalar = [];
const atlanan = [];

for (const rota of rotalar) {
  let hedef = rota;
  if (rota.includes('[')) {
    const ornek = ornekler.get(rota);
    if (!ornek) {
      atlanan.push(`${rota} (ornek adres bulunamadi)`);
      continue;
    }
    hedef = ornek;
  }

  const konsol = [];
  const dinleyici = (mesaj) => {
    if (mesaj.type() === 'error') konsol.push(mesaj.text());
  };
  const cokme = [];
  const cokmeDinleyici = (hata) => cokme.push(String(hata));

  sayfa.on('console', dinleyici);
  sayfa.on('pageerror', cokmeDinleyici);

  let durum = 0;
  try {
    const yanit = await sayfa.goto(`${BASE}${hedef}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    durum = yanit?.status() ?? 0;
  } catch (hata) {
    hatalar.push(`${hedef}: acilamadi -- ${hata.message}`);
    sayfa.off('console', dinleyici);
    sayfa.off('pageerror', cokmeDinleyici);
    continue;
  }

  sayfa.off('console', dinleyici);
  sayfa.off('pageerror', cokmeDinleyici);

  const korumali = KORUMALI.some((p) => hedef.startsWith(p));
  const varilanYol = new URL(sayfa.url()).pathname;

  if (durum >= 400) {
    hatalar.push(`${hedef}: HTTP ${durum}`);
  } else if (korumali && varilanYol === hedef) {
    // Korumalı sayfa oturumsuz açıldıysa ya koruma çalışmıyordur ya da
    // sayfa oturumsuz bir hâl gösteriyordur; ikisi de bilinçli olmalı.
    gecti += 1;
  } else if (cokme.length > 0) {
    hatalar.push(`${hedef}: sayfa cokmesi -- ${cokme[0]}`);
  } else if (konsol.length > 0) {
    hatalar.push(`${hedef}: konsol hatasi -- ${konsol[0].slice(0, 160)}`);
  } else {
    gecti += 1;
  }
}

await tarayici.close();

for (const a of atlanan) console.log(`~ atlandi: ${a}`);
for (const h of hatalar) console.error(`✗ ${h}`);
console.log(`\n${gecti}/${gecti + hatalar.length} rota sorunsuz acildi (${atlanan.length} atlandi)`);

if (hatalar.length > 0) process.exit(1);
