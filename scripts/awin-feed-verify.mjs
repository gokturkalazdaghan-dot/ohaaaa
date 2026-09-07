#!/usr/bin/env node
/**
 * Awin feed'ini GERÇEKTEN indirir ve alım hattından geçirir -- hiçbir şey
 * YAZMADAN.
 *
 * NE YAPAR
 *   feed kimliği -> adres türet -> indir -> gzip aç -> ayrıştır ->
 *   normalleştir -> "kaç ürün girer" raporla
 *
 * NE YAPMAZ
 *   Veritabanına dokunmaz. `sources`, `products`, `price_points` YAZMAZ.
 *   Bu betik bir KARAR ARACIDIR: kaynağı açmaya değer mi?
 *
 * NEDEN AYRI BİR BETİK
 * Feed erişimini açan iki koşul (API anahtarı ve ağ izni) bu depodan
 * bağımsız. Koşullar sağlandığında çalıştırılacak TEK KOMUT bu olsun
 * istiyoruz; aksi hâlde doğrulama, her seferinde elle kurulan geçici
 * komutlara kalırdı ve iki kişi iki farklı şey ölçerdi.
 *
 * Kullanım:
 *   AWIN_DATAFEED_API_KEY=... node scripts/awin-feed-verify.mjs 111515 [108580 ...]
 */
import { AWIN_FEED_COLUMNS, AWIN_FEED_MAPPING, buildAwinFeedUrl }
  from '../packages/shared/dist/providers/awinFeed.js';
import { requireAwinDatafeedKey, safeAwinError }
  from '../packages/ingest/dist/awinFeedAccess.js';
import { classifyPayload, decodeFeedPayload }
  from '../packages/ingest/dist/http/payload.js';
import { detectFeedErrorEnvelope } from '../packages/shared/dist/providers/awinFeed.js';
import { parseCsv } from '../packages/ingest/dist/adapters/csv.js';
import { normalizeRecords } from '../packages/ingest/dist/normalize.js';

const feedIds = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (feedIds.length === 0) {
  console.error('Kullanım: node scripts/awin-feed-verify.mjs <feedId> [feedId...]');
  process.exit(2);
}

/*
 * GÖVDE SINIRI. Awin feed'leri 100 bin kalemi aşabiliyor; sınırsız okuma tek
 * bir dev dosyanın işçiyi düşürmesi demek. Sınır SIKIŞTIRILMIŞ akışa
 * uygulanıyor -- `decodeFeedPayload` açılmış boyutu ayrıca sınırlıyor
 * (sıkıştırma bombası koruması).
 */
const MAX_BODY_BYTES = 256 * 1024 * 1024;

let anahtar;
try {
  anahtar = requireAwinDatafeedKey();
} catch (hata) {
  console.error(`✗ ${safeAwinError(hata)}`);
  console.error('  Anahtar bu ortamın gizli değişkenlerine AWIN_DATAFEED_API_KEY');
  console.error('  adıyla eklenmeli (NEXT_PUBLIC_ öneki OLMADAN).');
  process.exit(3);
}

let cikis = 0;

