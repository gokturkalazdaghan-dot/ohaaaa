#!/usr/bin/env node
/**
 * AWIN FEED DİZİNİ — numaraları isimlere çevirir.
 *
 * ÇÖZDÜĞÜ SORUN
 * Elimizde 344 Awin `fid` vardı ve hiçbirinin hangi mağaza olduğu belli
 * değildi. `sources` kurmak için mağaza adı, ülkesi ve para birimi şart;
 * numaradan kaynak açılmaz. Bilgi Awin'in liste uç noktasında duruyor ama
 * o uç nokta `AWIN_DATAFEED_API_KEY` istiyor ve o anahtar bir GitHub
 * Actions gizlisi -- API ile OKUNAMAZ (tasarımı öyle).
 *
 * Çözüm anahtarı okumak değil, anahtarı GÖREBİLEN yerde çalışmak. Bu
 * betik alım işinin içinde koşar, listeyi çeker ve sonucu doğrudan
 * veritabanına yazar.
 *
 * ---------------------------------------------------------------------------
 * NEDEN LOG'A DEĞİL VERİTABANINA
 * ---------------------------------------------------------------------------
 * Depo PUBLIC. İş günlüğü ve artifact'ler herkese açık. 344 ortağın adını,
 * ülkesini ve ürün sayısını oraya basmak, ticari envanteri yayınlamak
 * olurdu. Günlüğe yalnızca SAYILAR düşer; satırlar `programs` ve
 * `program_feeds` tablolarına gider.
 *
 * Tek istisna: BAŞLIK SATIRI günlüğe yazılır. O yalnızca kolon adlarıdır,
 * veri değil -- ve eşleme tutmazsa tek turda düzeltebilmenin başka yolu
 * yok.
 *
 * ---------------------------------------------------------------------------
 * NEDEN İKİ TABLOYA
 * ---------------------------------------------------------------------------
 * `program_feeds.program_id` NOT NULL ve `programs`e bağlı. Listedeki
 * reklamverenlerin çoğu `programs` içinde YOK (50 satır var, 344 feed
 * geliyor). Bu yüzden önce reklamveren `programs`e `DISCOVERED` olarak
 * yazılır -- depoda zaten kurulu desen, `awin_directory_refresh_*`
 * göçleri aynısını yapıyor -- sonra feed ona bağlanır.
 *
 * `DISCOVERED` bilerek: teknik erişim ticari onay demek DEĞİL. Hiçbir
 * program bu betikle yayına alınmaz, yalnızca GÖRÜNÜR olur.
 *
 * ---------------------------------------------------------------------------
 * HİÇBİR ŞEY SİLİNMEZ
 * ---------------------------------------------------------------------------
 * Yalnızca ekler ve günceller. Listede görünmeyen bir program "kapandı"
 * demek değil; döküm filtreli çekilmiş olabilir. Yokluğu kanıt saymak,
 * çalışan bir programı sessizce kaybetmek olurdu (aynı gerekçe
 * `awin_directory_refresh_4` göçünde de yazılı).
 */

import { createClient } from '@supabase/supabase-js';

const LISTE_ADRESI = 'https://productdata.awin.com/datafeed/list/apikey/';

/** Awin'in liste çıktısında beklenen kolonlar -- adları değişebilir. */
const ESLEME = {
  feedId: ['feed id', 'feedid', 'data_feed_id', 'datafeedid', 'feed_id'],
  advertiserId: ['advertiser id', 'advertiserid', 'merchant id', 'merchant_id'],
  advertiserName: ['advertiser name', 'advertisername', 'merchant name', 'merchant_name'],
  feedName: ['feed name', 'feedname'],
  region: ['region', 'primary region', 'country'],
  language: ['language', 'languages'],
  itemCount: ['no of products', 'number of products', 'products', 'no_of_products'],
  imported: ['last imported', 'last checked', 'lastimported'],
  membership: ['membership status', 'membership', 'status', 'join status'],
  url: ['url', 'feed url', 'download url'],
};

