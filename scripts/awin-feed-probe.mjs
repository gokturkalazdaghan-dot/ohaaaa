#!/usr/bin/env node
/**
 * Awin feed sondası — ÖLÇER, YAZMAZ.
 *
 * ======================================================================
 * NE İŞE YARAR
 * ======================================================================
 * `program_feeds` tablosunda dört sütun var ve hiçbirini yazan kod yoktu:
 *
 *   measured_item_count · ingestable_count · measured_currency · checked_at
 *
 * Şema bu ölçümü bekliyordu (`program_feeds_measure_needs_time` kısıtı
 * ikisini birbirine bağlıyor), ama ölçen taraf hiç yazılmamıştı. Sonucu
 * FAZ 2'de görüldü: on programın ürün sayısı Awin'in İLANINDAN okunuyordu,
 * ölçümden değil. İlan edilen 200.000 kalemin kaçının gerçekten
 * alınabileceği bilinmiyordu.
 *
 * Bu betik o boşluğu kapatır: bir feed parçasının İLK N SATIRINI indirir,
 * alan doluluk oranlarını sayar ve raporlar.
 *
 * ======================================================================
 * VERİTABANINA YAZMAZ
 * ======================================================================
 * Bilinçli. Ölçüm ile alım aynı komutta olsaydı "önce ölç, sonra karar ver"
 * kuralı ilk acele eden kişide bozulurdu. Bu betik yalnızca OKUR ve
 * stdout'a yazar; `products` tablosuna bir satır bile girmez.
 *
 * ======================================================================
 * TAM İNDİRMEZ — ERKEN KOPARIR
 * ======================================================================
 * Lunzo/Lapert feed'leri parça başına 200.000 kalem ilan ediyor. Tamamını
 * indirmek ölçüm için gereksiz, kaynağa karşı da nezaketsiz. Bu yüzden
 * istek, yeterli satır toplandığı anda `AbortController` ile KESİLİR.
 *
 * NEDEN `createPoliteClient` DEĞİL: o istemci gövdeyi tamponlar ve
 * `maxBytes` aşılınca `ResponseTooLargeError` FIRLATIR -- kırpmaz. 200.000
 * satırlık bir feed'de bu, örnek yerine hata demekti. Sondanın ihtiyacı
 * tam tersi: sınırı aşınca durup ELDEKİNİ vermek. O yüzden burada doğrudan
 * `fetch` + erken kopar + sert bayt tavanı var, ve host bizim kendi
 * veritabanımızdan gelse bile AÇIK LİSTEYE karşı doğrulanıyor.
 *
 * ======================================================================
 * ANAHTAR HİÇBİR ÇIKTIYA GİRMEZ
 * ======================================================================
 * Feed adresi `${AWIN_DATAFEED_API_KEY}` yer tutucusuyla veritabanında
 * duruyor; gerçek değer yalnızca ortamdan okunur, isteğin içinde kalır ve
 * basılan her adreste `/apikey/<REDACTED>/` olarak maskelenir. Hata
 * mesajları da aynı maskeden geçer -- bir istisna metninin içinde sızması
 * en olası yol olurdu.
 *
 * KULLANIM
 *   node scripts/awin-feed-probe.mjs --fid=84173 [--rows=2000] [--json]
 *
 * ORTAM
 *   AWIN_DATAFEED_API_KEY   feed indirme anahtarı (zorunlu)
 *   SUPABASE_URL            feed adresini okumak için
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * ÇIKIŞ KODLARI
 *   0  ölçüm tamam
 *   2  yapılandırma eksik (anahtar/ortam)
 *   3  ağ ya da HTTP hatası
 */

import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { createClient } from '@supabase/supabase-js';
import { parseCsv } from '@ohaaaa/ingest';

/** Sondanın çıkabileceği TEK host. Veritabanı ele geçse bile istek başka yere gitmez. */
const IZINLI_HOST = 'productdata.awin.com';

/** Sert bayt tavanı (sıkıştırılmış). Satır hedefine ulaşılmasa da burada durur. */
const MAX_BAYT = 12 * 1024 * 1024;

const VARSAYILAN_SATIR = 2000;

const USER_AGENT =
  process.env.OHAAAA_USER_AGENT ??
  'OhaaaaBot/1.0 (+https://ohaaaa.com/bot; iletisim@ohaaaa.com)';

/**
 * Adresteki anahtarı maskeler.
 *
 * HER ÇIKTI BUNDAN GEÇER -- log, hata, JSON. Tek bir yerde unutulsa
 * anahtar CI günlüğüne düşerdi ve CI günlükleri kalıcıdır.
 */
function maskele(metin) {
  return String(metin).replace(/\/apikey\/[^/]+/g, '/apikey/<REDACTED>');
}

