/**
 * İşletme künyesi — TEK kaynak.
 *
 * NEDEN
 * Bu bilgiler önce üç ayrı sayfaya elle gömülmüştü: iletişim, gizlilik ve
 * kullanım şartları. Şirket kurulduğunda on bir ayrı yeri bulup değiştirmek
 * gerekiyordu ve bir tanesini atlamak sessiz bir hataydı — mesafeli satış
 * sözleşmesinde "[Ad Soyad]" yazan bir site, sözleşmesi geçersiz bir sitedir.
 *
 * Artık hepsi buradan ve ortam değişkenlerinden gelir. Doldurmak Vercel'de
 * birkaç değişken girmekten ibarettir; kod değişmez, dağıtım yeter.
 *
 * MEVZUAT NOTU
 * 6563 sayılı kanun ve Elektronik Ticaret Bilgi Sistemi (ETBİS) düzenlemesi,
 * hizmet sağlayıcının unvanını, adresini ve iletişim bilgilerini sitede
 * "kolayca ulaşılabilir" biçimde bulundurmayı zorunlu kılar. Bu alanlar
 * süsleme değil, yükümlülüktür.
 */

/** Doldurulmamış alanlar için işaret. Ekranda da bu görünür. */
const MISSING = '—';

function field(value: string | undefined): { value: string; filled: boolean } {
  const v = value?.trim();
  return v ? { value: v, filled: true } : { value: MISSING, filled: false };
}

export const business = {
  /** Ticari unvan (şahıs firmasında ad soyad). */
  legalName: field(process.env.NEXT_PUBLIC_BUSINESS_NAME),
  /** Açık adres — mahalle, cadde, no, ilçe/il. */
  address: field(process.env.NEXT_PUBLIC_BUSINESS_ADDRESS),
  /** Bağlı olunan vergi dairesi. */
  taxOffice: field(process.env.NEXT_PUBLIC_BUSINESS_TAX_OFFICE),
  /** Vergi numarası ya da şahıs firmasında TC kimlik numarası. */
  taxNumber: field(process.env.NEXT_PUBLIC_BUSINESS_TAX_NUMBER),
  /** Ticaret sicil / esnaf sicil numarası. */
  registryNumber: field(process.env.NEXT_PUBLIC_BUSINESS_REGISTRY_NUMBER),
  /** ETBİS kayıt numarası. */
  etbisNumber: field(process.env.NEXT_PUBLIC_BUSINESS_ETBIS),
  /** İletişim telefonu. */
  phone: field(process.env.NEXT_PUBLIC_BUSINESS_PHONE),
  /** KEP adresi (varsa). */
  kep: field(process.env.NEXT_PUBLIC_BUSINESS_KEP),
} as const;

export const processors = {
  /** Siteyi barındıran sağlayıcı — KVKK aydınlatma metninde açıklanmalı. */
  hosting: field(process.env.NEXT_PUBLIC_HOSTING_PROVIDER ?? 'Vercel Inc.'),
  /** Ölçümleme sağlayıcısı; yoksa "kullanılmıyor" denir. */
  analytics: field(process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER),
} as const;

/** Künyede eksik kalan zorunlu alanların adları. */
export function missingBusinessFields(): string[] {
  const labels: Record<keyof typeof business, string> = {
    legalName: 'Ticari unvan',
    address: 'Açık adres',
    taxOffice: 'Vergi dairesi',
    taxNumber: 'Vergi / TC kimlik no',
    registryNumber: 'Sicil no',
    etbisNumber: 'ETBİS numarası',
    phone: 'Telefon',
    kep: 'KEP adresi',
  };
  return (Object.keys(business) as (keyof typeof business)[])
    .filter((k) => !business[k].filled)
    .map((k) => labels[k]);
}

/** Künye yayına hazır mı? KEP zorunlu değildir, o yüzden hariç tutulur. */
export function isBusinessComplete(): boolean {
  return missingBusinessFields().every((f) => f === 'KEP adresi');
}
