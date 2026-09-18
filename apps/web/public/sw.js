/*
 * Ohaaaa servis çalışanı — KASITLI OLARAK ASGARİ.
 *
 * NEDEN VAR
 * Chrome bir siteyi ancak "fetch olayını dinleyen kayıtlı bir servis
 * çalışanı" varsa kurulabilir sayar ve yükleme istemini ancak o zaman
 * açar. Yani bu dosya olmadan Android'de gerçek kurulum düğmesi HİÇ
 * çıkmaz.
 *
 * NEYİ ÖNBELLEĞE ALMIYOR VE NEDEN
 * Hiçbir HTML, hiçbir API yanıtı, hiçbir görsel, hiçbir betik.
 *
 * Ohaaaa bir fiyat karşılaştırma sitesi: önbelleğe alınmış bir ürün
 * sayfası, kullanıcıya ARTIK GEÇERLİ OLMAYAN bir fiyat göstermek demek.
 * Aynı şekilde önbelleğe alınmış bir sayfa, oturumu kapanmış kullanıcıya
 * başkasının oturumundan kalan bir başlık gösterebilir. Ortaklık
 * yönlendirmeleri (`/git/...`) ve API uçları ise her seferinde sunucuya
 * ulaşmak zorunda -- önbellekten dönen bir tıklama, ölçülmemiş ve
 * dolayısıyla ödenmemiş bir tıklamadır.
 *
 * Bu yüzden `fetch` dinleyicisi, GEZİNME DIŞINDAKİ her isteği
 * `respondWith` çağırmadan bırakır: tarayıcı o istekleri servis çalışanı
 * hiç yokmuş gibi, doğrudan ağdan alır. Gezinme isteklerinde de önce ağ
 * denenir; önbellek YALNIZCA ağ tamamen başarısız olduğunda (gerçekten
 * çevrimdışıyken) devreye girer ve tek bir bilgilendirme sayfası döner.
 *
 * Sonuç: sitenin çalışan hiçbir davranışı değişmiyor, yalnızca
 * kurulabilirlik ve çevrimdışı bir kapak ekleniyor.
 */

const SURUM = 'ohaaaa-kabuk-v1';
const CEVRIMDISI = '/cevrimdisi.html';

self.addEventListener('install', (olay) => {
  olay.waitUntil(
    caches
      .open(SURUM)
      .then((onbellek) => onbellek.addAll([CEVRIMDISI]))
      /*
       * `skipWaiting`: yeni sürüm eski sekmelerin kapanmasını beklemeden
       * devreye girer. Bu dosyada düzeltilmesi gereken bir şey çıkarsa
       * düzeltmenin kullanıcıya ulaşması gün değil saniye sürmeli.
       */
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (olay) => {
  olay.waitUntil(
    caches
      .keys()
      .then((adlar) =>
        Promise.all(adlar.filter((ad) => ad !== SURUM).map((ad) => caches.delete(ad))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (olay) => {
  const istek = olay.request;

  // Yalnızca GET: POST/PUT yanıtları önbelleklenemez ve edilmemeli.
  if (istek.method !== 'GET') return;

  /*
   * Yalnızca GEZİNME (adres çubuğuna girilen / bağlantıya tıklanan sayfa
   * istekleri). Görseller, betikler, stiller, API çağrıları ve ortaklık
   * yönlendirmeleri bu dalın dışında kalır ve hiç dokunulmaz.
   */
  if (istek.mode !== 'navigate') return;

  // Dış alan adına giden gezinmeler bizi ilgilendirmez.
  if (new URL(istek.url).origin !== self.location.origin) return;

  olay.respondWith(
    fetch(istek).catch(() =>
      caches.match(CEVRIMDISI).then((yanit) => yanit ?? Response.error()),
    ),
  );
});
