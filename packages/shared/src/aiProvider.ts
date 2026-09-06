/**
 * AI SAĞLAYICI AYARININ ÇÖZÜMLENMESİ — saf katman.
 *
 * NEDEN BURADA, NEDEN SAF
 *
 * Arama niyeti ve görsel arama bugün doğrudan Anthropic'e bağlı. Sağlayıcıyı
 * değiştirebilmek bir maliyet kararıdır ve işletmecinindir; ama o kararın
 * DOĞRU okunması bir doğruluk meselesidir: yanlış çözümlenen bir ayar, ya
 * çalışmayan bir özellik ya da -- daha kötüsü -- sessizce yanlış modele
 * giden kullanıcı verisi demektir.
 *
 * Bu yüzden çözümleme, ağ ve ortam değişkenlerinden AYRI tutuldu: girdi
 * verilir, ayar döner. Test edilebilir olması yan fayda; asıl sebep kuralın
 * tek yerde ve okunabilir olması.
 *
 * ORTAM DEĞİŞKENİ ADI BURADA GEÇMEZ.
 *
 * Bu paket istemci paketine de giriyor. `verify-secrets.mjs` derlenmiş
 * istemci paketinde sır ADLARINI arıyor -- çünkü bir sır istemciye değeriyle
 * değil, adına `NEXT_PUBLIC_` öneki konarak sızar. Adları burada yazmak, o
 * denetimi kendi elimizle tetiklemek olurdu. Adları sunucu tarafı okur,
 * buraya yalnızca DEĞERLER gelir.
 *
 * FAIL CLOSED. Tanınmayan bir sağlayıcı ya da eksik bir zorunlu alan `null`
 * döndürür; varsayılana DÜŞMEZ. Sebep depodaki diğer kapılarla aynı:
 * `getProvider` bilinmeyen ağda hata fırlatıyor, `tuketButce` bütçe
 * okunamazsa reddediyor, robots alınamazsa yasak sayılıyor. Sessizce
 * varsayılana düşen bir ayar, yapılandırma hatasını çalışma anına -- yani
 * kullanıcının önüne -- erteler.
 */

/** Desteklenen sağlayıcı biçimleri. */
export const AI_SAGLAYICILARI = ['anthropic', 'openai-uyumlu'] as const;
export type AiSaglayiciAdi = (typeof AI_SAGLAYICILARI)[number];

/**
 * Yapısal çıktının nasıl isteneceği.
 *
 * Sağlayıcılar bu konuda AYRIŞIYOR: bazısı JSON şemasını zorlar, bazısı
 * yalnızca "JSON olsun" der, bazısı hiçbirini desteklemez. Kod değişikliği
 * gerektirmeden aşağı inebilmek için ayar; doğrulama her hâlükârda Zod'da
 * kalır, yani en kötü durumda bugünkü güvenlik seviyesindeyiz.
 */
export const JSON_MODLARI = ['json_schema', 'json_object', 'yok'] as const;
export type JsonModu = (typeof JSON_MODLARI)[number];

/** Sunucunun okuduğu ham değerler. Hepsi metin ya da yok. */
export interface AiHamAyar {
  saglayici?: string | null;
  apiKey?: string | null;
  /** Geriye dönük: mevcut kurulumlarda tek anahtar bu. */
  anthropicApiKey?: string | null;
  baseUrl?: string | null;
  aramaModeli?: string | null;
  gorselModeli?: string | null;
  jsonModu?: string | null;
}

/**
 * Çözümlenmiş ayar.
 *
 * `aramaModeli` ve `gorselModeli` AYRI AYRI boş olabilir: bir işletmeci
 * yalnızca metin aramasını açıp görsel aramayı kapalı tutabilir. Tek bir
 * "açık mı" bayrağı bu ayrımı yutardı ve görsel arama düğmesi çalışmayan
 * bir yola çıkarırdı.
 */
