#!/usr/bin/env node
/**
 * DEPODA SIR VAR MI?
 *
 * Sır sızıntısının en pahalı hâli, fark edilmeden commit edilenidir: dosya
 * sonradan silinse bile git geçmişinde kalır ve anahtarın döndürülmesi
 * (rotation) gerekir. Bu yüzden kontrol, commit'ten SONRA değil derlemede
 * yapılır.
 *
 * YALNIZCA TAKİP EDİLEN DOSYALARA BAKAR (`git ls-files`). Amaç depoya neyin
 * GİRDİĞİNİ ölçmek; yerel `.env` dosyası zaten .gitignore'da ve orada
 * durması normal.
 *
 * Kullanım: node scripts/verify-secrets.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Kalıplar DAR tutuldu.
 *
 * Geniş bir kalıp (ör. "key" geçen her satır) yüzlerce yanlış alarm üretir
 * ve o alarmlar birkaç gün içinde susturulur; susturulan bir kontrol
 * olmayan kontroldür. Buradaki her kalıp, gerçek bir sırrın BİÇİMİNİ
 * tanıyor.
 */
const KALIPLAR = [
  {
    ad: 'JWT / Supabase anahtarı',
    // Üç bölümlü gerçek bir JWT. Dokümandaki "eyJhbGciOi..." kısaltması
    // eşleşmez çünkü nokta ile ayrılmış üç bölüm yok.
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  { ad: 'OpenAI/Anthropic anahtarı', re: /\b(sk|sk-ant)-[A-Za-z0-9_-]{24,}/ },
  { ad: 'AWS erişim anahtarı', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { ad: 'GitHub jetonu', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { ad: 'Google API anahtarı', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { ad: 'Özel anahtar bloğu', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { ad: 'Stripe canlı anahtarı', re: /\b(sk|rk)_live_[A-Za-z0-9]{20,}/ },
  {
    ad: 'Postgres bağlantı dizesi (parolalı, uzak sunucu)',
    /*
     * İlk hâli yerel geliştirme dizelerini de yakalıyordu
     * (`postgres:postgres@localhost`, CI test veritabanı ve yerel Supabase).
     * İkisi de sır değil; ama böyle alarmlar birkaç gün içinde susturulur ve
     * SUSTURULAN BİR KONTROL, OLMAYAN KONTROLDÜR.
     *
     * Bu yüzden kalıp daraltıldı: yerel adresler ve iyi bilinen geliştirme
     * parolası hariç tutuluyor. Uzak bir sunucuya giden parolalı dize hâlâ
     * yakalanır -- asıl aranan o.
     */
    re: /postgres(ql)?:\/\/[^\s:@/]+:(?!(postgres|parola|password|sifre|xxx|\.\.\.|\$\{)[@:])[^\s:@/]{6,}@(?!(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|host\.docker\.internal|[^\s/]*\.local\b))/i,
  },
];

/** Bu yollarda örnek/yer tutucu bulunması normal. */
const MUAF_YOLLAR = [/^\.env\.example$/, /^scripts\/verify-secrets\.mjs$/, /^package-lock\.json$/];

/** İkili ve büyük dosyalar taranmaz. */
const ATLA_UZANTI = /\.(png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|woff2?|ttf|otf|mp4|svg)$/i;
const MAKS_BAYT = 2 * 1024 * 1024;

const dosyalar = execFileSync('git', ['ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const bulgular = [];
let taranan = 0;

for (const yol of dosyalar) {
  if (MUAF_YOLLAR.some((r) => r.test(yol))) continue;
  if (ATLA_UZANTI.test(yol)) continue;

  let bilgi;
  try {
    bilgi = statSync(yol);
  } catch {
    continue; // silinmiş ama henüz commit edilmemiş olabilir
  }
  if (!bilgi.isFile() || bilgi.size > MAKS_BAYT) continue;

  taranan += 1;
  const satirlar = readFileSync(yol, 'utf8').split('\n');

  satirlar.forEach((satir, i) => {
    for (const { ad, re } of KALIPLAR) {
      const m = re.exec(satir);
      if (!m) continue;
      bulgular.push({
        yol,
        satir: i + 1,
        tur: ad,
        // Sırrın kendisi YAZDIRILMAZ: kayıt/CI çıktısı da bir sızıntı yüzeyi.
        ipucu: `${m[0].slice(0, 8)}… (${m[0].length} karakter)`,
      });
    }
  });
}

if (bulgular.length > 0) {
  console.error(`\n✗ Depoda ${bulgular.length} olası sır bulundu\n`);
  for (const b of bulgular) {
    console.error(`  ${b.yol}:${b.satir}  ${b.tur}  ${b.ipucu}`);
  }
  console.error(
    '\n  Dosyayı silmek YETMEZ: değer git geçmişinde kalır.\n' +
      '  Gerçek bir sırsa ÖNCE anahtarı döndürün (rotate), sonra geçmişi temizleyin.\n',
  );
  process.exit(1);
}

/*
 * İKİNCİ KATMAN: DERLENMİŞ İSTEMCİ PAKETİ.
 *
 * Yukarıdaki tarama depoya GİRENİ ölçer. Ama bir sır depoya hiç girmeden de
 * tarayıcıya ulaşabilir: bir ortam değişkenine `NEXT_PUBLIC_` öneki koymak
 * yeter. O anda `.env` temiz, git temiz -- ve anahtar yine de herkeste.
 *
 * Bu yüzden derleme çıktısı varsa o da taranır. Aranan şey değerin kendisi
 * değil ADI: değeri aramak, betiğe sırrı bilmesini gerektirirdi.
 */
const BUNDLE = 'apps/web/.next/static';
const YASAK_ADLAR = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'CLICK_HASH_SECRET',
  'CRON_SECRET',
  'RESEND_API_KEY',
  'postback_secret',
  /*
   * Alım hattının sırları. Liste yalnızca web uygulamasının bildiği
   * adlarla yazılmıştı; oysa bir sır istemciye ADIYLA sızmaz, bir
   * ortam değişkenine NEXT_PUBLIC_ öneki konarak sızar. O hata bu iki
   * ad için de aynen mümkündü ve kontrol onları hiç aramıyordu.
   */
  'OHAAAA_FEED_TOKEN',
  'OHAAAA_PIPELINE_TEST_TOKEN',
];

let bundleTarandi = 0;
const bundleBulgulari = [];

function bundleTara(dizin) {
  let girisler;
  try {
    girisler = readdirSync(dizin, { withFileTypes: true });
  } catch {
    return;
  }
  for (const g of girisler) {
    const yol = join(dizin, g.name);
    if (g.isDirectory()) {
      bundleTara(yol);
      continue;
    }
    if (!/\.(js|mjs|css|json|map)$/i.test(g.name)) continue;
    bundleTarandi += 1;
    const icerik = readFileSync(yol, 'utf8');
    for (const ad of YASAK_ADLAR) {
      if (icerik.includes(ad)) bundleBulgulari.push({ yol, ad });
    }
  }
}

bundleTara(BUNDLE);

if (bundleBulgulari.length > 0) {
  console.error(`\n✗ İstemci paketinde ${bundleBulgulari.length} sır adı bulundu\n`);
  for (const b of bundleBulgulari) console.error(`  ${b.yol}  →  ${b.ad}`);
  console.error('\n  Bu değişkenlere NEXT_PUBLIC_ öneki verilmiş olabilir.\n');
  process.exit(1);
}

console.log(`✓ Sır bulunamadı — ${taranan} takip edilen dosya, ${KALIPLAR.length} kalıp`);
if (bundleTarandi > 0) {
  console.log(`✓ İstemci paketi temiz — ${bundleTarandi} dosya, ${YASAK_ADLAR.length} yasak ad`);
} else {
  // Sessizce geçmek yanlış olurdu: kontrolün çalışmadığını bilmek gerekir.
  console.log('· İstemci paketi taranmadı (derleme çıktısı yok — önce npm run build)');
}
