/**
 * ORTAKLIK BORU HATTI — durum TÜRETME katmanı.
 *
 * Bir advertiser'ın "aday" olmaktan "para kazandıran ortak" olmaya kadar
 * geçtiği yol dokuz aşamalıdır. Bu dosya, o dokuz aşamanın her birinin
 * durumunu ELDEKİ KANITTAN türetir.
 *
 * TEK BİR KURAL BÜTÜN DOSYAYI YÖNETİR:
 *
 *   BİLGİNİN YOKLUĞU, OLUMSUZ BİR CEVAP DEĞİLDİR.
 *
 * "MID alanı boş" ile "bu programın MID'i yok" aynı şey değildir. Birincisi
 * bizim eksiğimiz, ikincisi ağ hakkında bir iddia. Panel ikisini aynı
 * gösterirse operatör yanlış işi yapar: var olan bir MID'i aramak yerine
 * programı yeniden başvurulacak sanır.
 *
 * Bu yüzden iki ayrı "olumsuz" değer var ve karıştırılmaları yasak:
 *
 *   'baslanmadi'    — BİZİM kaydımıza bakıp emin olabiliyoruz. Kendi
 *                     yapılandırmamızda satır yoksa, o iş gerçekten
 *                     yapılmamıştır. Bu bir bilgidir.
 *   'dogrulanmadi'  — DIŞARIYA ait bir olgu ve elimizde kanıt yok.
 *                     Cevabı bilmiyoruz. Bu bilginin yokluğudur.
 *
 * Sınır nettir: kendi tablolarımızdaki satırların yokluğu kanıttır; ağdan
 * gelmesi gereken bir olgunun (MID, onay, komisyon şartları) yokluğu
 * kanıt değildir.
 *
 * SAF FONKSİYONLAR. Ne veritabanı ne ağ; girdi verilir, durum döner.
 * Sebebi test edilebilirlik değil DOĞRULUK: türetme kuralları okumadan
 * ayrılırsa aynı satır iki yerde iki farklı şey gösterebilir.
 */

// ---------------------------------------------------------------------------
// Durum sözlüğü
// ---------------------------------------------------------------------------

/**
 * Bir aşamanın durumu.
 *
 * `dogrulandi` YALNIZCA olumlu kanıt varken kullanılır. Bir aşamayı
 * "tamam" göstermek, sonraki aşamaya geçme kararını doğurur; kanıtsız bir
 * "tamam", boşa harcanan iş demektir.
 */
export type KanitDurumu =
  | 'dogrulandi'   // olumlu kanıt var
  | 'beklemede'    // iş yapıldı, dışarıdan cevap bekleniyor
  | 'engelli'      // olumsuz kanıt var (ret, hata, askı)
  | 'baslanmadi'   // kendi kaydımıza göre bu iş henüz yapılmadı
  | 'dogrulanmadi'; // DIŞ bir olgu ve elimizde kanıt yok — NOT VERIFIED

/** Boru hattının aşamaları; panelin sütunlarıyla birebir. */
export type OrtakAsamasi =
  | 'advertiser'
  | 'mid'
  | 'basvuru'
  | 'onay'
  | 'feed'
  | 'eslesme'
  | 'deneme'
  | 'yayin'
  | 'gelir';

export interface AsamaDurumu {
  asama: OrtakAsamasi;
  durum: KanitDurumu;
  /**
   * İnsana dönük tek cümlelik gerekçe. Panelde gösterilir; "neden bu
   * renk?" sorusunun cevabı ekranda olmalı, kodda değil.
   */
  gerekce: string;
}

/** Ağın tanıdığı başvuru durumları (merchants.application_status). */
export type BasvuruDurumu =
  | 'not_started'
  | 'ready'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'blocked';

/** merchants.status */
export type MagazaDurumu =
  | 'prospect'
  | 'pending'
  | 'active'
  | 'paused'
  | 'terminated';

/** ingest_runs / sources.last_status */
export type AlimDurumu = 'running' | 'success' | 'partial' | 'failed';

/**
 * Bir kaynağın (feed) panel için gereken alanları.
 * Alan adları veritabanı sütunlarıyla aynı anlamı taşır.
 */
