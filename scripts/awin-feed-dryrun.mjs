#!/usr/bin/env node
/**
 * Awin feed'ini ALIM HATTINDAN geçirir ve NE OLACAĞINI söyler -- hiçbir şey
 * yazmadan.
 *
 * NEDEN VAR
 * Bir feed'i "kaynak" olarak açmadan önce cevaplanması gereken soru şu:
 * bu feed'den KAÇ ürün gerçekten girer? Awin'in bildirdiği ürün sayısı bu
 * soruyu cevaplamaz -- o, ağın deposundaki satır sayısıdır. Bizim
 * normalleştiricimizden geçebilen satır sayısı bambaşka olabilir.
 *
 * ÖLÇÜLDÜ: Alison US CA (MID 120101, feed 111515) 5.594 satır bildiriyor;
 * hattan geçen ürün sayısı SIFIR. Feed'de fiyat sütunlarının hepsi boş
 * ("display_price" her satırda "USD0.00"). Kaynak açılsaydı her turda 5.594
 * satır reddedilir, katalog boş kalır ve hata sayacı sonsuza dek dolardı.
 *
 * AĞA ÇIKMAZ, ANAHTAR İSTEMEZ
 * Girdi yerel bir dosyadır (.csv ya da .csv.gz). Feed'i indirmek ayrı bir
 * iştir ve API anahtarı gerektirir; bu betik indirilmiş bir dosyayı inceler.
 *
 * Kullanım:
 *   node scripts/awin-feed-dryrun.mjs <feed.csv.gz> [--host alison.com]
 */
import { readFileSync } from 'node:fs';

import { parseCsv } from '../packages/ingest/dist/adapters/csv.js';
import { normalizeRecords } from '../packages/ingest/dist/normalize.js';
import { classifyPayload, decodeFeedPayload } from '../packages/ingest/dist/http/payload.js';
import { AWIN_FEED_MAPPING } from '../packages/shared/dist/providers/awinFeed.js';

const [, , dosya, ...bayraklar] = process.argv;
if (!dosya) {
  console.error('Kullanım: node scripts/awin-feed-dryrun.mjs <feed.csv.gz> [--host alan.adi]');
  process.exit(2);
}

const hostBayrak = bayraklar.indexOf('--host');
const izinliHostlar = hostBayrak === -1 ? [] : bayraklar.slice(hostBayrak + 1);

const ham = readFileSync(dosya);
const bicim = classifyPayload(ham);
/*
 * Biçim SIHIRLI BAYTTAN okunuyor, dosya adından değil: ".csv" uzantılı bir
 * zip ya da ".gz" uzantılı düz metin sık görülür.
 */
const metin = decodeFeedPayload(ham);
const { records } = parseCsv(metin);

/*
 * Para birimi feed'in KENDİ sütunundan geliyor; `defaultCurrency` yalnızca o
 * sütun boşsa devreye girer ve burada bilerek boş bırakılamaz bir değer
 * veriliyor: kuru dry-run'da uydurmak, gerçek alımda yapılacak hatayı
 * gizlerdi.
 */
const feedParaBirimleri = new Set(
  records.map((r) => String(r[AWIN_FEED_MAPPING.currency] ?? '').trim().toUpperCase()).filter(Boolean),
);

const sonuc = normalizeRecords(records, AWIN_FEED_MAPPING, {
  defaultCurrency: feedParaBirimleri.size === 1 ? [...feedParaBirimleri][0] : 'XXX',
  allowedHosts: izinliHostlar,
});

const sebepler = new Map();
for (const hata of sonuc.errors) {
  /*
   * Sebepler GRUPLANIYOR: her satır kendi kimliğini/adresini mesaja koyuyor
   * ve gruplanmasaydı 5.594 ayrı "sebep" listelenir, hiçbiri okunmazdı.
   */
  const anahtar = hata.reason
    .replace(/"[^"]*"/g, '"…"')
    .replace(/https?:\/\/\S+/g, '<adres>');
  sebepler.set(anahtar, (sebepler.get(anahtar) ?? 0) + 1);
}

const gtinli = sonuc.offers.filter((o) => o.gtin).length;
const markali = sonuc.offers.filter((o) => o.brand).length;
const merchantIds = new Set(records.map((r) => r.merchant_id).filter(Boolean));
const feedIds = new Set(records.map((r) => r.data_feed_id).filter(Boolean));
const guncelleme = new Set(records.map((r) => r.last_updated).filter(Boolean));

console.log(`▸ dosya            ${dosya}`);
console.log(`  taşıma biçimi    ${bicim}`);
console.log(`  ham satır        ${records.length}`);
console.log(`  merchant_id      ${[...merchantIds].join(',') || '—'}`);
console.log(`  data_feed_id     ${[...feedIds].join(',') || '—'}`);
console.log(`  feed para birimi ${[...feedParaBirimleri].join(',') || '— (BOŞ)'}`);
console.log(`  last_updated     ${guncelleme.size > 0 ? `${guncelleme.size} farklı değer` : '— (BOŞ)'}`);
console.log(`▸ hattan geçen     ${sonuc.offers.length}`);
console.log(`  elenen           ${sonuc.errors.length}`);
for (const [sebep, adet] of [...sebepler].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  console.log(`    ${String(adet).padStart(6)}  ${sebep}`);
}
console.log(`  GTIN dolu        ${gtinli}`);
console.log(`  marka dolu       ${markali}`);

/*
 * ÇIKIŞ KODU BİR KARAR: hiçbir ürün geçmiyorsa bu feed'den kaynak AÇILMAMALI.
 * Betiği bir insan da CI de aynı şekilde okuyabilsin diye kod ile bitiyor.
 */
if (sonuc.offers.length === 0) {
  console.log("\n✗ Bu feed'den ürün girmiyor — kaynak AÇILMAMALI.");
  process.exit(1);
}
console.log('\n✓ Feed hattan geçiyor.');
