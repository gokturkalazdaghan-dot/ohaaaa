/**
 * Alım hatalarının sınıflandırılması.
 *
 * NEDEN VAR: kuyruk, bir hatanın YENİDEN DENENMEYE değip değmediğini
 * bilmiyordu. `sourceSyncHandler` her başarısız turu düz bir `Error` olarak
 * fırlatıyordu ve kuyruk hepsini geçici sayıyordu. Sonuç:
 *
 *   • Eksik bir ortam değişkeni ya da yanlış bir alan haritası -- yani
 *     tekrar denenince KESİNLİKLE aynı sonucu verecek bir hata -- üstel
 *     geri çekilmeyle beş kez deneniyor, saatler sonra ölü mektuba düşüyordu.
 *   • 401 alan bir kaynak, sağlayıcıya dört kez daha kimliksiz istek
 *     gönderiyordu. Bazı ağlar bunu kötüye kullanım sayar.
 *   • `sources.last_error` sütununda "secret eksik" ile "sağlayıcı bir an
 *     düştü" aynı görünüyordu; operatör hangisini düzelteceğini bilemezdi.
 *
 * BU DOSYA BİR KARAR TABLOSUDUR, YENİ BİR MEKANİZMA DEĞİL. Kuyruğun
 * kalıcı/geçici ayrımı (`PermanentJobError`, `fail_job(p_permanent)`) ve
 * geri çekilmesi zaten vardı; eksik olan, hataya bakıp hangisi olduğunu
 * söyleyen katmandı.
 *
 * BU DOSYA HİÇBİR ŞEY İTHAL ETMEZ. `redact.ts` buradan `IngestError`
 * alıyor, `politeClient.ts` de `redact.ts`'ten maskeleme alıyor. Buradan
 * `politeClient`'a bir ithal eklenirse döngü oluşur; bu yüzden dışarıdan
 * gelen hatalar `name` ve `status` alanlarına bakılarak tanınıyor. O adlar
 * bir sözleşme ve `errors.test.ts` içinde kilitli: sınıf adı değişirse
 * test düşer.
 */

export type IngestErrorClass =
  | 'CONFIG_ERROR'
  | 'AUTH_ERROR'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'PARSER_ERROR'
  | 'VALIDATION_ERROR'
  | 'DATABASE_ERROR'
  | 'SECURITY_ERROR'
  | 'UNKNOWN_ERROR';

/** Sınıflandırmanın sonucu. */
export interface ClassifiedError {
  errorClass: IngestErrorClass;
  /** true ise kuyruk YENİDEN DENEMEZ. */
  permanent: boolean;
}

/**
 * Hattın kendi fırlattığı, sınıfı önceden bilinen hata.
 *
 * Dışarıdan gelen hataları (fetch, Supabase) tahmin etmek zorundayız ama
 * kendi hatalarımızı tahmin etmek gereksiz ve kırılgan olurdu: mesaj metnine
 * bakarak sınıflandırma, birisi bir cümleyi düzelttiğinde sessizce bozulur.
 */
export class IngestError extends Error {
  constructor(
    readonly errorClass: IngestErrorClass,
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'IngestError';
  }
}

/** Sınıf başına varsayılan kalıcılık. */
const KALICI: Readonly<Record<IngestErrorClass, boolean>> = {
  // Yapılandırma düzelmeden hiçbir deneme başarılı olamaz.
  CONFIG_ERROR: true,
  // Kimlik bilgisi değişmeden tekrar denemek, sağlayıcıya kimliksiz istek
  // yağdırmaktır; bazı ağlar bunu kötüye kullanım sayar.
  AUTH_ERROR: true,
  // Ağ hataları tam olarak yeniden denemenin işe yaradığı durumdur.
  NETWORK_ERROR: false,
  // 4xx kalıcı, 5xx geçici. Burada varsayılan kalıcı; `classifyIngestError`
  // durum koduna bakıp 5xx'i geçiciye çeviriyor.
  HTTP_ERROR: true,
  // Feed'in biçimi bozuk. Bir sonraki yayında düzelebilir -- sağlayıcının
  // yarım yazılmış dosyası yaygın bir durumdur.
  PARSER_ERROR: false,
  // Alan haritası yanlış. Harita düzeltilmeden hiçbir tur geçemez.
  VALIDATION_ERROR: true,
  // Veritabanı geçici olarak erişilemez olabilir.
  DATABASE_ERROR: false,
  // robots.txt yasağı ya da izinsiz alan adı. Tekrar denemek yasağı
  // yok saymaktır.
  SECURITY_ERROR: true,
  // Tanımadığımız hata GEÇİCİ sayılır. Ters varsayım, düzelebilecek bir
  // arızayı ilk denemede kalıcı işaretleyip kaynağı sessizce öldürürdü.
  UNKNOWN_ERROR: false,
};

