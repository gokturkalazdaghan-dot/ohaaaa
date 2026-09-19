/**
 * AWIN FEED LİSTESİ: EKSİK OLAN TEK VERİ.
 *
 * Ölçüm (üretim): 50 programın 41'i `feed_available = true` diyor ama
 * YALNIZCA 3'ünde feed kimliği var. Kalan 38 program teknik olarak
 * kullanılamıyor -- feed adresi `fid` olmadan kurulamaz. AliExpress PL
 * (advertiser 12044) bunlardan biri.
 *
 * Bu veriyi dizin (directory) CSV'si TAŞIMIYOR: orada `feedEnabled`,
 * `commissionMin`, `cookieLength` var ama ne feed kimliği ne de KATILIM
 * DURUMU. Bu yüzden `programs.application_state` bugün her satırda
 * 'DISCOVERED' -- bu bizim içe aktarma varsayılanımız, ağdan gelen bir
 * onay bilgisi değil.
 *
 * Awin'in feed liste ucu ikisini birden veriyor: `fid` VE üyelik durumu.
 * Üstelik ürün sayısını da veriyor -- yani hangi feed'in 500 MB'lik
 * sınıra sığacağını İNDİRMEDEN önce öğreniyoruz.
 *
 * ---------------------------------------------------------------------------
 * ANAHTAR BU DOSYADA YOK
 * ---------------------------------------------------------------------------
 * Adres bir YER TUTUCU taşır. Gerçek değer yalnızca çalışma anında
 * ortamdan gelir (`expandSecretPlaceholders`) ve aynı anda maskeleme
 * defterine yazılır.
 *
 * Awin anahtarı sorgu dizisinde DEĞİL, YOLDA duruyor (`/apikey/<deger>/`).
 * `maskUrl` yalnızca sorgu değerlerini maskeler -- yoldaki anahtarı
 * temizleyen şey `registerSecret` ile kurulan birebir değer silmesidir.
 * Bu yüzden adres HER ZAMAN `expandSecretPlaceholders`'tan geçirilir;
 * elle birleştirilmez.
 */

import { parseCsv } from './adapters/csv.js';
import { IngestError } from './errors.js';

/**
 * Feed liste ucu. `${...}` yer tutucusu kasıtlı: bu sabit hiçbir zaman
 * gerçek bir anahtar taşımaz ve depoya anahtarsız girer.
 */
export const AWIN_FEED_LISTESI_ADRESI =
  'https://productdata.awin.com/datafeed/list/apikey/${AWIN_DATAFEED_API_KEY}/';

/** Bir feed satırı -- yalnızca bizim kullandığımız alanlar. */
export interface AwinFeedKaydi {
  advertiserId: string;
  advertiserName: string;
  feedId: string;
  feedName: string | null;
  region: string | null;
  language: string | null;
  /** Awin'in bildirdiği ürün sayısı. Bilinmiyorsa null -- 0 İLE AYNI ŞEY DEĞİL. */
  itemCount: number | null;
  /**
   * ÜYELİK DURUMU -- bu ucun asıl değeri.
   * Awin'in kendi metni birebir korunur ('joined', 'pending', ...):
   * kendi sözlüğümüze çevirmek, ağın söylediğini yorumlamak olurdu.
   */
  membershipStatus: string | null;
}

/*
 * Kolon adları SIRAYA GÖRE DEĞİL, ADA GÖRE okunuyor: Awin kolon sırasını
 * değiştirirse sıraya dayanan bir ayrıştırıcı sessizce YANLIŞ veri yazardı
 * (advertiser adını feed adı sanmak gibi) -- ve bu, fark edilmesi en zor
 * hata türüdür.
 *
 * Her alan için birden çok kabul edilen ad var çünkü Awin bu başlıkları
 * zaman içinde değiştirdi. Eşleştirme küçük harfe indirip harf/rakam dışını
 * atarak yapılır: "No of products" = "no_of_products" = "noofproducts".
 */
const ESLESMELER = {
  advertiserId: ['advertiserid', 'advertiser', 'merchantid'],
  advertiserName: ['advertisername', 'merchantname'],
  feedId: ['feedid', 'datafeedid', 'fid'],
  feedName: ['feedname'],
  region: ['primaryregion', 'region'],
  language: ['language', 'lang'],
  itemCount: ['noofproducts', 'numberofproducts', 'productcount', 'products'],
  membershipStatus: ['membershipstatus', 'membership', 'status', 'relationship'],
} as const satisfies Record<string, readonly string[]>;

/** ZORUNLU alanlar: bunlarsız satır işimize yaramaz. */
const ZORUNLU = ['advertiserId', 'advertiserName', 'feedId'] as const;