export interface OrtakKaynagi {
  slug: string;
  kind: string;
  endpointUrl: string | null;
  /** sources.field_mapping — feed kolonlarının kanonik alanlara eşlemesi. */
  fieldMapping: Record<string, unknown>;
  isEnabled: boolean;
  lastRunAt: string | null;
  lastStatus: AlimDurumu | null;
}

/**
 * Bir advertiser'ın boru hattı girdisi.
 *
 * `gelirOkunabildi` AYRI BİR ALAN, çünkü sıfır gelir ile okunamayan gelir
 * aynı şey değildir. Bu ayrım tahsilat sayfasında zaten var; boru hattı
 * onu bozmamalı.
 */
export interface OrtakGirdisi {
  slug: string;
  displayName: string;
  partnerRank: number | null;
  network: string;
  status: MagazaDurumu;
  applicationStatus: BasvuruDurumu;
  applicationSubmittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  networkAdvertiserId: string | null;
  termsVerifiedAt: string | null;
  deeplinkTemplate: string | null;
  kaynaklar: OrtakKaynagi[];
  donusumSayisi: number;
  tahsilEdilenKurus: number;
  /** false ise gelir tablosu OKUNAMADI — sıfır anlamına gelmez. */
  gelirOkunabildi: boolean;
}

export interface OrtakSatiri {
  girdi: OrtakGirdisi;
  asamalar: Record<OrtakAsamasi, AsamaDurumu>;
  /**
   * Operatörün yapması gereken TEK sonraki iş. Panelin asıl değeri budur:
   * dokuz sütunu okuyup ne yapacağına karar vermek operatörün işi olmamalı.
   */
  sonrakiAdim: string;
}

/**
 * `sources.field_mapping` içinde bulunması ZORUNLU kanonik alanlar.
 * Kaynak: `@ohaaaa/ingest` FieldMapping arayüzü — bu dördü olmadan bir
 * satır normalize edilemez.
 */
export const ZORUNLU_ESLESME_ALANLARI = ['external_id', 'title', 'price', 'url'] as const;

// ---------------------------------------------------------------------------
// Aşama türetmeleri
// ---------------------------------------------------------------------------

function durum(asama: OrtakAsamasi, d: KanitDurumu, gerekce: string): AsamaDurumu {
  return { asama, durum: d, gerekce };
}

/**
 * ADVERTISER — kaydın kendisi.
 * Her zaman `dogrulandi`: satır elimizde, adı biliyoruz. Bu sütun bir
 * durum değil çapa; yine de aynı şekli taşıması panelin tek tip
 * okunmasını sağlıyor.
 */
function advertiserDurumu(g: OrtakGirdisi): AsamaDurumu {
  return durum(
    'advertiser',
    'dogrulandi',
    g.partnerRank === null
      ? 'Kayıtlı advertiser.'
      : `Öncelik sırası ${g.partnerRank}.`,
  );
}

/**
 * MID — ağın advertiser kimliği.
 *
 * DIŞ bir olgudur: boş olması "MID yok" demek değil, "bizde yok" demektir.
 * Bu yüzden yokluğu `dogrulanmadi`, asla `baslanmadi` değil.
 */
function midDurumu(g: OrtakGirdisi): AsamaDurumu {
  if (g.networkAdvertiserId !== null && g.networkAdvertiserId !== '') {
    return durum('mid', 'dogrulandi', `Ağ kimliği ${g.networkAdvertiserId}.`);
  }
  if (g.network !== 'awin') {
    return durum('mid', 'dogrulanmadi', 'Doğrudan program — ağ kimliği tanımlı değil.');
  }
  return durum(
    'mid',
    'dogrulanmadi',
    'Awin advertiser kimliği (MID) elimizde yok. Yönlendirme linki bu kimlik olmadan üretilemez.',
  );
}

