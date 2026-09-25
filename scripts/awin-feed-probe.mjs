#!/usr/bin/env node
/**
 * AWIN FEED YOKLAMASI — bir feed ID'sinin arkasında NE olduğunu ölçer.
 *
 * ÇÖZDÜĞÜ SORUN
 * `awin-feed-directory.mjs` Awin'in liste uç noktasını okur. O liste her
 * feed'i İÇERMİYOR: yeni açılan bir ortaklık (ölçüldü: Voghion) listede
 * hiç görünmeyebiliyor. Elimizde yalnızca çıplak bir feed numarası
 * kaldığında dizin bir işe yaramıyor.
 *
 * Bu betik listeyi atlar ve feed'i DOĞRUDAN indirir. Ürünün kendisi
 * reklamverenin kim olduğunu zaten söylüyor: her satırda `merchant_id`,
 * `merchant_name` ve `currency` var. "Numara neyin numarası" sorusunun
 * en güvenilir cevabı feed'in kendisi.
 *
 * ---------------------------------------------------------------------------
 * NEDEN TAHMİN DEĞİL ÖLÇÜM
 * ---------------------------------------------------------------------------
 * Bir kaynak açmak için pazar, ülke ve para birimi gerekiyor. Bunları
 * "global bir pazaryeri, herhalde USD" diye doldurmak fiyatları sessizce
 * yanlış para biriminde gösterirdi. Feed ne diyorsa o yazılır; feed
 * karışık para birimi taşıyorsa satır ölçüm olarak kaydedilir ama
 * `measured_currency` BOŞ bırakılır -- tek bir değer doğru değildir.
 *
 * ---------------------------------------------------------------------------
 * NEDEN AKIŞ HÂLİNDE
 * ---------------------------------------------------------------------------
 * Bu dosyalar yüzlerce megabayt (ölçüldü: 255 MB tek dosya). Belleğe
 * almak koşucuyu düşürür. Gzip akıştan çözülür, satırlar sayılırken
 * yalnızca ilk birkaçı saklanır.
 *
 * ---------------------------------------------------------------------------
 * DEPO PUBLIC — GÜNLÜĞE VERİ YAZILMAZ
 * ---------------------------------------------------------------------------
 * Günlüğe yalnızca feed numarası, HTTP durumu ve SAYILAR düşer.
 * Reklamveren adı, ürün adları ve fiyatlar doğrudan veritabanına gider.
 * `awin-feed-directory.mjs` ile aynı kural.
 *
 * ---------------------------------------------------------------------------
 * ÖLÇÜLDÜ (2026-09-25) -- NE ÇALIŞIR, NE ÇALIŞMAZ
 * ---------------------------------------------------------------------------
 * Yoklama iki bilinen feed'de Awin'in kendi bildirdiği sayıyı BİREBİR
 * tutturdu: fid 58891 -> 6470 ürün, fid 488 -> 315 ürün. Sayaç doğru.
 *
 * Üyelik ENGEL DEĞİL: "Not Joined" bir reklamverenin feed'i (fid 117783)
 * sorunsuz indi (50 ürün, EUR). Yani 404 alan bir numara "katılmadık"
 * demek değil, "bu anahtar o feed'e HİÇ erişemiyor" demek.
 *
 * `ui.awin.com/productdata-darwin-download/...` adresi sunucudan
 * ÇALIŞMIYOR. On yol varyantı denendi (`/health` dahil); hepsi
 * `404 {"message":"No route found..."}`. Ağ geçidi servis önekini kesip
 * isteği rotasız bir uygulamaya bırakıyor. O adresler tarayıcı oturumuna
 * ait; `F` öneki de oraya ait -- bu uç nokta SAYISAL fid istiyor.
 *
 * KULLANIM
 *   AWIN_PROBE_FIDS=3336,115564 node scripts/awin-feed-probe.mjs
 */

import { StringDecoder } from 'node:string_decoder';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

import { createClient } from '@supabase/supabase-js';

/**
 * İNDİRME ADRESİ ALIM İLE BİREBİR AYNI.
 *
 * Yoklama ile gerçek alım farklı kolonlar isteseydi, yoklamanın "temiz"
 * dediği bir feed alımda boş çıkabilirdi. Kolon listesi üretimdeki
 * `grade-mobile-main` kaynağından kopyalandı.
 */
