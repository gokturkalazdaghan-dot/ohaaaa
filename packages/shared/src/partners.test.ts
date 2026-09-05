import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  eksikEslesmeAlanlari,
  enErkenTikaniklik,
  ortakOzetiCikar,
  ortakSatiriTuret,
  ortakSatirlariSirala,
  type OrtakGirdisi,
  type OrtakKaynagi,
} from './partners.js';

/**
 * Bu testlerin ortak sorusu tek bir cümledir:
 *
 *   Elimizde olmayan bir bilgi, panelde bir CEVAP gibi görünüyor mu?
 *
 * Türetme kurallarını sınamak kolay tarafı; asıl değer, "boş alan" ile
 * "olumsuz cevap"ın birbirine karışmadığını kanıtlamakta. Bu ikisi
 * karışırsa panel operatöre yanlış işi yaptırır ve hata hiçbir yerde
 * kendini göstermez -- yalnızca kaybedilen gelirde.
 */

function aday(ustuneYaz: Partial<OrtakGirdisi> = {}): OrtakGirdisi {
  return {
    slug: 'ornek-advertiser',
    displayName: 'Örnek Advertiser',
    partnerRank: 3,
    network: 'awin',
    status: 'prospect',
    applicationStatus: 'not_started',
    applicationSubmittedAt: null,
    approvedAt: null,
    rejectedAt: null,
    networkAdvertiserId: null,
    termsVerifiedAt: null,
    deeplinkTemplate: null,
    kaynaklar: [],
    donusumSayisi: 0,
    tahsilEdilenKurus: 0,
    gelirOkunabildi: true,
    ...ustuneYaz,
  };
}

function kaynak(ustuneYaz: Partial<OrtakKaynagi> = {}): OrtakKaynagi {
  return {
    slug: 'ornek-feed',
    kind: 'feed_csv',
    endpointUrl: 'https://ornek.gecersiz/feed.csv',
    fieldMapping: {
      external_id: 'id',
      title: 'name',
      price: 'price',
      url: 'link',
    },
    isEnabled: false,
    lastRunAt: null,
    lastStatus: null,
    ...ustuneYaz,
  };
}

// ---------------------------------------------------------------------------
// EKSİK VERİ, ASLA "DOĞRULANDI" DEĞİL
// ---------------------------------------------------------------------------

test('bos bir aday kaydinda HICBIR asama dogrulanmis sayilmaz', () => {
  const satir = ortakSatiriTuret(aday());

  const dogrulanan = Object.values(satir.asamalar)
    .filter((a) => a.durum === 'dogrulandi')
    .map((a) => a.asama);

  /*
   * `advertiser` sütunu bir çapa: satırın kendisi elimizde. Onun dışında
   * hiçbir aşama, kanıt olmadan yeşile dönmemeli.
   */
  assert.deepEqual(dogrulanan, ['advertiser']);
});

test('MID yoklugu DOGRULANMADI olarak raporlanir -- "MID yok" iddiasi degil', () => {
  const satir = ortakSatiriTuret(aday());
  assert.equal(satir.asamalar.mid.durum, 'dogrulanmadi');

  /*
   * EN KRİTİK AYRIM. `baslanmadi` "biz yapmadık" demek; MID'i biz
   * üretmiyoruz, ağ veriyor. Yokluğu bizim eksiğimiz değil, bilgimizin
   * eksikliğidir ve panelde öyle görünmelidir.
   */
  assert.notEqual(satir.asamalar.mid.durum, 'baslanmadi');
});

test('basvurulmamis olmak BILGIDIR: baslanmadi, dogrulanmadi degil', () => {
  const satir = ortakSatiriTuret(aday({ applicationStatus: 'not_started' }));

  // Kendi eylemimiz olduğu için yokluğundan EMİNİZ.
  assert.equal(satir.asamalar.basvuru.durum, 'baslanmadi');
  assert.equal(satir.asamalar.onay.durum, 'baslanmadi');
});

test('gonderilmis basvuru ONAY DEGILDIR', () => {
  const satir = ortakSatiriTuret(aday({ applicationStatus: 'submitted' }));

  assert.equal(satir.asamalar.basvuru.durum, 'beklemede');

  /*
   * Bu testin tek amacı: "başvurduk" ile "ortak olduk" arasındaki çizgiyi
   * korumak. Bu çizgi silinirse panel, hiç onaylanmamış bir programı
   * bağlanmaya hazır gösterir ve o iş boşa yapılır.
   */
  assert.equal(satir.asamalar.onay.durum, 'beklemede');
  assert.notEqual(satir.asamalar.onay.durum, 'dogrulandi');
});