/** BAŞVURU — bizim eylemimiz, bu yüzden yokluğu bilgidir. */
function basvuruDurumu(g: OrtakGirdisi): AsamaDurumu {
  switch (g.applicationStatus) {
    case 'not_started':
      return durum('basvuru', 'baslanmadi', 'Başvuru gönderilmedi.');
    case 'ready':
      return durum('basvuru', 'baslanmadi', 'Başvuru için hazır; henüz gönderilmedi.');
    case 'submitted':
      return durum(
        'basvuru',
        'beklemede',
        g.applicationSubmittedAt === null
          ? 'Başvuru gönderildi; gönderim tarihi kayıtlı değil.'
          : `Başvuru ${tarih(g.applicationSubmittedAt)} tarihinde gönderildi.`,
      );
    case 'approved':
      return durum('basvuru', 'dogrulandi', 'Başvuru gönderildi ve sonuçlandı.');
    case 'rejected':
      return durum('basvuru', 'engelli', 'Başvuru reddedildi.');
    case 'blocked':
      return durum('basvuru', 'engelli', 'Başvuru engelli.');
  }
}

/**
 * ONAY — ağın kararı. En kritik ayrım burada:
 * "başvurduk ama cevap gelmedi" ile "onaylandı mı bilmiyoruz" farklıdır.
 */
function onayDurumu(g: OrtakGirdisi): AsamaDurumu {
  if (g.approvedAt !== null) {
    return durum('onay', 'dogrulandi', `Ağ ${tarih(g.approvedAt)} tarihinde onayladı.`);
  }
  if (g.rejectedAt !== null) {
    return durum('onay', 'engelli', `Ağ ${tarih(g.rejectedAt)} tarihinde reddetti.`);
  }
  if (g.applicationStatus === 'blocked') {
    return durum('onay', 'engelli', 'Program bizim tarafımızdan olmayan bir sebeple kapalı.');
  }
  if (g.applicationStatus === 'submitted') {
    return durum('onay', 'beklemede', 'Ağdan karar bekleniyor.');
  }
  if (g.applicationStatus === 'not_started' || g.applicationStatus === 'ready') {
    return durum('onay', 'baslanmadi', 'Başvuru gönderilmediği için karar da yok.');
  }
  /*
   * Buraya yalnızca `approved`/`rejected` durumu tarih olmadan yazılmışsa
   * gelinir. Veritabanı kısıtı bunu engelliyor; yine de kodun burada
   * "onaylandı" demesi YASAK — kısıt bir gün gevşetilirse bu satır sessizce
   * yalan söylemeye başlardı.
   */
  return durum('onay', 'dogrulanmadi', 'Karar kaydı var ama tarihi yok — doğrulanamıyor.');
}

/** FEED — kendi yapılandırmamız; satır yoksa gerçekten yapılmamıştır. */
function feedDurumu(g: OrtakGirdisi): AsamaDurumu {
  if (g.kaynaklar.length === 0) {
    return durum('feed', 'baslanmadi', 'Tanımlı veri kaynağı yok.');
  }
  const adresli = g.kaynaklar.filter(
    (k) => k.kind === 'manual' || (k.endpointUrl !== null && k.endpointUrl !== ''),
  );
  if (adresli.length === g.kaynaklar.length) {
    return durum('feed', 'dogrulandi', `${g.kaynaklar.length} kaynak tanımlı.`);
  }
  return durum(
    'feed',
    'beklemede',
    `${g.kaynaklar.length} kaynağın ${g.kaynaklar.length - adresli.length} tanesinin adresi yok.`,
  );
}

/** EŞLEŞME — feed kolonlarının kanonik alanlara bağlanması. */
function eslesmeDurumu(g: OrtakGirdisi): AsamaDurumu {
  if (g.kaynaklar.length === 0) {
    return durum('eslesme', 'baslanmadi', 'Eşlenecek kaynak yok.');
  }

  const eksikler = g.kaynaklar.map((k) => ({
    slug: k.slug,
    eksik: eksikEslesmeAlanlari(k.fieldMapping),
  }));

  const eksikOlan = eksikler.filter((e) => e.eksik.length > 0);
  if (eksikOlan.length === 0) {
    return durum('eslesme', 'dogrulandi', 'Zorunlu alanların tamamı eşlendi.');
  }
  if (eksikOlan.length === g.kaynaklar.length && eksikOlan.every((e) => e.eksik.length === ZORUNLU_ESLESME_ALANLARI.length)) {
    return durum('eslesme', 'baslanmadi', 'Hiçbir alan eşlenmedi.');
  }
  const ilk = eksikOlan[0]!;
  return durum(
    'eslesme',
    'beklemede',
    `${ilk.slug}: eksik alan(lar) ${ilk.eksik.join(', ')}.`,
  );
}