for (const feedId of feedIds) {
  console.log(`\n▸ feed ${feedId}`);

  // ADRES BURADA ÜRETİLİYOR VE HİÇBİR YERE YAZILMIYOR: içinde anahtar var.
  let adres;
  try {
    adres = buildAwinFeedUrl({ feedIds: [feedId], apiKey: anahtar, columns: AWIN_FEED_COLUMNS });
  } catch (hata) {
    console.log(`  ✗ adres üretilemedi: ${safeAwinError(hata)}`);
    cikis = 1;
    continue;
  }

  let yanit;
  try {
    yanit = await fetch(adres, { redirect: 'follow' });
  } catch (hata) {
    /*
     * AĞ HATASI İLE YETKİ HATASI AYRI RAPORLANIYOR: ilki ortamın (vekil,
     * DNS, güvenlik duvarı), ikincisi hesabın sorunudur ve çareleri ayrıdır.
     */
    console.log(`  ✗ ağa çıkılamadı: ${safeAwinError(hata)}`);
    console.log('    sınıf: unavailable (ortam sorunu — vekil/güvenlik duvarı)');
    cikis = 1;
    continue;
  }

  console.log(`  HTTP             ${yanit.status}`);

  /*
   * DURUM KODU ÖNCE SINIFLANDIRILIYOR.
   *
   * ÖLÇÜLDÜ: bu betiğin ilk hâli 403'ü ayırt etmiyordu. Vekil CONNECT'i
   * reddedince gövde 107 baytlık bir hata sayfası oldu, CSV çözümleyici
   * ondan sıfır satır çıkardı ve rapor "hattan geçen 0" dedi -- yani
   * "erişemedik" ile "feed boş" aynı satıra düştü. Görevin istediği ayrım
   * (credentials / unsupported_transport / unavailable / manual_required)
   * tam olarak burada kayboluyordu.
   */
  if (!yanit.ok) {
    const govde = (await yanit.text()).slice(0, 300);
    const mesaj = detectFeedErrorEnvelope(govde) ?? govde.replace(/\s+/g, ' ').trim();
    /*
     * 403 İKİ AYRI ŞEY OLABİLİR ve çareleri farklı yerlerde:
     *   - Awin anahtarı reddetti      -> credentials  (hesap tarafı)
     *   - Vekil hostu engelledi       -> unavailable  (ortam tarafı)
     *
     * ÖLÇÜLDÜ: bu ortamda ikincisi oluyor ve vekil bunu gövdede AÇIKÇA
     * söylüyor ("Host not in allowlist: productdata.awin.com"). İkisini
     * "credentials" diye tek torbaya atmak, anahtarı boşuna yenilemeye
     * gönderirdi -- oysa sorun ağ politikasında.
     */
    const ortamEngeli = /not in allowlist|egress|proxy/i.test(govde);
    const sinif =
      ortamEngeli ? 'unavailable'
      : yanit.status === 401 || yanit.status === 403 ? 'credentials'
      : yanit.status === 404 ? 'manual_required'
      : 'unavailable';
    console.log(`  ✗ indirilemedi — sınıf: ${sinif}`);
    if (mesaj) console.log(`    ${safeAwinError(mesaj)}`);
    if (ortamEngeli) {
      console.log('    ÇARE: ortamın ağ egress ayarlarına productdata.awin.com eklenmeli.');
      console.log('    (anahtar sorunu DEĞİL — istek Awin sunucusuna hiç ulaşmadı)');
    }
    cikis = 1;
    continue;
  }

  const uzunluk = Number(yanit.headers.get('content-length') ?? '0');
  if (uzunluk > MAX_BODY_BYTES) {
    console.log(`  ✗ gövde çok büyük (${uzunluk} bayt) — indirilmedi`);
    cikis = 1;
    continue;
  }

  const ham = new Uint8Array(await yanit.arrayBuffer());
  console.log(`  indirilen        ${ham.byteLength} bayt`);
  if (ham.byteLength > MAX_BODY_BYTES) {
    console.log('  ✗ gövde sınırı aşıldı');
    cikis = 1;
    continue;
  }

  // Biçim SIHIRLI BAYTTAN: sunucu ".csv.gz" adıyla düz JSON hata da döndürebilir.
  console.log(`  taşıma           ${classifyPayload(ham)}`);

  let metin;
  try {
    metin = decodeFeedPayload(ham);
  } catch (hata) {
    console.log(`  ✗ gövde çözülemedi: ${safeAwinError(hata)}`);
    cikis = 1;
    continue;
  }

  /*
   * FEED Mİ, HATA MI? Ağlar yetki/adres hatasında feed yerine küçük bir JSON
   * döndürüp bunu feed'in kendi adıyla sunar. Ayırt edilmezse "feed boş"
   * sanılır ve 404'e sonsuza dek vurulur.
   */
  const agHatasi = detectFeedErrorEnvelope(metin);
  if (agHatasi !== null) {
    console.log(`  ✗ feed değil, ağ hata cevabı: ${agHatasi}`);
    console.log('    sınıf: credentials (anahtar/adres yanlış — tekrar denemek düzeltmez)');
    cikis = 1;
    continue;
  }

  const { records } = parseCsv(metin);
  const paraBirimleri = new Set(
    records.map((r) => String(r[AWIN_FEED_MAPPING.currency] ?? '').trim().toUpperCase()).filter(Boolean),
  );
  const guncelleme = new Set(records.map((r) => r.last_updated).filter(Boolean));

  const sonuc = normalizeRecords(records, AWIN_FEED_MAPPING, {
    defaultCurrency: paraBirimleri.size === 1 ? [...paraBirimleri][0] : 'XXX',
    allowedHosts: ['awin1.com', 'www.awin1.com'],
  });

  console.log(`  ham satır        ${records.length}`);
  console.log(`  merchant_id      ${[...new Set(records.map((r) => r.merchant_id).filter(Boolean))].join(',') || '—'}`);
  console.log(`  para birimi      ${[...paraBirimleri].join(',') || '— (BOŞ)'}`);
  console.log(`  last_updated     ${guncelleme.size > 0 ? `${guncelleme.size} farklı değer` : '— (BOŞ)'}`);
  console.log(`  hattan geçen     ${sonuc.offers.length}`);
  console.log(`  elenen           ${sonuc.errors.length}`);

  if (sonuc.offers.length === 0) {
    console.log('  ✗ bu feed’den ürün girmiyor — kaynak AÇILMAMALI');
    cikis = 1;
  } else {
    console.log('  ✓ feed hattan geçiyor');
  }
}

process.exit(cikis);
