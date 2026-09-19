/**
 * Yüklenen dosyanın GERÇEK türünü baytlarından okur.
 *
 * ======================================================================
 * NEDEN VAR: BEYAN EDİLEN TÜR İSTEMCİDEN GELİR
 * ======================================================================
 * Tarayıcının gönderdiği `File.type` (multipart'taki `Content-Type`)
 * İSTEMCİNİN BEYANIDIR. `curl -F 'file=@zararli.html;type=application/pdf'`
 * yazan biri için o alan ne derse odur. Yalnızca beyana bakan bir allowlist,
 * kapıda kimlik soran ama kimliğe bakmayan bir görevlidir.
 *
 * Buradaki denetim beyanı DEĞİL, dosyanın ilk baytlarını okur. Bir PDF
 * "%PDF-", bir PNG sekiz baytlık sabit imza, bir JPEG `FF D8 FF` ile
 * başlar. Bu imzalar biçimin kendi tanımının parçasıdır; değiştirilirse
 * dosya da o biçim olmaktan çıkar.
 *
 * ======================================================================
 * BU BİR ANTİVİRÜS DEĞİLDİR
 * ======================================================================
 * Sihirli bayt denetimi, "bu dosya zararsız" demez. Yalnızca "bu dosya
 * beyan ettiği biçimde" der. Gerçek koruma katmanlı: kova özel (private),
 * erişim 60 saniyelik imzalı adresle, sunucu `x-content-type-options:
 * nosniff` gönderiyor ve depolama politikası dosyayı yalnızca sahibine ve
 * yöneticiye açıyor. Bu fonksiyon o katmanlara bir yenisini ekler,
 * hiçbirinin yerine geçmez.
 *
 * ======================================================================
 * NEDEN PAYLAŞILAN PAKETTE
 * ======================================================================
 * `apps/web` içinde test koşucusu yok. Sessizce yanlış çalışabilecek bir
 * mantığı test edilemeyen bir yere koymak, onu denetimsiz bırakmaktır.
 */

/** Tanıdığımız yükleme biçimleri. */
export type DosyaBicimi = 'application/pdf' | 'image/jpeg' | 'image/png';

interface Imza {
  bicim: DosyaBicimi;
  /** Dosyanın başında birebir bulunması gereken baytlar. */
  baytlar: readonly number[];
}

/*
 * İmzalar biçim tanımlarından:
 *   PDF   "%PDF-"                     (ISO 32000-1, §7.5.2)
 *   PNG   89 50 4E 47 0D 0A 1A 0A     (RFC 2083, §3.1 -- sekiz baytın
 *                                      tamamı denetleniyor; ilk dört bayt
 *                                      tek başına satır sonu bozulmasını
 *                                      yakalamaz, ki imzanın var oluş
 *                                      sebebi tam olarak odur)
 *   JPEG  FF D8 FF                    (SOI işaretçisi + sonraki işaretçinin
 *                                      ilk baytı)
 */
const IMZALAR: readonly Imza[] = [
  { bicim: 'application/pdf', baytlar: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  {
    bicim: 'image/png',
    baytlar: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { bicim: 'image/jpeg', baytlar: [0xff, 0xd8, 0xff] },
];

/** En uzun imzayı kapsayacak kadar bayt okumak yeterli. */
export const IMZA_ICIN_GEREKEN_BAYT = Math.max(
  ...IMZALAR.map((i) => i.baytlar.length),
);

/**
 * Baytlardan biçimi çözer. Tanınmayan her şey için `null`.
 *
 * `null` "bilinmiyor" demek DEĞİL, "kabul etmiyoruz" demektir: çağıran
 * taraf bunu reddetme olarak ele almalıdır. Tanımadığımız bir biçimi
 * geçirmek, allowlist'i blocklist'e çevirirdi.
 */
export function bicimiCoz(bas: Uint8Array): DosyaBicimi | null {
  for (const imza of IMZALAR) {
    if (bas.length < imza.baytlar.length) continue;

    let uyuyor = true;
    for (let i = 0; i < imza.baytlar.length; i += 1) {
      if (bas[i] !== imza.baytlar[i]) {
        uyuyor = false;
        break;
      }
    }

    if (uyuyor) return imza.bicim;
  }

  return null;
}

/**
 * Beyan edilen tür ile gerçek baytların UYUŞUP uyuşmadığı.
 *
 * İkisinin de denetlenmesi gerekiyor: yalnızca baytlara bakmak, beyanı
 * `image/png` olan bir dosyanın `application/pdf` olarak saklanmasına izin
 * verirdi ve depolanan `contentType` beyandan geliyor. İkisi ayrışırsa
 * dosya, indirildiğinde beyan edilen türle sunulur -- yani denetim
 * atlanmış olur.
 */
export function yuklemeTuruGecerli(
  beyanEdilen: string,
  bas: Uint8Array,
): boolean {
  const gercek = bicimiCoz(bas);
  return gercek !== null && gercek === beyanEdilen;
}