/** Bir eşleme haritasında hangi zorunlu alanlar eksik? */
export function eksikEslesmeAlanlari(harita: Record<string, unknown>): string[] {
  return ZORUNLU_ESLESME_ALANLARI.filter((alan) => {
    const deger = harita[alan];
    return typeof deger !== 'string' || deger.trim() === '';
  });
}

/**
 * DENEME — feed'in gerçekten okunup okunmadığı.
 *
 * `failed` olumsuz KANITTIR (engelli), bilgi yokluğu değil: deneme yapıldı
 * ve düştü. Karıştırmak, düzeltilmesi gereken bir hatayı "henüz
 * yapılmadı" diye gösterirdi.
 */
function denemeDurumu(g: OrtakGirdisi): AsamaDurumu {
  if (g.kaynaklar.length === 0) {
    return durum('deneme', 'baslanmadi', 'Çalıştırılacak kaynak yok.');
  }
  const calisan = g.kaynaklar.filter((k) => k.lastRunAt !== null);
  if (calisan.length === 0) {
    return durum('deneme', 'baslanmadi', 'Hiçbir kaynak henüz çalıştırılmadı.');
  }
  if (calisan.some((k) => k.lastStatus === 'failed')) {
    return durum('deneme', 'engelli', 'Son çalışma hata ile bitti.');
  }
  if (calisan.some((k) => k.lastStatus === 'running')) {
    return durum('deneme', 'beklemede', 'Çalışma sürüyor.');
  }
  if (calisan.some((k) => k.lastStatus === 'partial')) {
    return durum('deneme', 'beklemede', 'Son çalışma kısmi başarıyla bitti.');
  }
  if (calisan.every((k) => k.lastStatus === 'success')) {
    return durum('deneme', 'dogrulandi', 'Deneme çalışması başarılı.');
  }
  /*
   * `lastRunAt` dolu ama `lastStatus` boş: çalışma başladı ve sonucu
   * yazılmadı. Bu bir başarı DEĞİLDİR ve başarısızlık da değildir.
   */
  return durum('deneme', 'dogrulanmadi', 'Çalışma kaydı var ama sonucu yazılmamış.');
}

/**
 * YAYIN — gerçek kullanıcıya link gösterilecek durum.
 *
 * Üç şart birlikte aranır: mağaza aktif, en az bir kaynak açık ve son
 * çalışma başarılı. Biri eksikse yayın sayılmaz; çünkü "yayında" demek,
 * o mağazanın linklerinin çalıştığını iddia etmektir.
 */
function yayinDurumu(g: OrtakGirdisi): AsamaDurumu {
  if (g.status === 'terminated') {
    return durum('yayin', 'engelli', 'Ortaklık sonlandırıldı.');
  }
  if (g.status === 'paused') {
    return durum('yayin', 'engelli', 'Ortaklık duraklatıldı.');
  }
  if (g.status !== 'active') {
    return durum('yayin', 'baslanmadi', 'Mağaza henüz yayına alınmadı.');
  }
  if (g.deeplinkTemplate === null || g.deeplinkTemplate === '') {
    // Şema bunu engelliyor; yine de kod kendi başına doğru olmalı.
    return durum('yayin', 'engelli', 'Yönlendirme şablonu yok — link üretilemez.');
  }
  const acik = g.kaynaklar.filter((k) => k.isEnabled);
  if (acik.length === 0) {
    return durum('yayin', 'beklemede', 'Mağaza aktif ama açık bir veri kaynağı yok.');
  }
  if (acik.some((k) => k.lastStatus === 'success' || k.lastStatus === 'partial')) {
    return durum('yayin', 'dogrulandi', 'Yayında; veri akıyor.');
  }
  return durum('yayin', 'beklemede', 'Kaynak açık ama başarılı bir çalışma yok.');
}