/** Bir sınıfın varsayılan kalıcılığı. */
export function isPermanentClass(errorClass: IngestErrorClass): boolean {
  return KALICI[errorClass];
}

/** `politeClient`'ın `PermanentHttpError`'ı gibi durum kodu taşıyan hata. */
function durumKodu(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const ham = (error as { status?: unknown }).status;
  return typeof ham === 'number' ? ham : null;
}

function adi(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const ham = (error as { name?: unknown }).name;
  return typeof ham === 'string' ? ham : '';
}

function mesaji(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Bir hatayı sınıflandırır ve yeniden denenip denenmeyeceğini söyler.
 *
 * Sıra önemlidir: en kesin bilgiden en zayıfına doğru gidilir. Metin
 * eşleştirme EN SONA bırakılıyor çünkü en kırılgan yöntem odur; ondan önce
 * gelen her adım yapısal bir işarete (sınıf adı, durum kodu) dayanıyor.
 */
export function classifyIngestError(error: unknown): ClassifiedError {
  // 1) Kendi hatamız: sınıfı zaten taşıyor, tahmine gerek yok.
  if (error instanceof IngestError) {
    return { errorClass: error.errorClass, permanent: error.permanent };
  }

  const ad = adi(error);
  const durum = durumKodu(error);

  // 2) robots.txt yasağı. Tekrar denemek yasağı yok saymaktır.
  if (ad === 'RobotsDisallowedError') {
    return { errorClass: 'SECURITY_ERROR', permanent: true };
  }

  // 3) Devre kesici: kaynak zaten korunuyor, hata kaynağın kendisinde değil.
  if (ad === 'CircuitOpenError') {
    return { errorClass: 'NETWORK_ERROR', permanent: false };
  }

  // 4) Durum kodu taşıyan HTTP hatası.
  if (ad === 'PermanentHttpError' || durum !== null) {
    if (durum === 401 || durum === 403) {
      return { errorClass: 'AUTH_ERROR', permanent: true };
    }
    if (durum === 429) {
      // "Yavaşla" demek "bir daha gelme" demek değildir.
      return { errorClass: 'NETWORK_ERROR', permanent: false };
    }
    if (durum !== null && durum >= 500) {
      return { errorClass: 'HTTP_ERROR', permanent: false };
    }
    return { errorClass: 'HTTP_ERROR', permanent: true };
  }

  const metin = mesaji(error);

  // 5) Metin eşleştirme -- yalnızca yapısal işareti olmayan hatalar için.
  //    Yeniden deneme yanlış tarafa düşerse maliyeti sınırlı: geçici
  //    sayılan kalıcı hata en fazla birkaç deneme yakar, tersi olan
  //    (kalıcı sayılan geçici hata) kaynağı öldürürdü. Bu yüzden
  //    eşleşmeyen her şey GEÇİCİ kalıyor.
  if (/HTTP 5\d\d/.test(metin)) {
    return { errorClass: 'HTTP_ERROR', permanent: false };
  }
  if (/Zaman aşımı|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(metin)) {
    return { errorClass: 'NETWORK_ERROR', permanent: false };
  }

  return { errorClass: 'UNKNOWN_ERROR', permanent: false };
}