/**
 * Küçük ama DOĞRU bir CSV çözümleyici.
 *
 * `split(',')` yeterli değil: reklamveren adlarında virgül ve tırnak
 * bulunuyor ("Smith, Jones & Co."). Yanlış bölünen bir satır kolonları
 * kaydırır ve feed ID'si ürün sayısı sanılır -- sessiz ve zehirli.
 */
function csvAyristir(metin) {
  const satirlar = [];
  let alan = '';
  let satir = [];
  let tirnakta = false;

  for (let i = 0; i < metin.length; i += 1) {
    const k = metin[i];

    if (tirnakta) {
      if (k === '"') {
        if (metin[i + 1] === '"') { alan += '"'; i += 1; }
        else tirnakta = false;
      } else alan += k;
      continue;
    }

    if (k === '"') { tirnakta = true; continue; }
    if (k === ',') { satir.push(alan); alan = ''; continue; }
    if (k === '\n' || k === '\r') {
      if (k === '\r' && metin[i + 1] === '\n') i += 1;
      satir.push(alan);
      if (satir.some((h) => h !== '')) satirlar.push(satir);
      satir = []; alan = '';
      continue;
    }
    alan += k;
  }

  satir.push(alan);
  if (satir.some((h) => h !== '')) satirlar.push(satir);
  return satirlar;
}

/** Başlık adlarını beklenen alanlara bağlar; bulunamayan `-1` kalır. */
function kolonlariCoz(baslik) {
  const normal = baslik.map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
  const sonuc = {};
  for (const [ad, adaylar] of Object.entries(ESLEME)) {
    sonuc[ad] = normal.findIndex((h) => adaylar.includes(h));
  }
  return sonuc;
}

/**
 * `programs.country_code` char(2). Awin bölge alanı "GB" de dönebiliyor
 * "Worldwide" da; ikincisini iki harfe KIRPMAK "WO" gibi var olmayan bir
 * ülke üretirdi. Tam iki harf değilse null.
 */
function bolgeKodu(deger) {
  const d = String(deger ?? '').trim();
  return /^[A-Za-z]{2}$/.test(d) ? d.toUpperCase() : null;
}

/**
 * Feed adresinden API ANAHTARINI SÖKER.
 *
 * Awin liste çıktısındaki `URL` kolonu indirmeye hazır adresi verir --
 * ve adresin içinde anahtar durur. Veritabanı bunu zaten reddediyor:
 * `program_feeds_url_no_secret` ve `..._url_placeholder` kısıtları tam da
 * bu kazayı engellemek için yazılmış. Depodaki desen anahtarı yer
 * tutucuyla saklamak; gerçek değer yalnızca çalışma anında ortamdan gelir.
 *
 * Sökme BAŞARISIZSA adres HİÇ saklanmaz. Yarım temizlenmiş bir adresi
 * "herhalde tamamdır" diye yazmak, sırrı veritabanına sızdırmanın en
 * sessiz yoludur.
 */
