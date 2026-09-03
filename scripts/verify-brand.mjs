#!/usr/bin/env node
/**
 * MARKA YAZIMI DOĞRU MU?
 *
 * Doğru yazım TEK: `Ohaaaa` — O + DÖRT a.
 * Büyük hâli: `OHAAAA`. Küçük hâli (alan adı, paket adı): `ohaaaa`.
 *
 * Yanlış olanlar: Ohaaa (3 a), Ohaaaaa (5 a), ve her diğer sayı.
 *
 * NEDEN BETİK, NEDEN GÖZLE DEĞİL
 * Bu hata gözle YAKALANMAZ. "Ohaaa" ile "Ohaaaa" arasındaki fark tek bir
 * harftir ve okurken beyin doğrusunu görür. Bir kez yanlış yazılıp
 * kopyalandığında da sessizce yayılır -- e-postaya, bildirime, meta
 * etiketine. Sayması gereken makinedir.
 *
 * Kullanım: node scripts/verify-brand.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const KOK = new URL('..', import.meta.url).pathname;

/** Taranan uzantılar. Derlenmiş çıktı ve bağımlılıklar hariç. */
const UZANTILAR = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.sql', '.md', '.json', '.yml', '.yaml', '.css', '.html', '.dart', '.txt',
]);

const ATLA = new Set([
  'node_modules', 'dist', '.next', '.git', 'build', 'coverage',
  '.vercel', 'out', '.turbo',
]);

/*
 * Yakalama kalıbı: "oh" + iki ya da daha fazla "a".
 *
 * Sonra sayarak karar veriyoruz. Doğrudan "yanlış olanları" arayan bir
 * kalıp yazmak cazip ama kırılgan: `Ohaaaaa` (5 a) için yazılan bir kalıp
 * 6 a'yı kaçırır. Hepsini yakalayıp saymak, kaçış bırakmaz.
 *
 * `OhaaaaApi` / `OhaaaaApp` gibi bileşik adlar DOĞRUDUR: marka doğru
 * yazılmış, arkasına başka bir kelime eklenmiştir. Ama kalıp büyük/küçük
 * harfe duyarsız olduğu için "aaaaA" dizisini tek parça görür ve 5 sayar.
 *
 * Bu yüzden dizi, BÜYÜK/KÜÇÜK HARF SINIRINDA kesilir: marka ya tümü küçük
 * ("ohaaaa") ya tümü büyük ("OHAAAA") yazılır. İlk harften farklı kutuya
 * geçen ilk karakter, markanın değil sonraki kelimenin başlangıcıdır.
 */
const KALIP = /oh(a{2,})/gi;

/**
 * Markaya ait "a" sayısı.
 *
 * "aaaa"  -> 4  (Ohaaaa)
 * "AAAA"  -> 4  (OHAAAA)
 * "aaaaA" -> 4  (Ohaaaa + Api)  <- sınırda kesilir
 * "aaa"   -> 3  (Ohaaa — YANLIŞ)
 */
function markaAsayisi(dizi) {
  const ilkBuyuk = dizi[0] === dizi[0].toUpperCase();
  let sayi = 0;

  for (const harf of dizi) {
    const buyuk = harf === harf.toUpperCase();
    if (buyuk !== ilkBuyuk) break;
    sayi += 1;
  }

  return sayi;
}

const bulgular = [];
let taranan = 0;

function tara(dizin) {
  for (const ad of readdirSync(dizin)) {
    if (ATLA.has(ad)) continue;

    const tam = join(dizin, ad);
    const bilgi = statSync(tam);

    if (bilgi.isDirectory()) {
      tara(tam);
      continue;
    }

    const nokta = ad.lastIndexOf('.');
    if (nokta < 0 || !UZANTILAR.has(ad.slice(nokta))) continue;

    // Bu betiğin kendisi kasıtlı olarak yanlış yazımları içerir.
    if (tam.endsWith('scripts/verify-brand.mjs')) continue;

    taranan += 1;
    const icerik = readFileSync(tam, 'utf8');
    const satirlar = icerik.split('\n');

    satirlar.forEach((satir, indeks) => {
      for (const eslesme of satir.matchAll(KALIP)) {
        const aSayisi = markaAsayisi(eslesme[1]);
        if (aSayisi === 4) continue; // doğru

        bulgular.push({
          dosya: relative(KOK, tam),
          satir: indeks + 1,
          yazim: eslesme[0].slice(0, 2 + aSayisi),
          aSayisi,
          baglam: satir.trim().slice(0, 120),
        });
      }
    });
  }
}

tara(KOK);

if (bulgular.length > 0) {
  console.error(`\n✗ ${bulgular.length} yanlış marka yazımı bulundu (doğrusu: Ohaaaa — 4 adet a)\n`);
  for (const b of bulgular) {
    console.error(`  ${b.dosya}:${b.satir}  "${b.yazim}" (${b.aSayisi} adet a)`);
    console.error(`    ${b.baglam}`);
  }
  console.error('');
  process.exit(1);
}

console.log(`✓ Marka yazımı doğru — ${taranan} dosyada yalnızca "Ohaaaa" (4 adet a)`);
