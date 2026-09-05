/**
 * ADRES KAPISI — bir feed adresine gitmeden ÖNCE sorulan tek soru:
 * bu adres gerçekten dışarıyı mı gösteriyor?
 *
 * NEDEN VAR
 *
 * Feed adreslerini operatör giriyor (`sources.endpoint_url`) ve alım hattı
 * onu sorgusuz çekiyordu. Yani şu adresler de çekilebilirdi:
 *
 *   http://169.254.169.254/latest/meta-data/iam/security-credentials/
 *   http://127.0.0.1:5432/
 *   http://10.0.0.5/admin
 *   file:///etc/passwd
 *
 * Birincisi bulut sağlayıcının kimlik uçtur: yanıtı `ingest_runs.error`
 * ya da ayrıştırıcı hatası olarak dışarı sızabilirdi. Bu, SSRF'nin ders
 * kitabı hâlidir ve tek satırlık bir yapılandırma hatasıyla tetiklenir.
 *
 * NEYİ KORUR, NEYİ KORUMAZ (dürüst sınır)
 *
 * Bu kapı adı ÇÖZER ve çıkan IP'leri denetler. Yerleşik `fetch` soketi
 * belirli bir IP'ye sabitlemeye izin vermediği için, çözümle bağlantı
 * arasında teorik bir DNS yeniden bağlama (rebinding) penceresi kalır.
 * Bunu kapatmak `undici` dispatcher bağımlılığı gerektirir; hattın tehdit
 * modelinde saldırgan adresi SEÇEN taraf değil (adresi operatör giriyor),
 * bu yüzden pencere kabul ediliyor ve BURADA YAZILI olarak duruyor --
 * sessizce göz ardı edilmiyor.
 *
 * Kapı YÖNLENDİRMELERE DE uygulanır; `politeClient` her adımda tekrar
 * çağırır. İlk adresin güvenli olması hedefin güvenli olduğunu göstermez:
 * güvenli bir alan adı 302 ile 169.254.169.254'e yollayabilir.
 */

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import { IngestError } from '../errors.js';
import { maskUrl } from './redact.js';

/**
 * Güvenli olmayan adres.
 *
 * `IngestError`'dan türer, böylece `classifyIngestError` onu tahmin etmeye
 * çalışmaz: sınıfı (SECURITY_ERROR) ve kalıcılığı zaten üzerinde taşır.
 *
 * KALICI olması bir tercih değil zorunluluk: bir SSRF denemesini yeniden
 * denemek sonucu değiştirmez, yalnızca kayıtları kirletir ve kuyruğu
 * meşgul eder.
 */
export class UnsafeUrlError extends IngestError {
  constructor(
    readonly reason: string,
    readonly url: string,
  ) {
    // Adres MASKELENEREK mesaja girer: bu metin `ingest_runs.error` ve
    // `sources.last_error` sütunlarına yazılıyor ve sorgu dizesinde jeton
    // taşıyan bir feed adresi maskesiz yazılsaydı jetonu üç yere kopyalardı.
    super('SECURITY_ERROR', `Güvenli olmayan adres (${reason}): ${maskUrl(url)}`, true);
    this.name = 'UnsafeUrlError';
  }
}

/** Yönlendirme zinciri fazla uzun. */
export class TooManyRedirectsError extends IngestError {
  constructor(
    readonly url: string,
    readonly limit: number,
  ) {
    super(
      'SECURITY_ERROR',
      `Yönlendirme sınırı aşıldı (${limit}): ${maskUrl(url)}`,
      true,
    );
    this.name = 'TooManyRedirectsError';
  }
}

/** Gövde izin verilenden büyük. */
export class ResponseTooLargeError extends IngestError {
  constructor(
    readonly url: string,
    readonly limitBytes: number,
  ) {
    super(
      'SECURITY_ERROR',
      `Yanıt gövdesi sınırı aşıldı (${limitBytes} bayt): ${maskUrl(url)}`,
      true,
    );
    this.name = 'ResponseTooLargeError';
  }
}

/** Yalnızca bu iki şema dışarıya çıkar. */
const IZINLI_SEMALAR = new Set(['http:', 'https:']);

/**
 * Adı ne olursa olsun reddedilen ana makineler.
 *
 * `metadata.google.internal` çoğu ortamda link-local bir adrese çözülür ve
 * IP denetimine zaten takılır; ama çözülemediği ya da başka bir adrese
 * yönlendirildiği durumlar için adı da kapatmak ucuz bir ikinci katman.
 */