/**
 * GELİR — tek gerçek başarı ölçüsü.
 *
 * OKUNAMADI ≠ SIFIR. Tahsilat sayfası bu ayrımı koruyor ve boru hattı da
 * korumak zorunda: "0 TL" yazmak "hiç kazanmadık" iddiasıdır, oysa
 * bilmiyor olabiliriz.
 */
function gelirDurumu(g: OrtakGirdisi): AsamaDurumu {
  if (!g.gelirOkunabildi) {
    return durum('gelir', 'dogrulanmadi', 'Gelir verisi okunamadı — sıfır olduğu anlamına gelmez.');
  }
  if (g.tahsilEdilenKurus > 0) {
    return durum('gelir', 'dogrulandi', 'Hesaba geçmiş komisyon var.');
  }
  if (g.donusumSayisi > 0) {
    return durum('gelir', 'beklemede', `${g.donusumSayisi} dönüşüm var; henüz tahsil edilmedi.`);
  }
  return durum('gelir', 'baslanmadi', 'Henüz dönüşüm yok.');
}

// ---------------------------------------------------------------------------
// Sonraki adım
// ---------------------------------------------------------------------------

/**
 * Boru hattındaki ilk tıkanıklığı bulup tek cümlelik bir eylem döner.
 *
 * SIRA ÖNEMLİ: aşamalar birbirine bağlıdır ve sonraki adım her zaman EN
 * ERKEN tıkanıklıktır. Feed adresi istemek, başvurusu bile gönderilmemiş
 * bir firmada boşa iştir.
 */
function sonrakiAdimBul(g: OrtakGirdisi, a: Record<OrtakAsamasi, AsamaDurumu>): string {
  if (a.basvuru.durum === 'engelli') {
    return 'Program kapalı — listeden çıkarın ya da alternatif advertiser bulun.';
  }
  if (a.basvuru.durum === 'baslanmadi') {
    return `Awin panelinde ${g.displayName} programına başvurun.`;
  }
  if (a.onay.durum === 'engelli') {
    return 'Ret sebebini kaydedin; gerekiyorsa yeniden başvuru koşullarını araştırın.';
  }
  if (a.onay.durum === 'beklemede') {
    return 'Awin panelinden başvuru sonucunu takip edin.';
  }
  if (a.onay.durum === 'dogrulanmadi') {
    return 'Onay kararının tarihini Awin panelinden alıp kaydedin.';
  }
  if (a.mid.durum !== 'dogrulandi' && g.network === 'awin') {
    return 'Awin panelinden advertiser kimliğini (MID) alıp kaydedin.';
  }
  if (g.termsVerifiedAt === null) {
    return 'Komisyon oranını ve çerez penceresini program şartlarından doğrulayıp kaydedin.';
  }
  if (a.feed.durum === 'baslanmadi' || a.feed.durum === 'beklemede') {
    return 'Ürün feed adresini alıp kaynak olarak tanımlayın.';
  }
  if (a.eslesme.durum !== 'dogrulandi') {
    return `Feed kolonlarını zorunlu alanlara eşleyin (${ZORUNLU_ESLESME_ALANLARI.join(', ')}).`;
  }
  if (a.deneme.durum === 'engelli') {
    return 'Son alım hatasını inceleyip düzeltin.';
  }
  if (a.deneme.durum !== 'dogrulandi') {
    return 'Kaynağı deneme olarak çalıştırın ve sonucu doğrulayın.';
  }
  if (a.yayin.durum === 'engelli') {
    return 'Yayın engelini giderin.';
  }
  if (a.yayin.durum !== 'dogrulandi') {
    return 'Kaynağı açıp mağazayı yayına alın.';
  }
  if (a.gelir.durum === 'dogrulanmadi') {
    return 'Gelir verisi okunamıyor — tahsilat kaynağını kontrol edin.';
  }
  if (a.gelir.durum !== 'dogrulandi') {
    return 'Yayında; ilk dönüşüm ve tahsilat bekleniyor.';
  }
  return 'Zincir tamam — komisyon akıyor.';
}

// ---------------------------------------------------------------------------
// Genel giriş noktası
// ---------------------------------------------------------------------------

