#!/usr/bin/env node
/**
 * PERMISSIONS-POLICY UYGULAMANIN KENDİ ÖZELLİKLERİNİ KAPATIYOR MU?
 *
 * NEDEN BU BETİK VAR
 *
 * `camera=()` yazmak sezgisel olarak "kamerayı üçüncü taraflara kapat" gibi
 * görünür. Gerçekte BOŞ LİSTE hiçbir kaynağa izin vermez -- kendi
 * kaynağımıza da. Bu tek satır production'da hem fotoğrafla aramayı hem de
 * sesle aramayı sessizce öldürdü: hata düşmez, konsola bir şey yazılmaz,
 * kullanıcı yalnızca çalışmayan bir düğme görür.
 *
 * Hiçbir birim testi, tip denetimi ya da tarayıcı denetimi bunu yakalamadı.
 * `vercel.json` başlıkları Vercel platformunda uygulanır; yerelde
 * `next start` bunları hiç göndermez, dolayısıyla tarayıcı testi de göremez.
 * Yakalanabilecek tek yer yapılandırmanın kendisi.
 *
 * KURAL
 *   - Uygulamanın KULLANDIĞI bir özellik boş listeye alınamaz.
 *   - Uygulamanın KULLANMADIĞI bir özellik açık bırakılamaz (gereksiz yüzey).
 *
 * Kullanım: node scripts/verify-headers.mjs
 */

import { readFileSync } from 'node:fs';

const YOL = new URL('../apps/web/vercel.json', import.meta.url);

/**
 * Uygulamanın gerçekten kullandığı özellikler ve nerede kullanıldığı.
 * Yeni bir cihaz özelliği kullanılmaya başlanınca buraya eklenmeli.
 */
const KULLANILAN = {
  camera: 'fotoğrafla arama (VisualSearchButton — <input type=file>)',
  microphone: 'sesle arama (VoiceSearchButton — SpeechRecognition)',
};

/** Kullanılmayan, kapalı kalması gereken özellikler. */
const KULLANILMAYAN = ['geolocation'];

const bulgular = [];
const ham = readFileSync(YOL, 'utf8');
const yapi = JSON.parse(ham);

const genelBaslik = yapi.headers?.find((h) => h.source === '/(.*)');
if (!genelBaslik) {
  bulgular.push('vercel.json içinde "/(.*)" kaynağı için başlık bloğu yok.');
}

/*
 * Vercel şeması başlık nesnelerinde YALNIZCA key/value kabul eder. Araya
 * açıklama amaçlı bir alan eklemek dağıtımı şema hatasıyla düşürür; bu
 * kontrol o hatayı CI'da, dağıtımdan önce yakalar.
 */
for (const blok of yapi.headers ?? []) {
  for (const h of blok.headers ?? []) {
    const fazla = Object.keys(h).filter((k) => k !== 'key' && k !== 'value');
    if (fazla.length > 0) {
      bulgular.push(`Başlık "${h.key}" şema dışı alan taşıyor: ${fazla.join(', ')} — Vercel dağıtımı reddeder.`);
    }
  }
}

const pp = genelBaslik?.headers?.find((h) => h.key.toLowerCase() === 'permissions-policy');
if (!pp) {
  bulgular.push('permissions-policy başlığı tanımlı değil.');
} else {
  /** "camera=(self), geolocation=()" -> { camera: "(self)", geolocation: "()" } */
  const yonergeler = Object.fromEntries(
    pp.value
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const esit = p.indexOf('=');
        return [p.slice(0, esit).trim(), p.slice(esit + 1).trim()];
      }),
  );

  const bos = (v) => v === '()' || v === '' || v === 'none';

  for (const [ozellik, nerede] of Object.entries(KULLANILAN)) {
    const deger = yonergeler[ozellik];
    if (deger === undefined) continue; // tanımsız = tarayıcı varsayılanı (açık)
    if (bos(deger)) {
      bulgular.push(
        `"${ozellik}=${deger}" KENDİ kaynağımıza da kapalı, ama uygulama bunu kullanıyor: ${nerede}. ` +
          `Doğrusu "${ozellik}=(self)".`,
      );
    }
  }

  for (const ozellik of KULLANILMAYAN) {
    const deger = yonergeler[ozellik];
    if (deger !== undefined && !bos(deger)) {
      bulgular.push(`"${ozellik}=${deger}" açık ama uygulama bu özelliği kullanmıyor. Kapatın: "${ozellik}=()".`);
    }
  }
}

if (bulgular.length > 0) {
  console.error(`\n✗ ${bulgular.length} başlık sorunu bulundu\n`);
  for (const b of bulgular) console.error(`  ${b}`);
  console.error('');
  process.exit(1);
}

console.log('✓ permissions-policy tutarlı — kullanılan özellikler açık, kullanılmayanlar kapalı');