const KOLONLAR = [
  'data_feed_id', 'merchant_id', 'merchant_name', 'aw_product_id',
  'aw_deep_link', 'merchant_deep_link', 'aw_image_url', 'product_name',
  'description', 'search_price', 'rrp_price', 'currency', 'in_stock',
  'stock_status', 'ean', 'brand_name', 'merchant_image_url',
  'merchant_category', 'merchant_product_id', 'delivery_cost', 'last_updated',
].join(',');

/** Yarım kayıt için ayrılan en büyük tampon (4 MB). */
const TAMPON_SINIRI = 4 * 1024 * 1024;

/** Yer tutuculu biçim: veritabanına YALNIZCA bu hâli yazılır. */
export function feedAdresi(fid, dil = 'en', anahtar = '${AWIN_DATAFEED_API_KEY}') {
  return `https://productdata.awin.com/datafeed/download/apikey/${anahtar}` +
    `/language/${dil}/fid/${fid}/columns/${KOLONLAR}` +
    '/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/';
}

/**
 * Tırnak durumunu TAKİP EDEN satır sayacı.
 *
 * Ürün açıklamalarında satır sonu var ve tırnak içinde duruyor. `\n`
 * saymak ürün sayısını katlardı -- ve sonuç "ölçüldü" etiketiyle
 * veritabanına yazılırdı. Yanlış bir ölçüm, ölçüm olmamasından kötü.
 */
export function satirSayaci() {
  let tirnakta = false;
  let hicKarakter = false;
  let sonSatirSonu = true;
  let toplam = 0;
  return {
    /** Parçayı yutar. */
    yut(parca) {
      for (let i = 0; i < parca.length; i += 1) {
        const k = parca[i];
        hicKarakter = true;
        if (tirnakta) {
          if (k === '"') tirnakta = false;
          continue;
        }
        if (k === '"') { tirnakta = true; sonSatirSonu = false; continue; }
        if (k === '\n') { toplam += 1; sonSatirSonu = true; continue; }
        if (k === '\r') continue;
        sonSatirSonu = false;
      }
    },
    /**
     * Dosya satır sonuyla BİTMEYEBİLİR. Son satırı saymamak, her feed'i
     * bir ürün eksik ölçmek olurdu -- küçük ama sistematik bir hata.
     */
    get toplam() { return toplam + (hicKarakter && !sonSatirSonu ? 1 : 0); },
    get acikTirnak() { return tirnakta; },
  };
}

/**
 * Tamponu TIRNAĞA SAYGIYLA satırlara böler; yarım satırı geri verir.
 *
 * ÖLÇÜLEN HATA: ilk sürüm `indexOf('\n')` ile bölüyordu. Ürün adındaki
 * satır sonu bir ürünü İKİ satır gösterdi ve örneklem bozuldu --
 * alınabilirlik oranı da onunla birlikte. Satır sayacı tırnağı zaten
 * takip ediyordu; ayırıcının etmemesi tutarsızlıktı.
 *
 * TIRNAK DURUMU PARÇALAR ARASI TAŞINMAZ, TAŞINMASINA GEREK YOK: `kalan`
 * her zaman YARIM BİR KAYDIN BAŞINDAN başlar ve bir kayıt tırnak dışında
 * başlar. Durumu taşımak, aynı öneki iki kez ve yanlış durumla taramak
 * olurdu.
 */
export function satirlariAyir(tampon) {
  const satirlar = [];
  let tirnakta = false;
  let bas = 0;
  for (let i = 0; i < tampon.length; i += 1) {
    const k = tampon[i];
    if (tirnakta) {
      if (k === '"') tirnakta = false;
      continue;
    }
    if (k === '"') { tirnakta = true; continue; }
    if (k === '\n') {
      satirlar.push(tampon.slice(bas, i).replace(/\r$/, ''));
      bas = i + 1;
    }
  }
  return { satirlar, kalan: tampon.slice(bas), tirnakta };
}

/** Tek bir CSV satırını alanlara böler (tırnak ve ikiye katlanmış tırnak dahil). */
export function satiriBol(satir) {
  const alanlar = [];
  let alan = '';
  let tirnakta = false;
  for (let i = 0; i < satir.length; i += 1) {
    const k = satir[i];
    if (tirnakta) {
      if (k === '"') {
        if (satir[i + 1] === '"') { alan += '"'; i += 1; }
        else tirnakta = false;
      } else alan += k;
      continue;
    }
    if (k === '"') { tirnakta = true; continue; }
    if (k === ',') { alanlar.push(alan); alan = ''; continue; }
    alan += k;
  }
  alanlar.push(alan);
  return alanlar;
}