const YASAK_ADLAR = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

/** Adres çözücü. Testler gerçek DNS'e çıkmasın diye dışarıdan verilebilir. */
export type HostResolver = (hostname: string) => Promise<string[]>;

/** Varsayılan çözücü: işletim sisteminin çözümleyicisi, tüm adresler. */
export const defaultResolver: HostResolver = async (hostname) => {
  const sonuclar = await lookup(hostname, { all: true });
  return sonuclar.map((s) => s.address);
};

/**
 * IPv4'ü 32-bit tam sayıya çevirir. Geçersizse null.
 * `isIP` zaten biçimi doğruladığı için burada yeniden doğrulama yapılmaz.
 */
function ipv4Sayi(adres: string): number | null {
  const parcalar = adres.split('.');
  if (parcalar.length !== 4) return null;

  let sonuc = 0;
  for (const parca of parcalar) {
    const n = Number(parca);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    sonuc = sonuc * 256 + n;
  }
  return sonuc;
}

/**
 * Dışarıya çıkmayan IPv4 blokları.
 *
 * Liste KASITLI olarak geniş: yanlış alarmın maliyeti bir yapılandırma
 * notu, kaçırmanın maliyeti kimlik sızıntısı. Belgelenmiş her özel amaçlı
 * blok kapalı (RFC 6890), yalnızca "genel internet" açık.
 */
const IPV4_YASAK: ReadonlyArray<readonly [string, number, string]> = [
  ['0.0.0.0', 8, 'bu ağ'],
  ['10.0.0.0', 8, 'özel ağ'],
  ['100.64.0.0', 10, 'operatör NAT (CGNAT)'],
  ['127.0.0.0', 8, 'geri döngü (loopback)'],
  ['169.254.0.0', 16, 'link-local / bulut metadata'],
  ['172.16.0.0', 12, 'özel ağ'],
  ['192.0.0.0', 24, 'IETF protokol tahsisi'],
  ['192.0.2.0', 24, 'belgeleme (TEST-NET-1)'],
  ['192.168.0.0', 16, 'özel ağ'],
  ['198.18.0.0', 15, 'kıyaslama (benchmark)'],
  ['198.51.100.0', 24, 'belgeleme (TEST-NET-2)'],
  ['203.0.113.0', 24, 'belgeleme (TEST-NET-3)'],
  ['224.0.0.0', 4, 'çoklu yayın (multicast)'],
  ['240.0.0.0', 4, 'ayrılmış'],
];

function ipv4Yasakli(adres: string): string | null {
  const deger = ipv4Sayi(adres);
  if (deger === null) return 'ayrıştırılamayan IPv4';

  for (const [taban, bit, sebep] of IPV4_YASAK) {
    const tabanDeger = ipv4Sayi(taban);
    if (tabanDeger === null) continue;
    // `>>> 0` şart: 32-bit kaydırma JavaScript'te işaretli sonuç verir ve
    // 224.0.0.0 gibi yüksek bloklar negatife düşerek eşleşmeyi kaçırırdı.
    const maske = bit === 0 ? 0 : (0xffffffff << (32 - bit)) >>> 0;
    if ((deger & maske) >>> 0 === (tabanDeger & maske) >>> 0) return sebep;
  }
  return null;
}

/**
 * IPv6 denetimi.
 *
 * IPv4 GÖMÜLÜ BİÇİMLER AYRICA ÇÖZÜLÜR. `::ffff:169.254.169.254` bir IPv6
 * adresidir ama gerçekte link-local IPv4'e gider; yalnızca IPv6 önekelerine
 * bakan bir denetim onu geçirirdi -- kapıyı tamamen anlamsız kılan türden
 * bir kaçak.
 */