export interface AiAyari {
  saglayici: AiSaglayiciAdi;
  apiKey: string;
  baseUrl: string;
  jsonModu: JsonModu;
  aramaModeli: string | null;
  gorselModeli: string | null;
}

/** Anthropic için bilinen varsayılanlar. Diğer sağlayıcılarda karşılığı YOK. */
const ANTHROPIC_TABAN = 'https://api.anthropic.com';
const ANTHROPIC_ARAMA_MODELI = 'claude-opus-5';
const ANTHROPIC_GORSEL_MODELI = 'claude-haiku-4-5-20251001';

function kirp(deger: string | null | undefined): string | null {
  const s = (deger ?? '').trim();
  return s === '' ? null : s;
}

/**
 * Ham değerlerden ayarı çözer. Yapılandırılamıyorsa `null`.
 *
 * `null` "AI kapalı" demektir ve bu geçerli bir durumdur: uygulama AI
 * olmadan da çalışır (arama düz metne düşer, kamera düğmesi barkod yolunu
 * kullanır). Bu yüzden hata fırlatılmaz.
 */
export function cozumleAiAyari(ham: AiHamAyar): AiAyari | null {
  const istenenSaglayici = kirp(ham.saglayici);

  /*
   * Sağlayıcı belirtilmemişse 'anthropic'. Bu bir varsayılana DÜŞME değil,
   * mevcut kurulumun korunması: bugün çalışan her ortam yalnızca anahtarı
   * tanımlamış durumda ve tek satır değiştirmeden çalışmaya devam etmeli.
   */
  const saglayiciAdi = istenenSaglayici ?? 'anthropic';

  if (!(AI_SAGLAYICILARI as readonly string[]).includes(saglayiciAdi)) {
    // Yazım hatası sessizce Anthropic'e düşerse, işletmeci başka bir
    // sağlayıcıya geçtiğini sanırken faturası Anthropic'ten gelir.
    return null;
  }
  const saglayici = saglayiciAdi as AiSaglayiciAdi;

  const jsonModuHam = kirp(ham.jsonModu) ?? 'json_schema';
  if (!(JSON_MODLARI as readonly string[]).includes(jsonModuHam)) return null;
  const jsonModu = jsonModuHam as JsonModu;

  // Anahtar iki addan gelebilir; yeni ad önceliklidir.
  const apiKey = kirp(ham.apiKey) ?? kirp(ham.anthropicApiKey);
  if (!apiKey) return null;

  if (saglayici === 'anthropic') {
    return {
      saglayici,
      apiKey,
      baseUrl: kirp(ham.baseUrl) ?? ANTHROPIC_TABAN,
      jsonModu,
      aramaModeli: kirp(ham.aramaModeli) ?? ANTHROPIC_ARAMA_MODELI,
      gorselModeli: kirp(ham.gorselModeli) ?? ANTHROPIC_GORSEL_MODELI,
    };
  }

  /*
   * OpenAI-uyumlu uçlar için VARSAYILAN YOK.
   *
   * Adresi ve model adını uydurmak mümkün değil: her sağlayıcının kendi
   * adresi ve kendi model adları var. Eksikse özellik kapalı kalır --
   * uydurulmuş bir model adıyla çalışma anında 404 almaktan iyidir.
   */
  const baseUrl = kirp(ham.baseUrl);
  if (!baseUrl) return null;

  return {
    saglayici,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    jsonModu,
    aramaModeli: kirp(ham.aramaModeli),
    gorselModeli: kirp(ham.gorselModeli),
  };
}

/** Metin araması için AI kullanılabilir mi? */
export function aramaAiAcik(ayar: AiAyari | null): boolean {
  return ayar !== null && ayar.aramaModeli !== null;
}

/** Görsel arama için AI kullanılabilir mi? */
export function gorselAiAcik(ayar: AiAyari | null): boolean {
  return ayar !== null && ayar.gorselModeli !== null;
}