function adresiTemizle(adres) {
  const d = String(adres ?? '').trim();
  if (!d.startsWith('https://')) return null;

  const temiz = d.replace(/\/apikey\/[^/]+/, '/apikey/${AWIN_DATAFEED_API_KEY}');

  /* Kısıtların ikisini de BURADA da uyguluyoruz: veritabanına güvenip
     göndermek, hatayı en geç yerde görmek olurdu. */
  if (/\/apikey\/(?!\$\{)/.test(temiz)) return null;
  if (/[0-9a-f]{24,}/.test(temiz)) return null;
  return temiz;
}

function sayi(deger) {
  const n = Number(String(deger ?? '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const anahtar = process.env.AWIN_DATAFEED_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const servisAnahtari = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!anahtar) throw new Error('AWIN_DATAFEED_API_KEY tanımlı değil.');
  if (!supabaseUrl || !servisAnahtari) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tanımlı değil.');
  }

  console.log('Awin feed listesi çekiliyor…');
  const cevap = await fetch(LISTE_ADRESI + anahtar, {
    headers: { 'user-agent': process.env.OHAAAA_USER_AGENT ?? 'OhaaaaBot/1.0' },
  });

  if (!cevap.ok) {
    /* Adres anahtarı İÇERİYOR; hata metnine koymuyoruz. */
    throw new Error(`Awin liste uç noktası HTTP ${cevap.status} döndü.`);
  }

  const metin = await cevap.text();
  const satirlar = csvAyristir(metin);
  if (satirlar.length < 2) throw new Error('Liste boş ya da beklenmedik biçimde.');

  const baslik = satirlar[0];
  /* Kolon ADLARI veri değil; eşleme tutmazsa tek bakışta görülsün. */
  console.log('Başlık:', baslik.join(' | '));

  const k = kolonlariCoz(baslik);
  if (k.feedId < 0 || k.advertiserId < 0) {
    throw new Error(
      'Feed ID ya da reklamveren ID kolonu bulunamadı. Yukarıdaki başlığa ' +
      'göre ESLEME tablosu güncellenmeli.',
    );
  }

  const al = (satir, idx) => (idx >= 0 ? (satir[idx] ?? '').trim() : '');

  const kayitlar = [];
  for (const satir of satirlar.slice(1)) {
    const feedId = al(satir, k.feedId);
    const advId = al(satir, k.advertiserId);
    if (!feedId || !advId) continue;
    kayitlar.push({
      feedId,
      advId,
      advName: al(satir, k.advertiserName) || `Awin ${advId}`,
      feedName: al(satir, k.feedName) || null,
      region: bolgeKodu(al(satir, k.region)),
      language: (al(satir, k.language) || '').toLowerCase().slice(0, 8) || null,
      itemCount: sayi(al(satir, k.itemCount)),
      membership: al(satir, k.membership) || null,
      url: adresiTemizle(al(satir, k.url)),
      imported: al(satir, k.imported) || null,
    });
  }

  console.log(`Okunan feed satırı: ${kayitlar.length}`);
  if (kayitlar.length === 0) throw new Error('Hiç feed satırı çözülemedi.');

  const supabase = createClient(supabaseUrl, servisAnahtari, {
    auth: { persistSession: false },
  });

  /* --- 1) Reklamverenler ------------------------------------------------ */
  /*
   * TEK BİR ZAMAN DAMGASI.
   *
   * İlk koşu `programs_first_seen_before_verified` kısıtıyla düştü:
   * `last_verified_at` JS'te hesaplanmıştı, `first_seen_at` ise sunucuda
   * `now()` varsayılanıyla doluyordu -- yani SONRAKİ bir an. Kısıt
   * `last_verified_at >= first_seen_at` istiyor ve aradaki milisaniyeler
   * bunu bozuyordu. İkisi de aynı değeri alınca sorun ortadan kalkıyor.
   */
  const simdi = new Date().toISOString();

  const reklamverenler = new Map();
  for (const r of kayitlar) {
    if (!reklamverenler.has(r.advId)) {
      reklamverenler.set(r.advId, {
        network: 'awin',
        network_program_id: r.advId,
        merchant_name: r.advName,
        country_code: r.region,
        network_status: r.membership,
        /* Teknik erişim ticari onay DEĞİL: hiçbir program yayına alınmaz. */
        application_state: 'DISCOVERED',
        first_seen_at: simdi,
        last_verified_at: simdi,
      });
    }
  }

  /*
   * MEVCUT SATIRLAR EZİLMEZ.
   *
   * `upsert` verilen BÜTÜN kolonları yazar. Liste bir reklamverenin
   * ülkesini boş döndürseydi, o satırın `country_code`'u null'a düşerdi --
   * ölçülmüş bir değeri okunamamış bir değerle ezmek. Aynısı
   * `merchant_name`, `application_state` ve elle girilmiş her alan için
   * geçerli.
   *
   * Bu yüzden önce hangi reklamverenlerin ZATEN kayıtlı olduğu okunuyor
   * ve yalnızca YENİLERİ ekleniyor. Bilinenlerin program satırına hiç
   * dokunulmuyor; onlar için yeni bilgi zaten `program_feeds`e gidiyor.
   */
  const tumAdvId = [...reklamverenler.keys()];
  const mevcut = new Set();
  for (let i = 0; i < tumAdvId.length; i += 500) {
    const { data, error } = await supabase
      .from('programs')
      .select('network_program_id')
      .eq('network', 'awin')
      .in('network_program_id', tumAdvId.slice(i, i + 500));
    if (error) throw new Error(`programs okunamadı: ${error.message}`);
    for (const satir of data ?? []) mevcut.add(String(satir.network_program_id));
  }

  const yeniler = tumAdvId
    .filter((id) => !mevcut.has(id))
    .map((id) => reklamverenler.get(id));

  if (yeniler.length > 0) {
    for (let i = 0; i < yeniler.length; i += 500) {
      const { error } = await supabase.from('programs').insert(yeniler.slice(i, i + 500));
      if (error) throw new Error(`programs yazılamadı: ${error.message}`);
    }
  }
  console.log(
    `Reklamveren: ${tumAdvId.length} listede, ${mevcut.size} zaten kayıtlı, ` +
    `${yeniler.length} yeni eklendi (mevcutlara dokunulmadı)`,
  );

  /* --- 2) Kimlikleri geri oku ------------------------------------------- */
  const kimlikler = new Map();
  for (let i = 0; i < tumAdvId.length; i += 500) {
    const parca = tumAdvId.slice(i, i + 500);
    const { data, error } = await supabase
      .from('programs')
      .select('id, network_program_id')
      .eq('network', 'awin')
      .in('network_program_id', parca);
    if (error) throw new Error(`programs okunamadı: ${error.message}`);
    for (const satir of data ?? []) kimlikler.set(String(satir.network_program_id), satir.id);
  }

  /* --- 3) Feed'ler ------------------------------------------------------- */
  const feedler = kayitlar
    .filter((r) => kimlikler.has(r.advId))
    .map((r) => ({
      program_id: kimlikler.get(r.advId),
      network: 'awin',
      network_feed_id: r.feedId,
      feed_name: r.feedName,
      region: r.region,
      language: r.language,
      network_item_count: r.itemCount,
      feed_url: r.url,
      /*
       * `checked_at` YAZILMIYOR. `program_feeds_measure_needs_time` kısıtı
       * onu ölçüm alanlarına bağlıyor: `checked_at` dolu ama
       * `ingestable_count`/`measured_item_count` boşsa satır reddedilir --
       * ve haklı olarak. `checked_at` "biz feed'i indirip saydık" demek;
       * burada yaptığımız yalnızca dizini okumak.
       *
       * Awin'in bildirdiği tarih `last_imported_at`e gidiyor: o bizim
       * ölçümümüz değil, ağın beyanı.
       */
      last_imported_at: r.imported ? (Number.isNaN(Date.parse(r.imported))
        ? null : new Date(r.imported).toISOString()) : null,
    }));

  let yazilan = 0;
  for (let i = 0; i < feedler.length; i += 500) {
    const parca = feedler.slice(i, i + 500);
    const { error } = await supabase
      .from('program_feeds')
      .upsert(parca, { onConflict: 'network,network_feed_id', ignoreDuplicates: false });
    if (error) throw new Error(`program_feeds yazılamadı: ${error.message}`);
    yazilan += parca.length;
  }

  console.log(`Feed (program_feeds) yazıldı: ${yazilan}`);
  console.log('Bitti. Ayrıntı veritabanında; günlüğe yalnızca sayılar yazıldı.');
}

/*
 * Yardımcılar dışa AÇIK: çözümleyici test edilebilir olmalı. Bir CSV
 * çözümleyicisinin sessiz hatası (tırnaklı virgülde kolon kayması) üretim
 * verisini bozar ve fark edilmesi günler sürer.
 *
 * `main` yalnızca dosya DOĞRUDAN çalıştırıldığında koşar; içe aktaran bir
 * test, ağa çıkmaz ve veritabanına yazmaz.
 */
export { csvAyristir, kolonlariCoz, sayi, bolgeKodu, adresiTemizle, ESLEME };

const dogrudanCalisiyor =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (dogrudanCalisiyor) {
  main().catch((hata) => {
    console.error(hata instanceof Error ? hata.message : String(hata));
    process.exitCode = 1;
  });
}