/**
 * Bir satırın ALINABİLİR olup olmadığı.
 *
 * `packages/ingest` bir satırı ancak başlık, adres, pozitif fiyat ve para
 * birimi varsa ürün yapabiliyor. Yoklamanın "kaç ürün" cevabı, feed'in
 * bildirdiği toplam değil, BİZİM alabileceğimiz sayı olmalı: aradaki fark
 * bir kaynağı açıp açmamaya karar verdiriyor.
 */
export function alinabilirMi(kayit) {
  if (!kayit.product_name?.trim()) return false;
  if (!(kayit.merchant_deep_link?.trim() || kayit.aw_deep_link?.trim())) return false;
  if (!/^[A-Za-z]{3}$/.test(kayit.currency?.trim() ?? '')) return false;
  const fiyat = Number(String(kayit.search_price ?? '').replace(',', '.'));
  return Number.isFinite(fiyat) && fiyat > 0;
}

/**
 * Feed'i indirir ve ölçer. Ağ ve çözümleme dışında hiçbir yan etkisi yok.
 *
 * `ornekSiniri` kadar satırın ALANLARI okunur (reklamvereni öğrenmek
 * için); gerisi yalnızca sayılır. Alınabilirlik oranı da bu örnekten
 * gelir: 255 MB'lık bir dosyanın her satırını çözümlemek koşucunun
 * dakikalarını yer ve cevabı değiştirmez.
 */