function ipv6Yasakli(ham: string): string | null {
  const adres = ham.toLowerCase().split('%')[0]!; // %eth0 gibi bölge ekini at

  const gomulu = ipv4Gomulu(adres);
  if (gomulu !== null) {
    const sebep = ipv4Yasakli(gomulu);
    return sebep === null ? null : `IPv6 içinde gömülü IPv4 — ${sebep}`;
  }

  if (adres === '::' ) return 'belirtilmemiş adres';
  if (adres === '::1') return 'geri döngü (loopback)';

  const ilkGrup = Number.parseInt(adres.split(':')[0] || '0', 16);
  if (Number.isNaN(ilkGrup)) return 'ayrıştırılamayan IPv6';

  // fc00::/7 — benzersiz yerel adres
  if ((ilkGrup & 0xfe00) === 0xfc00) return 'benzersiz yerel adres';
  // fe80::/10 — link-local
  if ((ilkGrup & 0xffc0) === 0xfe80) return 'link-local';
  // ff00::/8 — çoklu yayın
  if ((ilkGrup & 0xff00) === 0xff00) return 'çoklu yayın (multicast)';
  // 2001:db8::/32 — belgeleme
  if (adres.startsWith('2001:db8:') || adres === '2001:db8::') return 'belgeleme';

  return null;
}

/** `::ffff:a.b.c.d`, `64:ff9b::a.b.c.d` ve `2002:xxxx:yyyy::` biçimlerinden IPv4 çıkarır. */
function ipv4Gomulu(adres: string): string | null {
  const noktali = adres.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (noktali && isIP(noktali[1]!) === 4) return noktali[1]!;

  // 6to4: 2002:AABB:CCDD::/48 → A.B.C.D
  const alti = adres.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/);
  if (alti) {
    const yuksek = Number.parseInt(alti[1]!.padStart(4, '0'), 16);
    const dusuk = Number.parseInt(alti[2]!.padStart(4, '0'), 16);
    return [yuksek >> 8, yuksek & 0xff, dusuk >> 8, dusuk & 0xff].join('.');
  }

  return null;
}

/** Bir IP dizesinin dışarıya çıkıp çıkamayacağı. Sebep döner, güvenliyse null. */
export function ipYasakSebebi(adres: string): string | null {
  const surum = isIP(adres);
  if (surum === 4) return ipv4Yasakli(adres);
  if (surum === 6) return ipv6Yasakli(adres);
  return 'IP olarak ayrıştırılamadı';
}

/** URL ana makine adından köşeli parantezleri temizler (`[::1]` → `::1`). */
function anaMakine(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

export interface AdresKapisiSecenekleri {
  resolveHost?: HostResolver;
}

/**
 * Adres güvenli değilse FIRLATIR; güvenliyse sessizce döner.
 *
 * Sıra kasıtlı: şema → ad → IP. En ucuz ve en kesin denetim önce yapılır;
 * DNS çözümü yalnızca gerekliyse ve en sonda çalışır.
 */
export async function assertFetchable(
  ham: string,
  secenekler: AdresKapisiSecenekleri = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(ham);
  } catch {
    throw new UnsafeUrlError('adres ayrıştırılamadı', ham);
  }

  // 1) Şema. `file:`, `ftp:`, `gopher:`, `data:` dışarıya çıkmaz.
  if (!IZINLI_SEMALAR.has(url.protocol)) {
    throw new UnsafeUrlError(`izinsiz şema: ${url.protocol}`, ham);
  }

  const host = anaMakine(url);
  if (host === '') throw new UnsafeUrlError('ana makine adı boş', ham);

  // 2) Ad bazlı yasak — DNS'ten bağımsız ikinci katman.
  if (YASAK_ADLAR.has(host)) {
    throw new UnsafeUrlError('yasaklı ana makine adı', ham);
  }

  // 3) Doğrudan IP yazılmışsa DNS'e hiç gerek yok.
  if (isIP(host) !== 0) {
    const sebep = ipYasakSebebi(host);
    if (sebep !== null) throw new UnsafeUrlError(sebep, ham);
    return;
  }

  // 4) Ad çözülür ve ÇIKAN HER ADRES denetlenir.
  //    Hepsi denetlenir, ilki değil: bir ad hem genel hem özel adres
  //    döndürebilir ve bağlantının hangisine gideceğini biz seçmiyoruz.
  const resolver = secenekler.resolveHost ?? defaultResolver;

  let adresler: string[];
  try {
    adresler = await resolver(host);
  } catch {
    // Çözülemeyen ad KAPALI sayılır. Ters varsayım (çözülemedi → geçir)
    // kapının tamamını anlamsız kılardı.
    throw new UnsafeUrlError('ana makine adı çözülemedi', ham);
  }

  if (adresler.length === 0) {
    throw new UnsafeUrlError('ana makine adı hiçbir adrese çözülmedi', ham);
  }

  for (const adres of adresler) {
    const sebep = ipYasakSebebi(adres);
    if (sebep !== null) throw new UnsafeUrlError(sebep, ham);
  }
}
