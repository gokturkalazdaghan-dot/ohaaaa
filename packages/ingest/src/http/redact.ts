/**
 * Kimlik bilgisi maskeleme.
 *
 * NEDEN VAR: bağlı bir feed'e yapılan İLK isteğin en olası sonucu 401/403'tür
 * ve o hatanın metni bugün feed adresinin TAMAMINI taşıyordu. O metin
 * `summary.error`'a, oradan `ingest_runs.error` ve `sources.last_error`
 * sütunlarına (veritabanında düz metin) ve CLI çıktısıyla CI günlüğüne
 * yazılıyordu. Ortaklık ağlarının feed adresleri jetonu sorgu dizisinde
 * taşır; yani ilk deneme yanlış giderse jeton üç ayrı yere düşerdi.
 *
 * İKİ AYRI MEKANİZMA, İKİSİ DE KESİN -- SEZGİSEL DEĞİL:
 *
 *   1. YAPISAL: bir adresteki TÜM sorgu değerleri ve kullanıcı bilgisi
 *      maskelenir. Hangi anahtarın gizli olduğunu tahmin etmeye
 *      çalışmıyoruz; "token", "apikey", "sig" gibi bir ad listesi her ağda
 *      farklıdır ve listede olmayan tek bir ad sızıntı demektir.
 *
 *   2. DEĞER: bilinen gizli değerler (ortam değişkeninden okunanlar) metnin
 *      NERESİNDE geçerse geçsin silinir. Bu, sorgu dizisinde olmayan --
 *      örneğin yol içine gömülü -- jetonu da yakalar, çünkü tahmin değil
 *      birebir eşleşme yapar.
 *
 * Şema, alan adı ve yol KORUNUR: "HTTP 401" ile "HTTP 401 -- hangi adres"
 * arasındaki fark teşhis edilebilirlikle edilemezlik arasındaki farktır.
 */

/**
 * Bilinen gizli değerler.
 *
 * Modül düzeyinde tutuluyor çünkü maskeleme, gizli değeri hiç görmemiş
 * çağrı yığınlarının (hata biçimlendirme, depo yazıcısı) içinde çalışmak
 * zorunda. Parametre olarak taşımak, taşımayı unutan tek bir çağrı
 * noktasının sızıntı açması demekti.
 */
const gizliDegerler = new Set<string>();

/** Maskelemede kullanılan sabit. Uzunluk bilgisi de sızdırmaz. */
export const MASKE = '***';

/**
 * Kısa değerler KAYDEDİLMEZ.
 *
 * "1" ya da "tr" gibi bir değeri gizli sayarsak, o dizgiyi taşıyan her
 * hata metni okunamaz hale gelirdi ("HTTP 401" -> "HTTP 40***"). Gerçek
 * bir jeton bu eşiğin altında olmaz.
 */
const EN_KISA_GIZLI = 8;

/** Bir gizli değeri maskeleme kaydına ekler. */
export function registerSecret(value: string | undefined | null): void {
  if (typeof value !== 'string') return;
  const kirpilmis = value.trim();
  if (kirpilmis.length < EN_KISA_GIZLI) return;
  gizliDegerler.add(kirpilmis);
}

/** Yalnızca test içindir: kayıt defterini boşaltır. */
export function clearSecretsForTest(): void {
  gizliDegerler.clear();
}

/** Düzenli ifade içinde güvenli kullanım için kaçış. */
function kacir(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bir adresi maskeler: sorgu değerleri ve kullanıcı bilgisi gider,
 * şema/alan adı/yol kalır.
 *
 * Ayrıştırılamayan girdi olduğu gibi DEĞİL, tamamen maskelenmiş döner:
 * adres olmadığından emin olamadığımız bir dizgiyi olduğu gibi geçirmek,
 * bozuk bir adresteki jetonu yayımlamak olurdu.
 */
export function maskUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return MASKE;
  }

  if (url.username || url.password) {
    url.username = MASKE;
    url.password = '';
  }

  // Anahtarlar korunur (hangi parametrenin gönderildiği teşhis için gerekli),
  // değerlerin hepsi gider.
  const anahtarlar = [...url.searchParams.keys()];
  for (const anahtar of anahtarlar) {
    url.searchParams.set(anahtar, MASKE);
  }

  /*
   * URL kodlaması geri alınıyor: `set` yıldızları kodlamaz ama iki nokta
   * gibi karakterler kodlanabilir ve maske okunmaz hale gelirdi.
   */
  return url.toString().replace(/%2A/gi, '*');
}

/**
 * Bir metindeki gizli bilgileri temizler.
 *
 * Sıra ÖNEMLİ: önce bilinen değerler siliniyor, sonra adresler
 * maskeleniyor. Tersi olsaydı, adres maskelemesi sırasında sorgu dizisi
 * yeniden yazılırken bilinen bir değer kodlanıp birebir eşleşmeden kaçardı.
 */
export function redact(text: string): string {
  let sonuc = text;

  for (const gizli of gizliDegerler) {
    sonuc = sonuc.split(gizli).join(MASKE);
    // Adres içine kodlanmış hali de aynı değerdir.
    const kodlanmis = encodeURIComponent(gizli);
    if (kodlanmis !== gizli) sonuc = sonuc.split(kodlanmis).join(MASKE);
  }

  // Metne gömülü adresleri bul ve maskele.
  sonuc = sonuc.replace(/\bhttps?:\/\/[^\s<>"')\]]+/gi, (adres) => maskUrl(adres));

  return sonuc;
}

/** `redact` ama hata nesnesi ya da bilinmeyen tip için. */
export function redactError(error: unknown): string {
  const metin = error instanceof Error ? error.message : String(error);
  return redact(metin);
}

/**
 * Adres şablonundaki `${DEGISKEN}` yer tutucularını ortamdan doldurur.
 *
 * KİMLİK BİLGİSİ VERİTABANINA YAZILMAZ.
 *
 * Ortaklık ağı feed adresi genelde jetonu içinde taşır. O adresi
 * `sources.endpoint_url` sütununa olduğu gibi yazmak, jetonu düz metin
 * olarak veritabanında tutmak demekti -- yedeklerde, panelde ve her
 * `select *` çıktısında. Bunun yerine sütunda şablon durur:
 *
 *   https://feed.ornek.com/export.csv?token=${OHAAAA_FEED_TOKEN}
 *
 * Gerçek değer yalnızca çalışma anında, ortamdan gelir ve aynı anda
 * maskeleme defterine yazılır -- yani bundan sonra hiçbir günlükte ya da
 * hata metninde görünemez.
 *
 * Eksik değişken SESSİZ GEÇİLMEZ: yer tutucuyu olduğu gibi bırakmak,
 * sunucuya `token=${OHAAAA_FEED_TOKEN}` diye istek atıp 401 almak ve
 * sebebi "kimlik doğrulama hatası" sanmak olurdu. Hata mesajı DEĞİŞKEN
 * ADINI söyler (güvenli), değerini değil.
 */
export function expandSecretPlaceholders(
  template: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const eksik: string[] = [];

  const sonuc = template.replace(/\$\{([A-Z0-9_]+)\}/g, (_eslesme, ad: string) => {
    const deger = env[ad];
    if (typeof deger !== 'string' || deger.length === 0) {
      eksik.push(ad);
      return '';
    }
    registerSecret(deger);
    return deger;
  });

  if (eksik.length > 0) {
    throw new Error(
      `Kaynak adresindeki gizli değişken(ler) ortamda tanımlı değil: ${eksik.join(', ')}`,
    );
  }

  return sonuc;
}