export async function feediOlc(fid, anahtar, { dil = 'en', ornekSiniri = 2000, getir = fetch } = {}) {
  const cevap = await getir(feedAdresi(fid, dil, anahtar), {
    headers: { 'user-agent': process.env.OHAAAA_USER_AGENT ?? 'OhaaaaBot/1.0' },
  });

  /* Adres anahtarı İÇERİYOR; hata metnine koymuyoruz. */
  if (!cevap.ok) return { fid, durum: cevap.status, hata: `HTTP ${cevap.status}` };
  if (!cevap.body) return { fid, durum: cevap.status, hata: 'gövde boş' };

  const akis = Readable.fromWeb(cevap.body).pipe(createGunzip());

  /*
   * ÇOK BAYTLI HARF PARÇA SINIRINDA BÖLÜNEBİLİR.
   *
   * `buffer.toString('utf8')` yarım kalan bir harfi bozuk karakterle
   * değiştirir ve bir daha geri gelmez. Türkçe ve Lehçe feed'lerde ürün
   * adları bundan etkilenirdi. `StringDecoder` yarım baytı bir sonraki
   * parçaya taşır.
   */
  const cozucu = new StringDecoder('utf8');

  const sayac = satirSayaci();
  let bayt = 0;
  let artik = '';
  let baslik = null;
  let baslikVar = false;
  let ornek = 0;
  let alinabilir = 0;
  const paraBirimleri = new Map();
  const saticilar = new Map();
  let ilk = null;

  for await (const parca of akis) {
    const metin = cozucu.write(parca);
    bayt += parca.length;
    sayac.yut(metin);

    /* Örnek dolduysa artık yalnızca sayıyoruz: çözümleme boşa iş. */
    if (ornek >= ornekSiniri) continue;

    const ayrilan = satirlariAyir(artik + metin);
    artik = ayrilan.kalan;

    /*
     * KAPANMAYAN TIRNAK BELLEĞİ YER.
     *
     * Bozuk bir feed'de ilk satırın tırnağı hiç kapanmazsa `artik`
     * dosyanın tamamı kadar büyür ve koşucu düşer. Örneklem zaten birkaç
     * kilobaytlık kayıtlar için; bu sınırı aşan tampon çözümlenemez
     * sayılır ve yalnızca SAYMA sürer.
     */
    if (artik.length > TAMPON_SINIRI) { artik = ''; ornek = ornekSiniri; }

    for (const satir of ayrilan.satirlar) {
      if (ornek >= ornekSiniri) break;
      if (satir === '') continue;

      const alanlar = satiriBol(satir);

      /*
       * BAŞLIK VAR MI DİYE BAKILIR, VARSAYILMAZ.
       *
       * Awin kolon listesi verilen indirmelerde başlık basıyor ama bu
       * ayarlanabilir bir davranış. Başlık yokken ilk ÜRÜNÜ başlık sanmak
       * bütün alanları bir satır kaydırırdı -- ve ölçüm sessizce yanlış
       * çıkardı. İlk satırda beklenen kolon adı yoksa adres verdiğimiz
       * kolon sırasına düşülür.
       */
      if (baslik === null) {
        const temiz = alanlar.map((h) => h.trim());
        baslikVar = temiz.includes('product_name');
        baslik = baslikVar ? temiz : KOLONLAR.split(',');
        if (baslikVar) continue;
      }

      const kayit = {};
      baslik.forEach((ad, i) => { kayit[ad] = alanlar[i]; });
      ornek += 1;
      if (ilk === null) ilk = kayit;
      if (alinabilirMi(kayit)) alinabilir += 1;

      const pb = (kayit.currency ?? '').trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(pb)) paraBirimleri.set(pb, (paraBirimleri.get(pb) ?? 0) + 1);
      const mid = (kayit.merchant_id ?? '').trim();
      if (/^[0-9]{1,12}$/.test(mid)) saticilar.set(mid, (saticilar.get(mid) ?? 0) + 1);
    }
  }

  /*
   * SON SATIR SATIR SONUYLA BİTMEYEBİLİR.
   *
   * Sayaç bunu zaten hesaba katıyor; örneklem de katmalı, yoksa küçük bir
   * feed'in son ürünü hiç görülmez.
   */
  const kuyruk = artik + cozucu.end();
  if (ornek < ornekSiniri && kuyruk.trim() !== '' && baslik !== null) {
    const alanlar = satiriBol(kuyruk.replace(/\r$/, ''));
    const kayit = {};
    baslik.forEach((ad, i) => { kayit[ad] = alanlar[i]; });
    ornek += 1;
    if (ilk === null) ilk = kayit;
    if (alinabilirMi(kayit)) alinabilir += 1;
    const pbSon = (kayit.currency ?? '').trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(pbSon)) paraBirimleri.set(pbSon, (paraBirimleri.get(pbSon) ?? 0) + 1);
    const midSon = (kayit.merchant_id ?? '').trim();
    if (/^[0-9]{1,12}$/.test(midSon)) saticilar.set(midSon, (saticilar.get(midSon) ?? 0) + 1);
  }

  /* Başlık satırı ürün değil. */
  const urunSatiri = Math.max(0, sayac.toplam - (baslikVar ? 1 : 0));

  return {
    fid,
    durum: cevap.status,
    bayt,
    baslik,
    urunSatiri,
    ornek,
    alinabilirOran: ornek > 0 ? alinabilir / ornek : 0,
    /* Örnekten tahmin: tam sayım için dosyanın tamamını çözümlemek gerekirdi. */
    alinabilirTahmin: ornek > 0 ? Math.round(urunSatiri * (alinabilir / ornek)) : null,
    paraBirimleri: [...paraBirimleri.entries()].sort((a, b) => b[1] - a[1]),
    saticilar: [...saticilar.entries()].sort((a, b) => b[1] - a[1]),
    merchantName: (ilk?.merchant_name ?? '').trim() || null,
    dataFeedId: (ilk?.data_feed_id ?? '').trim() || null,
    ornekAdres: (ilk?.merchant_deep_link ?? ilk?.aw_deep_link ?? '').trim() || null,
  };
}

/**
 * Ölçümü `programs` + `program_feeds` tablolarına yazar.
 *
 * `application_state` DISCOVERED kalır: feed'i indirebilmek ticari onay
 * DEĞİL. `awin-feed-directory.mjs` ile aynı kural; bir programı yayına
 * yalnızca insan kararı alır.
 */