function cik(kod, mesaj) {
  console.error(maskele(mesaj));
  process.exit(kod);
}

function argOku() {
  const arg = new Map();
  for (const ham of process.argv.slice(2)) {
    const esitlik = ham.indexOf('=');
    if (ham.startsWith('--') && esitlik > 2) {
      arg.set(ham.slice(2, esitlik), ham.slice(esitlik + 1));
    } else if (ham.startsWith('--')) {
      arg.set(ham.slice(2), 'true');
    }
  }
  return arg;
}

/** `${AD}` yer tutucularını ortamdan doldurur. Eksik değişken SESSİZ GEÇMEZ. */
function yerTutucuDoldur(adres) {
  const eksik = [];
  const dolu = adres.replace(/\$\{([A-Z0-9_]+)\}/g, (_, ad) => {
    const deger = process.env[ad];
    if (!deger) {
      eksik.push(ad);
      return '';
    }
    return encodeURIComponent(deger);
  });
  return { dolu, eksik };
}

/**
 * Feed adresini veritabanından okur.
 *
 * ADRES KODA GÖMÜLMEZ: tek doğru kaynak `program_feeds.feed_url` ve o
 * satır Awin'in kendi dizininden geliyor. Buraya kopyalamak, dizin
 * yenilendiğinde sessizce eskiyen ikinci bir kopya demekti.
 */
async function feedAdresiniOku(fid) {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    cik(2, 'SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanimli olmali.');
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('program_feeds')
    .select('network_feed_id, feed_name, region, language, network_item_count, feed_url, program_id')
    .eq('network_feed_id', String(fid))
    .limit(1);

  if (error) cik(3, `program_feeds okunamadi: ${error.message}`);
  if (!data || data.length === 0) cik(2, `network_feed_id=${fid} icin satir yok.`);
  return data[0];
}

/**
 * İlk N satırı indirir. Yeterli satır toplanınca isteği KESER.
 *
 * Dönen metin son satırın ortasında bitebilir; o satır `parseCsv`'ye
 * verilmeden ATILIR -- yarım bir satırı alan sayısı eksik diye "bozuk
 * kayıt" saymak, ölçümü kendi kırpmamızla kirletmek olurdu.
 */
async function ilkSatirlariCek(adres, hedefSatir) {
  const kontrol = new AbortController();
  const baslangic = Date.now();

  let yanit;
  try {
    yanit = await fetch(adres, {
      signal: kontrol.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'text/csv,*/*' },
      redirect: 'follow',
    });
  } catch (hata) {
    cik(3, `istek basarisiz: ${hata instanceof Error ? hata.message : hata}`);
  }

  if (!yanit.ok) {
    /*
     * 404 BURADA ÖZELLİKLE ANLAMLIDIR.
     * Ölçüldü (FAZ 2): Awin'in indirme ucu GEÇERSİZ ANAHTARA da 404 diyor,
     * 401 demiyor. Yani "feed kalkmış" ile "anahtar bozuk" aynı koda
     * düşüyor. Bu yüzden mesaj ikisini birlikte söylüyor -- sessiz bir
     * "feed yok" yorumu boş katalogla sonuçlanırdı.
     */
    const ipucu =
      yanit.status === 404
        ? ' (DİKKAT: Awin gecersiz ANAHTARA da 404 donuyor; feed yok demek olmayabilir)'
        : '';
    cik(3, `HTTP ${yanit.status}${ipucu} — ${maskele(adres)}`);
  }

  const gzipli = /gzip/i.test(yanit.headers.get('content-encoding') ?? '')
    ? false // fetch zaten açtı
    : /\.gz|gzip/i.test(adres) || (yanit.headers.get('content-type') ?? '').includes('gzip');

  let hamBayt = 0;
  let metin = '';
  let satirSayisi = 0;
  let kesildi = false;

  const kaynak = Readable.fromWeb(yanit.body);
  kaynak.on('data', (parca) => {
    hamBayt += parca.length;
    if (hamBayt > MAX_BAYT) {
      kesildi = true;
      kontrol.abort();
    }
  });

  const tuket = async (akis) => {
    for await (const parca of akis) {
      metin += parca.toString('utf8');
      satirSayisi = 0;
      for (let i = 0; i < metin.length; i += 1) if (metin[i] === '\n') satirSayisi += 1;
      if (satirSayisi > hedefSatir) {
        kesildi = true;
        kontrol.abort();
        break;
      }
    }
  };

  try {
    if (gzipli) {
      const gunzip = createGunzip();
      await Promise.all([pipeline(kaynak, gunzip), tuket(gunzip)]);
    } else {
      await tuket(kaynak);
    }
  } catch (hata) {
    // Erken kopardığımız için gelen iptal/akış hatası BEKLENEN durumdur.
    const mesaj = hata instanceof Error ? hata.message : String(hata);
    const beklenen = kesildi || /abort|premature close|ERR_STREAM/i.test(mesaj);
    if (!beklenen) cik(3, `akis hatasi: ${mesaj}`);
  }

  return {
    metin,
    sikistirilmisBayt: hamBayt,
    kesildi,
    sureMs: Date.now() - baslangic,
    contentLength: Number(yanit.headers.get('content-length')) || null,
    contentType: yanit.headers.get('content-type'),
  };
}