function anahtarlaStr(ham: string): string {
  return ham.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Feed listesi CSV'sini ayrıştırır.
 *
 * BAŞLIK TANINMAZSA SESSİZ GEÇMEZ. Awin başlıkları değiştirirse hata
 * mesajı GERÇEK BAŞLIĞI yazar -- böylece eşleştirme tablosu tahminle
 * değil, elimizdeki dosyayla güncellenir.
 */
export function parseAwinFeedListesi(icerik: string): {
  kayitlar: AwinFeedKaydi[];
  uyarilar: string[];
} {
  const { records, warnings } = parseCsv(icerik);
  const uyarilar = [...warnings];

  if (records.length === 0) {
    throw new IngestError(
      'CONFIG_ERROR',
      'Awin feed listesi boş döndü: anahtar geçerli ama hesapta feed yok ya da ' +
        'uç beklenenden farklı bir yanıt verdi.',
      true,
    );
  }

  // Başlıkları bir kez çözüp bütün satırlarda kullanıyoruz.
  const basliklar = Object.keys(records[0]!);
  const sutun: Partial<Record<keyof typeof ESLESMELER, string>> = {};

  for (const [alan, adaylar] of Object.entries(ESLESMELER) as [
    keyof typeof ESLESMELER,
    readonly string[],
  ][]) {
    const bulunan = basliklar.find((b) => adaylar.includes(anahtarlaStr(b)));
    if (bulunan) sutun[alan] = bulunan;
  }

  const eksik = ZORUNLU.filter((alan) => !sutun[alan]);
  if (eksik.length > 0) {
    throw new IngestError(
      'CONFIG_ERROR',
      `Awin feed listesinde zorunlu kolon(lar) bulunamadi: ${eksik.join(', ')}. ` +
        `Gelen baslik: ${basliklar.join(' | ')}. ` +
        'Kolon adlari ada gore okunuyor; Awin basligi degistirdiyse ' +
        'awinFeedList.ts icindeki ESLESMELER tablosuna GERCEK basligi ekleyin.',
      true,
    );
  }

  if (!sutun.membershipStatus) {
    /*
     * Ölümcül değil ama kaydediliyor: üyelik durumu bu ucun asıl sebebi.
     * Yoksa `application_state` yine varsayılanda kalır ve bunu bilmeliyiz.
     */
    uyarilar.push(
      'Uyelik durumu kolonu yok: katilim bilgisi yazilamayacak, ' +
        'programlar DISCOVERED kalacak.',
    );
  }

  const kayitlar: AwinFeedKaydi[] = [];

  for (let i = 0; i < records.length; i += 1) {
    const r = records[i]!;
    const al = (alan: keyof typeof ESLESMELER): string | null => {
      const ad = sutun[alan];
      if (!ad) return null;
      const deger = r[ad];
      if (typeof deger !== 'string') return null;
      const kirpik = deger.trim();
      return kirpik.length > 0 ? kirpik : null;
    };

    const advertiserId = al('advertiserId');
    const advertiserName = al('advertiserName');
    const feedId = al('feedId');

    if (!advertiserId || !advertiserName || !feedId) {
      uyarilar.push(`Satir ${i + 2}: zorunlu alan bos -- atlandi.`);
      continue;
    }

    /*
     * Kimlikler RAKAM OLMALI. `merchants_advertiser_id_numeric` kısıtı da
     * bunu zorluyor; burada erken düşmek, kısıt hatasını alım sırasında
     * değil ayrıştırma sırasında görmek demek.
     *
     * document.json'daki hata tam da buydu: `F3951` gibi harf önekli
     * kimlikler Awin tarafından reddedildi.
     */
    if (!/^[0-9]{1,12}$/.test(advertiserId) || !/^[0-9]{1,12}$/.test(feedId)) {
      uyarilar.push(
        `Satir ${i + 2}: kimlik rakam disi (advertiser=${advertiserId}, ` +
          `feed=${feedId}) -- atlandi.`,
      );
      continue;
    }

    kayitlar.push({
      advertiserId,
      advertiserName,
      feedId,
      feedName: al('feedName'),
      region: al('region'),
      language: al('language'),
      itemCount: sayiyaCevir(al('itemCount')),
      membershipStatus: al('membershipStatus'),
    });
  }

  return { kayitlar, uyarilar };
}

/**
 * "116,417" / "116417" -> 116417. Çözülemeyen değer null döner --
 * SIFIR DEĞİL: sıfır "feed boş" demektir, null "bilmiyoruz" demektir ve
 * ikisi farklı karar ürettirir.
 */
function sayiyaCevir(ham: string | null): number | null {
  if (ham === null) return null;
  const temiz = ham.replace(/[\s,._]/g, '');
  if (!/^[0-9]+$/.test(temiz)) return null;
  const sayi = Number.parseInt(temiz, 10);
  return Number.isSafeInteger(sayi) ? sayi : null;
}