test('tarihli onay dogrulanir, tarihsiz "approved" DOGRULANMAZ', () => {
  const onayli = ortakSatiriTuret(
    aday({ applicationStatus: 'approved', approvedAt: '2026-08-01T09:00:00Z' }),
  );
  assert.equal(onayli.asamalar.onay.durum, 'dogrulandi');
  assert.match(onayli.asamalar.onay.gerekce, /2026-08-01/);

  /*
   * Veritabanı kısıtı tarihsiz onayı zaten engelliyor. Bu iddia, kısıt bir
   * gün gevşetilirse kodun kendi başına da yalan söylememesini garanti
   * ediyor -- iki katman, tek doğru.
   */
  const tarihsiz = ortakSatiriTuret(aday({ applicationStatus: 'approved', approvedAt: null }));
  assert.equal(tarihsiz.asamalar.onay.durum, 'dogrulanmadi');
});

test('ret OLUMSUZ KANITTIR: engelli, eksik veri degil', () => {
  const satir = ortakSatiriTuret(
    aday({ applicationStatus: 'rejected', rejectedAt: '2026-08-02T09:00:00Z' }),
  );
  assert.equal(satir.asamalar.onay.durum, 'engelli');
  assert.equal(satir.asamalar.basvuru.durum, 'engelli');
});

// ---------------------------------------------------------------------------
// FEED / EŞLEŞME / DENEME
// ---------------------------------------------------------------------------

test('kaynak yoksa feed BASLANMADI -- kendi yapilandirmamiz oldugu icin eminiz', () => {
  const satir = ortakSatiriTuret(aday({ kaynaklar: [] }));
  assert.equal(satir.asamalar.feed.durum, 'baslanmadi');
  assert.equal(satir.asamalar.eslesme.durum, 'baslanmadi');
  assert.equal(satir.asamalar.deneme.durum, 'baslanmadi');
});

test('eksik eslesme alani DOGRULANMIS sayilmaz', () => {
  const eksik = kaynak({ fieldMapping: { external_id: 'id', title: 'name' } });
  const satir = ortakSatiriTuret(aday({ kaynaklar: [eksik] }));

  assert.equal(satir.asamalar.feed.durum, 'dogrulandi');
  assert.equal(satir.asamalar.eslesme.durum, 'beklemede');
  assert.match(satir.asamalar.eslesme.gerekce, /price/);
  assert.match(satir.asamalar.eslesme.gerekce, /url/);
});

test('bos dizgi eslenmiş sayilmaz', () => {
  /*
   * `{"price": ""}` bir eşleme DEĞİLDİR ama JSON'da alan "var" görünür.
   * Yalnızca anahtarın varlığına bakan bir kontrol burayı yeşil geçerdi ve
   * ilk gerçek alımda her satır fiyatsız düşerdi.
   */
  assert.deepEqual(
    eksikEslesmeAlanlari({ external_id: 'id', title: 't', price: '   ', url: 'u' }),
    ['price'],
  );
  assert.deepEqual(eksikEslesmeAlanlari({ external_id: 'id', title: 't', price: 'p', url: 'u' }), []);
});

test('basarisiz alim ENGELLI -- "henuz yapilmadi" degil', () => {
  const satir = ortakSatiriTuret(
    aday({ kaynaklar: [kaynak({ lastRunAt: '2026-08-10T00:00:00Z', lastStatus: 'failed' })] }),
  );

  /*
   * Bu ayrım doğrudan işi değiştirir: `baslanmadi` "çalıştır" der,
   * `engelli` "hatayı düzelt" der. Karıştırmak, aynı hatayı tekrar tekrar
   * çalıştırmak demektir.
   */
  assert.equal(satir.asamalar.deneme.durum, 'engelli');
});

test('alim hatasi SONRAKI ADIM olur -- ancak onundeki asamalar tamamsa', () => {
  /*
   * Bu test ilk yazılışında YANLIŞ FİKSTÜRLE düşmüştü: başvurusu bile
   * gönderilmemiş bir firmaya feed hatası düzelttirmeye çalışıyordu.
   * Türetme haklıydı, test haksızdı -- ve bu tam olarak kuralın kendisi:
   * sonraki adım her zaman EN ERKEN tıkanıklıktır. Feed hatası, ancak
   * onay ve MID elde edildikten sonra sıradaki iştir.
   */
  const satir = ortakSatiriTuret(
    aday({
      applicationStatus: 'approved',
      approvedAt: '2026-08-01T00:00:00Z',
      networkAdvertiserId: '123456',
      termsVerifiedAt: '2026-08-02T00:00:00Z',
      kaynaklar: [kaynak({ lastRunAt: '2026-08-10T00:00:00Z', lastStatus: 'failed' })],
    }),
  );

  assert.equal(satir.asamalar.deneme.durum, 'engelli');
  assert.match(satir.sonrakiAdim, /hatas/i);
});