async function olcumuYaz(supabase, olcum) {
  const advId = olcum.saticilar[0]?.[0];
  if (!advId) throw new Error(`fid ${olcum.fid}: satırlarda merchant_id yok, yazılmadı.`);

  const simdi = new Date().toISOString();

  const { data: mevcut, error: okumaHatasi } = await supabase
    .from('programs')
    .select('id')
    .eq('network', 'awin')
    .eq('network_program_id', advId)
    .maybeSingle();
  if (okumaHatasi) throw new Error(`programs okunamadı: ${okumaHatasi.message}`);

  let programId = mevcut?.id;
  if (!programId) {
    const { data, error } = await supabase
      .from('programs')
      .insert({
        network: 'awin',
        network_program_id: advId,
        merchant_name: olcum.merchantName ?? `Awin ${advId}`,
        application_state: 'DISCOVERED',
        first_seen_at: simdi,
        last_verified_at: simdi,
      })
      .select('id')
      .single();
    if (error) throw new Error(`programs yazılamadı: ${error.message}`);
    programId = data.id;
  }

  /*
   * TEK PARA BİRİMİ YOKSA BOŞ BIRAKILIR.
   *
   * Karışık feed'de baskın olanı yazmak, azınlıktaki satırların fiyatını
   * yanlış para biriminde göstermek demek. Boş bırakmak kaynağı açmadan
   * önce insan kararı gerektirir -- istenen davranış bu.
   */
  const tekParaBirimi = olcum.paraBirimleri.length === 1 ? olcum.paraBirimleri[0][0] : null;

  const { error } = await supabase.from('program_feeds').upsert({
    program_id: programId,
    network: 'awin',
    network_feed_id: String(olcum.fid),
    feed_url: feedAdresi(olcum.fid),
    feed_access: 'verified',
    measured_item_count: olcum.urunSatiri,
    ingestable_count: olcum.alinabilirTahmin,
    measured_currency: tekParaBirimi,
    checked_at: simdi,
  }, { onConflict: 'network,network_feed_id', ignoreDuplicates: false });
  if (error) throw new Error(`program_feeds yazılamadı: ${error.message}`);

  return { advId, programId, tekParaBirimi };
}

async function main() {
  const anahtar = process.env.AWIN_DATAFEED_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const servisAnahtari = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fidler = String(process.env.AWIN_PROBE_FIDS ?? '')
    .split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  if (!anahtar) throw new Error('AWIN_DATAFEED_API_KEY tanımlı değil.');
  if (!supabaseUrl || !servisAnahtari) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tanımlı değil.');
  }
  if (fidler.length === 0) throw new Error('AWIN_PROBE_FIDS boş.');
  if (fidler.some((f) => !/^[0-9]{1,12}$/.test(f))) {
    throw new Error('AWIN_PROBE_FIDS yalnızca sayısal feed ID içerebilir (F öneki UI adresine ait, API\'ye değil).');
  }

  const dil = (process.env.AWIN_PROBE_LANG ?? 'en').toLowerCase();
  const supabase = createClient(supabaseUrl, servisAnahtari, { auth: { persistSession: false } });

  let basarili = 0;
  for (const fid of fidler) {
    console.log(`\n--- fid ${fid} (language/${dil}) ---`);
    let olcum;
    try {
      olcum = await feediOlc(fid, anahtar, { dil });
    } catch (hata) {
      console.log(`  HATA: ${hata instanceof Error ? hata.message : String(hata)}`);
      continue;
    }

    if (olcum.hata) { console.log(`  ${olcum.hata}`); continue; }

    /* SAYILAR günlüğe, İSİMLER veritabanına. */
    console.log(`  HTTP ${olcum.durum}, ${(olcum.bayt / 1048576).toFixed(1)} MB açılmış`);
    console.log(`  ürün satırı      : ${olcum.urunSatiri}`);
    console.log(`  örneklenen satır : ${olcum.ornek}`);
    console.log(`  alınabilir oran  : %${(olcum.alinabilirOran * 100).toFixed(1)}`);
    console.log(`  para birimi sayısı: ${olcum.paraBirimleri.length}`);
    console.log(`  reklamveren sayısı: ${olcum.saticilar.length}`);

    if (olcum.urunSatiri === 0) { console.log('  boş feed, yazılmadı.'); continue; }
    if (olcum.saticilar.length > 1) {
      /*
       * `sources.merchant_id` TEK mağaza. Birleşik bir feed'i tek kaynak
       * yapmak bütün ürünleri yanlış mağazaya bağlardı.
       */
      console.log('  UYARI: feed birden fazla reklamveren taşıyor; kaynak olarak açılamaz.');
    }

    const yazim = await olcumuYaz(supabase, olcum);
    console.log(`  yazıldı: program ${yazim.advId}, para birimi ${yazim.tekParaBirimi ?? '(karışık, boş bırakıldı)'}`);
    basarili += 1;
  }

  console.log(`\nYoklanan: ${fidler.length}, yazılan: ${basarili}.`);
  console.log('Ayrıntı veritabanında; günlüğe yalnızca sayılar yazıldı.');
}

const dogrudanCalisiyor =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (dogrudanCalisiyor) {
  main().catch((hata) => {
    console.error(hata instanceof Error ? hata.message : String(hata));
    process.exitCode = 1;
  });
}