/** Son satır yarım olabilir; onu atar. */
function yarimSatiriAt(metin) {
  const son = metin.lastIndexOf('\n');
  return son === -1 ? metin : metin.slice(0, son);
}

function sayiMi(deger) {
  if (typeof deger !== 'string') return false;
  const t = deger.trim().replace(',', '.');
  if (t === '') return false;
  return Number.isFinite(Number(t)) && Number(t) > 0;
}

function olc(kayitlar) {
  if (kayitlar.length === 0) return { kolonlar: [], ozet: {} };

  const kolonlar = Object.keys(kayitlar[0]);
  const doluluk = {};
  for (const k of kolonlar) doluluk[k] = 0;

  const paraBirimleri = new Map();
  const stokDegerleri = new Map();
  const hostlar = new Map();
  let fiyatOkunan = 0;

  for (const kayit of kayitlar) {
    for (const k of kolonlar) {
      const v = kayit[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') doluluk[k] += 1;
    }

    const para = (kayit.currency ?? '').trim().toUpperCase();
    if (para) paraBirimleri.set(para, (paraBirimleri.get(para) ?? 0) + 1);

    const stok = (kayit.in_stock ?? kayit.stock_status ?? '').trim();
    if (stok) stokDegerleri.set(stok, (stokDegerleri.get(stok) ?? 0) + 1);

    if (sayiMi(kayit.search_price)) fiyatOkunan += 1;

    const adres = kayit.aw_deep_link || kayit.merchant_deep_link || '';
    if (adres) {
      try {
        hostlar.set(new URL(adres).host, (hostlar.get(new URL(adres).host) ?? 0) + 1);
      } catch {
        hostlar.set('<gecersiz-url>', (hostlar.get('<gecersiz-url>') ?? 0) + 1);
      }
    }
  }

  const n = kayitlar.length;
  const oran = (x) => Number(((x / n) * 100).toFixed(1));

  return {
    kolonlar,
    ornekSatir: n,
    doluluk: Object.fromEntries(kolonlar.map((k) => [k, oran(doluluk[k])])),
    paraBirimleri: Object.fromEntries(paraBirimleri),
    stokDegerleri: Object.fromEntries(stokDegerleri),
    deeplinkHostlari: Object.fromEntries(hostlar),
    fiyatOkunabilirYuzde: oran(fiyatOkunan),
    /*
     * ALINABİLİR SATIR: pipeline'ın zorunlu alanları
     * (`normalize.ts` red gerekçeleri: external_id, title, url, price).
     * Para birimi kolonu olmayan feed'lerde `defaultCurrency` devreye
     * girdiği için burada ARANMIYOR.
     */
    alinabilirYuzde: oran(
      kayitlar.filter(
        (k) =>
          String(k.aw_product_id ?? '').trim() !== '' &&
          String(k.product_name ?? '').trim() !== '' &&
          /*
           * `||` KULLANILIYOR, `??` DEĞİL.
           * `??` yalnızca null/undefined'da geri düşer; feed'de boş bir
           * `aw_deep_link` kolonu BOŞ DİZE olarak gelir ve `??` onu geçerli
           * sayıp `merchant_deep_link`e hiç bakmazdı. Sonuç: adresi olan
           * satırlar "alınamaz" sayılır ve kapsam kararı olduğundan kötü
           * bir sayının üstüne kurulurdu. Testle yakalandı.
           */
          String(k.aw_deep_link || k.merchant_deep_link || '').trim() !== '' &&
          sayiMi(k.search_price),
      ).length,
    ),
    kimlikler: {
      ean: oran(kayitlar.filter((k) => String(k.ean ?? '').trim() !== '').length),
      upc: oran(kayitlar.filter((k) => String(k.upc ?? '').trim() !== '').length),
      mpn: oran(
        kayitlar.filter(
          (k) => String(k.mpn ?? k.model_number ?? '').trim() !== '',
        ).length,
      ),
      sku: oran(
        kayitlar.filter((k) => String(k.merchant_product_id ?? '').trim() !== '').length,
      ),
    },
  };
}

async function main() {
  const arg = argOku();
  const fid = arg.get('fid');
  if (!fid || !/^\d{1,12}$/.test(fid)) {
    cik(2, 'Kullanim: node scripts/awin-feed-probe.mjs --fid=<feedId> [--rows=2000] [--json]');
  }

  const hedefSatir = Number(arg.get('rows') ?? VARSAYILAN_SATIR);
  if (!Number.isInteger(hedefSatir) || hedefSatir < 1 || hedefSatir > 50_000) {
    cik(2, '--rows 1 ile 50000 arasinda bir tam sayi olmali.');
  }

  if (!process.env.AWIN_DATAFEED_API_KEY?.trim()) {
    cik(2, 'AWIN_DATAFEED_API_KEY tanimli degil. Sonda kimliksiz istek ATMAZ.');
  }

  const feed = await feedAdresiniOku(fid);
  if (!feed.feed_url) cik(2, `fid=${fid} icin feed_url bos.`);

  const { dolu, eksik } = yerTutucuDoldur(feed.feed_url);
  if (eksik.length > 0) {
    cik(2, `Adresteki gizli degisken(ler) ortamda yok: ${eksik.join(', ')}`);
  }

  let hedef;
  try {
    hedef = new URL(dolu);
  } catch {
    cik(2, 'feed_url gecerli bir adres degil.');
  }
  if (hedef.protocol !== 'https:' || hedef.host !== IZINLI_HOST) {
    cik(2, `Adres izinli host disinda: ${hedef.protocol}//${hedef.host} (izinli: https://${IZINLI_HOST})`);
  }

  const indirme = await ilkSatirlariCek(hedef.toString(), hedefSatir);
  const { records, warnings } = parseCsv(yarimSatiriAt(indirme.metin));
  const olcum = olc(records);

  const rapor = {
    feed: {
      network_feed_id: feed.network_feed_id,
      feed_name: feed.feed_name,
      region: feed.region,
      language: feed.language,
      ilanEdilenKalem: feed.network_item_count,
    },
    indirme: {
      sikistirilmisBayt: indirme.sikistirilmisBayt,
      contentLength: indirme.contentLength,
      contentType: indirme.contentType,
      erkenKesildi: indirme.kesildi,
      sureMs: indirme.sureMs,
    },
    olcum,
    uyarilar: warnings,
  };

  if (arg.get('json') === 'true') {
    console.log(maskele(JSON.stringify(rapor, null, 2)));
    return;
  }

  const y = (s) => console.log(maskele(s));
  y(`\n=== FEED ${feed.network_feed_id} — ${feed.feed_name ?? '(adsiz)'} ===`);
  y(`bolge/dil        : ${feed.region ?? '?'} / ${feed.language ?? '?'}`);
  y(`ilan edilen kalem: ${feed.network_item_count ?? '?'}`);
  y(`indirilen        : ${indirme.sikistirilmisBayt} bayt${indirme.kesildi ? ' (ERKEN KESILDI)' : ''}, ${indirme.sureMs} ms`);
  y(`content-length   : ${indirme.contentLength ?? '(bildirilmedi)'}`);
  y(`ornek satir      : ${olcum.ornekSatir}`);
  y(`kolon sayisi     : ${olcum.kolonlar?.length ?? 0}`);
  y(`fiyat okunabilir : ${olcum.fiyatOkunabilirYuzde}%`);
  y(`ALINABILIR       : ${olcum.alinabilirYuzde}%  (external_id+title+url+price)`);
  y(`para birimleri   : ${JSON.stringify(olcum.paraBirimleri)}`);
  y(`stok degerleri   : ${JSON.stringify(olcum.stokDegerleri)}`);
  y(`deeplink hostlari: ${JSON.stringify(olcum.deeplinkHostlari)}`);
  y(`kimlikler %      : ${JSON.stringify(olcum.kimlikler)}`);
  if (warnings.length > 0) y(`uyarilar         : ${warnings.join(' | ')}`);
  y('\n--- kolon doluluk % ---');
  for (const [k, v] of Object.entries(olcum.doluluk ?? {})) y(`  ${k.padEnd(32)} ${v}`);
  y('');
}

/*
 * SAF PARÇALAR TEST İÇİN İHRAÇ EDİLİYOR.
 *
 * Maskeleme ve "alınabilir satır" sayımı sessizce bozulabilecek iki yer:
 * biri anahtarı CI günlüğüne sızdırır, diğeri yanlış bir kapsam kararına
 * yol açar. İkisi de testle sabitlendi (`awin-feed-probe.test.mjs`).
 *
 * `main` yalnızca betik DOĞRUDAN çalıştırıldığında koşar; test dosyası
 * import ettiğinde ağa çıkmaz.
 */
export { maskele, yarimSatiriAt, olc, yerTutucuDoldur, sayiMi, IZINLI_HOST };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((hata) => {
    cik(3, `beklenmeyen hata: ${hata instanceof Error ? hata.message : hata}`);
  });
}