test('sonucu yazilmamis calisma DOGRULANMADI', () => {
  const satir = ortakSatiriTuret(
    aday({ kaynaklar: [kaynak({ lastRunAt: '2026-08-10T00:00:00Z', lastStatus: null })] }),
  );
  assert.equal(satir.asamalar.deneme.durum, 'dogrulanmadi');
});

// ---------------------------------------------------------------------------
// YAYIN
// ---------------------------------------------------------------------------

test('aktif magaza acik kaynak olmadan YAYINDA sayilmaz', () => {
  const satir = ortakSatiriTuret(
    aday({
      status: 'active',
      deeplinkTemplate: '{url}?sub={subid}',
      kaynaklar: [kaynak({ isEnabled: false, lastRunAt: '2026-08-10T00:00:00Z', lastStatus: 'success' })],
    }),
  );
  assert.equal(satir.asamalar.yayin.durum, 'beklemede');
});

test('uc sart birlikte saglandiginda yayin DOGRULANIR', () => {
  const satir = ortakSatiriTuret(
    aday({
      status: 'active',
      deeplinkTemplate: '{url}?sub={subid}',
      kaynaklar: [kaynak({ isEnabled: true, lastRunAt: '2026-08-10T00:00:00Z', lastStatus: 'success' })],
    }),
  );
  assert.equal(satir.asamalar.yayin.durum, 'dogrulandi');
});

test('duraklatilmis ortaklik ENGELLI', () => {
  const satir = ortakSatiriTuret(aday({ status: 'paused' }));
  assert.equal(satir.asamalar.yayin.durum, 'engelli');
});

// ---------------------------------------------------------------------------
// GELİR — okunamadı ≠ sıfır
// ---------------------------------------------------------------------------

test('gelir OKUNAMADIYSA sifir gosterilmez', () => {
  const satir = ortakSatiriTuret(aday({ gelirOkunabildi: false }));

  /*
   * Tahsilat sayfasının koruduğu ayrımın aynısı. "0 TL" yazmak "hiç
   * kazanmadık" iddiasıdır; okunamayan bir tabloda bu iddiayı yapamayız.
   */
  assert.equal(satir.asamalar.gelir.durum, 'dogrulanmadi');
  assert.match(satir.asamalar.gelir.gerekce, /sıfır olduğu anlamına gelmez/);
});

test('donusum var ama tahsilat yoksa gelir BEKLEMEDE', () => {
  const satir = ortakSatiriTuret(aday({ donusumSayisi: 4, tahsilEdilenKurus: 0 }));
  assert.equal(satir.asamalar.gelir.durum, 'beklemede');
});

test('tahsil edilmis komisyon geliri DOGRULAR', () => {
  const satir = ortakSatiriTuret(aday({ donusumSayisi: 4, tahsilEdilenKurus: 12_500 }));
  assert.equal(satir.asamalar.gelir.durum, 'dogrulandi');
});

// ---------------------------------------------------------------------------
// SONRAKİ ADIM — en erken tıkanıklık
// ---------------------------------------------------------------------------

test('sonraki adim EN ERKEN tikanikligi gosterir, sonrakileri degil', () => {
  /*
   * Başvurusu gönderilmemiş bir firmada "feed adresini al" demek, yapılamaz
   * bir işi önermektir: feed'i ancak onaylanmış bir program verir.
   */
  const satir = ortakSatiriTuret(aday({ applicationStatus: 'not_started' }));
  assert.match(satir.sonrakiAdim, /başvurun/i);
});

test('onaylandiktan sonra sirada MID var', () => {
  const satir = ortakSatiriTuret(
    aday({ applicationStatus: 'approved', approvedAt: '2026-08-01T00:00:00Z' }),
  );
  assert.match(satir.sonrakiAdim, /MID/);
});

test('MID bilindiginde sirada DOGRULANMAMIS program sartlari var', () => {
  const satir = ortakSatiriTuret(
    aday({
      applicationStatus: 'approved',
      approvedAt: '2026-08-01T00:00:00Z',
      networkAdvertiserId: '123456',
      termsVerifiedAt: null,
    }),
  );

  /*
   * Komisyon oranı ve çerez penceresi doğrulanmadan feed bağlamak,
   * varsayılan 1 günlük pencereyle yayına girme riskini taşır: gerçek
   * pencere 30 günse aradaki dönüşümler sessizce reddedilir.
   */
  assert.match(satir.sonrakiAdim, /çerez penceresi/i);
});