export function ortakSatiriTuret(girdi: OrtakGirdisi): OrtakSatiri {
  const asamalar: Record<OrtakAsamasi, AsamaDurumu> = {
    advertiser: advertiserDurumu(girdi),
    mid: midDurumu(girdi),
    basvuru: basvuruDurumu(girdi),
    onay: onayDurumu(girdi),
    feed: feedDurumu(girdi),
    eslesme: eslesmeDurumu(girdi),
    deneme: denemeDurumu(girdi),
    yayin: yayinDurumu(girdi),
    gelir: gelirDurumu(girdi),
  };

  return { girdi, asamalar, sonrakiAdim: sonrakiAdimBul(girdi, asamalar) };
}

/**
 * Panel sıralaması.
 *
 * Önce ELİMİZDE İŞ OLANLAR: engelli satırlar dikkat ister, sonra
 * bekleyenler, sonra hiç başlanmamışlar, en sonda tamamlananlar. Aynı
 * gruptaysa bizim öncelik sıramız (partner_rank) karar verir.
 *
 * Alfabetik sıralama cazip ama işe yaramaz: operatörün sorusu "hangi harf?"
 * değil, "şimdi ne yapmalıyım?"dır.
 */
const GRUP_AGIRLIK: Record<KanitDurumu, number> = {
  engelli: 0,
  beklemede: 1,
  dogrulanmadi: 2,
  baslanmadi: 3,
  dogrulandi: 4,
};

export function ortakSatirlariSirala(satirlar: OrtakSatiri[]): OrtakSatiri[] {
  return [...satirlar].sort((a, b) => {
    const fa = GRUP_AGIRLIK[enErkenTikaniklik(a)];
    const fb = GRUP_AGIRLIK[enErkenTikaniklik(b)];
    if (fa !== fb) return fa - fb;

    const ra = a.girdi.partnerRank;
    const rb = b.girdi.partnerRank;
    // Sırası olmayanlar sona: sıra vermek bir önceliklendirme kararıdır ve
    // kararı verilmemiş satır, verilmişlerin önüne geçmemeli.
    if (ra === null && rb === null) return a.girdi.displayName.localeCompare(b.girdi.displayName, 'tr');
    if (ra === null) return 1;
    if (rb === null) return -1;
    return ra - rb;
  });
}

const ASAMA_SIRASI: OrtakAsamasi[] = [
  'basvuru', 'onay', 'mid', 'feed', 'eslesme', 'deneme', 'yayin', 'gelir',
];

/** Boru hattındaki ilk "tamam olmayan" aşamanın durumu. */
export function enErkenTikaniklik(satir: OrtakSatiri): KanitDurumu {
  for (const asama of ASAMA_SIRASI) {
    const d = satir.asamalar[asama].durum;
    if (d !== 'dogrulandi') return d;
  }
  return 'dogrulandi';
}

/**
 * Boru hattı özeti — panelin başlığındaki sayılar.
 *
 * Yüzde YOK. "Boru hattının %40'ı tamam" cümlesi, aşamaların eşit ağırlıkta
 * olduğunu varsayar; oysa onay almak ile feed eşlemek aynı iş değildir.
 * Uydurma bir ilerleme yüzdesi yerine sayılabilir olgular veriliyor.
 */
export interface OrtakOzeti {
  toplam: number;
  basvurulmadi: number;
  cevapBekleyen: number;
  onayli: number;
  yayinda: number;
  gelirGetiren: number;
  engelli: number;
}

export function ortakOzetiCikar(satirlar: OrtakSatiri[]): OrtakOzeti {
  return {
    toplam: satirlar.length,
    basvurulmadi: satirlar.filter((s) => s.asamalar.basvuru.durum === 'baslanmadi').length,
    cevapBekleyen: satirlar.filter((s) => s.asamalar.onay.durum === 'beklemede').length,
    onayli: satirlar.filter((s) => s.asamalar.onay.durum === 'dogrulandi').length,
    yayinda: satirlar.filter((s) => s.asamalar.yayin.durum === 'dogrulandi').length,
    gelirGetiren: satirlar.filter((s) => s.asamalar.gelir.durum === 'dogrulandi').length,
    engelli: satirlar.filter((s) => enErkenTikaniklik(s) === 'engelli').length,
  };
}

/** ISO zaman damgasını panelde okunur bir güne çevirir. */
function tarih(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