test('zincir tamamlandiginda sonraki adim komisyonun aktigini soyler', () => {
  const satir = ortakSatiriTuret(
    aday({
      status: 'active',
      applicationStatus: 'approved',
      approvedAt: '2026-08-01T00:00:00Z',
      networkAdvertiserId: '123456',
      termsVerifiedAt: '2026-08-02T00:00:00Z',
      deeplinkTemplate: '{url}?sub={subid}',
      kaynaklar: [kaynak({ isEnabled: true, lastRunAt: '2026-08-10T00:00:00Z', lastStatus: 'success' })],
      donusumSayisi: 3,
      tahsilEdilenKurus: 9_900,
    }),
  );
  assert.equal(enErkenTikaniklik(satir), 'dogrulandi');
  assert.match(satir.sonrakiAdim, /Zincir tamam/);
});

// ---------------------------------------------------------------------------
// SIRALAMA VE ÖZET
// ---------------------------------------------------------------------------

test('siralama once IS OLAN satirlari getirir, sonra kendi onceligimize bakar', () => {
  const engelli = ortakSatiriTuret(
    aday({ slug: 'a', displayName: 'A', partnerRank: 60, applicationStatus: 'rejected', rejectedAt: '2026-08-01T00:00:00Z' }),
  );
  const bekleyen = ortakSatiriTuret(
    aday({ slug: 'b', displayName: 'B', partnerRank: 40, applicationStatus: 'submitted' }),
  );
  const baslanmamisErken = ortakSatiriTuret(aday({ slug: 'c', displayName: 'C', partnerRank: 3 }));
  const baslanmamisGec = ortakSatiriTuret(aday({ slug: 'd', displayName: 'D', partnerRank: 65 }));

  const sirali = ortakSatirlariSirala([baslanmamisGec, baslanmamisErken, bekleyen, engelli]);

  assert.deepEqual(sirali.map((s) => s.girdi.slug), ['a', 'b', 'c', 'd']);
});

test('sira numarasi olmayan satir, olanlarin ONUNE GECMEZ', () => {
  const sirasiz = ortakSatiriTuret(aday({ slug: 'sirasiz', displayName: 'Sirasiz', partnerRank: null }));
  const sirali = ortakSatiriTuret(aday({ slug: 'sirali', displayName: 'Sirali', partnerRank: 65 }));

  const sonuc = ortakSatirlariSirala([sirasiz, sirali]);
  assert.deepEqual(sonuc.map((s) => s.girdi.slug), ['sirali', 'sirasiz']);
});

test('ozet sayilabilir olgular verir, uydurma bir yuzde vermez', () => {
  const satirlar = [
    ortakSatiriTuret(aday({ slug: 'a', applicationStatus: 'not_started' })),
    ortakSatiriTuret(aday({ slug: 'b', applicationStatus: 'submitted' })),
    ortakSatiriTuret(
      aday({ slug: 'c', applicationStatus: 'approved', approvedAt: '2026-08-01T00:00:00Z' }),
    ),
    ortakSatiriTuret(
      aday({ slug: 'd', applicationStatus: 'rejected', rejectedAt: '2026-08-01T00:00:00Z' }),
    ),
  ];

  const ozet = ortakOzetiCikar(satirlar);
  assert.equal(ozet.toplam, 4);
  assert.equal(ozet.basvurulmadi, 1);
  assert.equal(ozet.cevapBekleyen, 1);
  assert.equal(ozet.onayli, 1);
  assert.equal(ozet.engelli, 1);
  assert.equal(ozet.yayinda, 0);
  assert.equal(ozet.gelirGetiren, 0);
});

test('20 advertiser kisa listesinin gercek sekli: hicbiri onayli gorunmez', () => {
  /*
   * Veri göçünün yazdığı satırların birebir şekli. Bu test, panelin o
   * satırları "onaylandı" ya da "yayında" gibi göstermediğini kanıtlar --
   * elimizde yalnızca "başvuru gönderildi" beyanı var.
   */
  const gonderilmis = Array.from({ length: 10 }, (_, i) =>
    ortakSatiriTuret(aday({ slug: `g${i}`, partnerRank: i + 1, applicationStatus: 'submitted' })),
  );
  const baslanmamis = Array.from({ length: 10 }, (_, i) =>
    ortakSatiriTuret(aday({ slug: `b${i}`, partnerRank: i + 11, applicationStatus: 'not_started' })),
  );

  const ozet = ortakOzetiCikar([...gonderilmis, ...baslanmamis]);
  assert.equal(ozet.toplam, 20);
  assert.equal(ozet.cevapBekleyen, 10);
  assert.equal(ozet.basvurulmadi, 10);
  assert.equal(ozet.onayli, 0);
  assert.equal(ozet.yayinda, 0);
  assert.equal(ozet.gelirGetiren, 0);
});
