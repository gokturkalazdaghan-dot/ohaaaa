'use client';

import Link from 'next/link';

/**
 * Ohaaaa.com arma kilidi.
 *
 * RESMİ MARKA ADI TEK: `Ohaaaa.com`. Kısaltılmaz, `.com`'suz yazılmaz.
 * Eskiden dar ekranda `OHA` monogramı çiziliyordu; o kısaltma kaldırıldı.
 * Mobil ile masaüstü artık AYNI kelime işaretini gösterir, yalnızca punto
 * farklıdır.
 *
 * ÜÇ TASARIM KURALI
 *
 * 1) TURUNCU ZEMİN, BEYAZ YAZI. Arma bir levha olarak çizilir. Zemin
 *    `--brand-cta` (#b84f14) -- globals.css'te zaten "DOLGU olarak
 *    kullanılan turuncu; üstünde beyaz yazı" diye tanımlı token bu. Beyaza
 *    karşı ölçülen kontrast 5,04:1, yani AA sınırının üstünde. Metin rengi
 *    olarak kullanılan `--brand` DEĞİL: o açık zeminde okunmak için koyu
 *    seçilmiş, dolgu üstünde beyazla yeterli kontrast vermiyor.
 *
 * 2) O + h BİRLEŞİK. Negatif kern ile h'nin sol dikmesi O'nun gövdesine
 *    yaklaşır. Değer ölçülerek bulundu: ilk denemede -0,20em kullanıldı
 *    (eski büyük harfli `OH` için ölçülmüş değer) ama küçük harfli `h` ile
 *    300px'te "Oh" tek bir lekeye dönüştü. -0,12em'de harfler değiyor,
 *    bağ kuruluyor ve 14px'e kadar "Oh" okunmaya devam ediyor.
 *
 * 3) DÖRT KÜÇÜK a KADEMELİ BÜYÜR. İlk a normal punto, son a görsel zirve.
 *    Rampa uydurulmadı: eski armadaki ölçülmüş [0,70 0,85 1,00 1,20] dizisi
 *    1/0,70 ile ölçeklendi. Oranlar korunuyor, dizi "ilk a normal" olacak
 *    şekilde 1,00'den başlıyor.
 *
 * NEDEN CANLI METİN, GÖRSEL DEĞİL
 * Kullanıcının yazı tipi boyutu ayarıyla ölçekleniyor, tema/piksel
 * yoğunluğundan bağımsız keskin kalıyor ve ek ağ isteği getirmiyor.
 *
 * Buradaki sayılar `scripts/verify-brand.mjs` ile korunuyor: harf dizisi
 * ayrı `<span>`'lere bölündüğü için kaynakta "Ohaaaa" dizgisi geçmez,
 * yani yazım denetçisi a sayısını göremez. O yüzden `verify-browser.mjs`
 * ÇİZİLEN metni okuyup `Ohaaaa.com` olduğunu ayrıca doğruluyor.
 */

/** O → h kerni. h'nin dikmesi O'nun gövdesine girer. */
const OH_KERN = -0.12;

/** h → ilk a kerni. h iki yandan da bağlı kalsın diye. */
const HA_KERN = -0.045;

/**
 * Dört a'nın göreli puntosu — soldan sağa büyür, son a zirve.
 * Eski [0,70 0,85 1,00 1,20] rampasının 1/0,70 ile ölçeklenmişi.
 */
const A_RAMPA = [1.0, 1.21, 1.43, 1.71] as const;

/**
 * a'lar arası düzeltme (taban em cinsinden).
 *
 * Harf büyüdükçe kendi yan boşlukları da büyür; düzeltme olmadan son
 * çiftin arası ilk çiftinkinden gözle görülür şekilde açılıyor. Negatif
 * düzeltme ritmi eşitliyor.
 */
const AA_DUZELTME = -0.02;

/**
 * `.com` puntosu ve ondan önceki boşluk (taban em cinsinden).
 *
 * Oran 0,42 ile başlamıştı (büyük format armada dengeli duruyordu) ama
 * başlıkta ÖLÇÜLDÜĞÜNDE `.com` 6,7px'e düşüyor ve okunmuyordu: arma
 * "Ohaaaa" artı bir leke gibi görünüyordu. 0,52'de başlıkta 11,2px'e
 * çıkıyor ve okunuyor; büyük formatta da hâlâ kelime işaretinin açıkça
 * altında kalıyor. Tek oran her iki ölçekte de geçerli, bu yüzden basılı
 * arma ile ekrandaki arma AYNI kilidi kullanıyor.
 */
const COM_ORAN = 0.52;
const COM_BOSLUK = 0.075;

/**
 * `letter-spacing` yazıldığı elemanın KENDİ puntosuyla ölçeklenir.
 * Bizim istediğimiz boşluklar ise taban em cinsinden tanımlı. Bu yüzden
 * her değer, yazıldığı harfin kendi oranına bölünerek çevriliyor —
 * aksi halde büyüyen a'larda boşluk da büyür ve ritim bozulur.
 */
function kern(tabanEm: number, harfOrani: number): string {
  return `${(tabanEm / harfOrani).toFixed(4)}em`;
}

/**
 * Kelime işareti: Ohaaaa.com.
 *
 * Harfler `aria-hidden`: ekran okuyucu tek tek okursa "O, h, a, a, a, a,
 * nokta, c, o, m" duyulur. Erişilebilir ad çağıran tarafta (bağlantıda).
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      /*
        `display` SINIFI BURADA YOK ve bu kasıtlı. Base sınıfta `inline-flex`
        varken çağıran taraf `hidden` geçtiğinde ikisi aynı özgüllükte
        çakışıyor ve stil sırasına göre `inline-flex` kazanıyordu. Display
        kararı tek yerde: çağıran tarafta.
      */
      className={`items-baseline font-bold leading-none ${className}`}
      style={{ fontFamily: 'var(--font-outfit), sans-serif' }}
    >
      <span style={{ letterSpacing: kern(OH_KERN, 1) }}>O</span>
      <span style={{ letterSpacing: kern(HA_KERN, 1) }}>h</span>
      {A_RAMPA.map((oran, i) => {
        const sonraki = A_RAMPA[i + 1];
        // Son a'dan sonra gelen `.com`, diğerlerinden sonra bir sonraki a.
        const bosluk = sonraki === undefined ? COM_BOSLUK : AA_DUZELTME * sonraki;
        return (
          <span key={i} style={{ fontSize: `${oran}em`, letterSpacing: kern(bosluk, oran) }}>
            a
          </span>
        );
      })}
      <span style={{ fontSize: `${COM_ORAN}em` }}>.com</span>
    </span>
  );
}

/**
 * Başlıktaki arma kilidi.
 *
 * Erişilebilir ad BAĞLANTIDA çünkü harfler `aria-hidden`.
 *
 * PUNTO BASAMAKLARI ÖLÇÜLEREK SEÇİLDİ, göz kararı değil. Dar ekranda üst
 * satırda arma ile birlikte hesap, favori ve (pazar yeri modunda) sepet
 * düğmeleri var. Gerçek tarayıcıda üç genişlikte taşma ölçüldü:
 *
 *   320px ekran, 1,00rem -> levha 109px, taşma 0        ← seçilen
 *   320px ekran, 1,15rem -> levha 122px, taşma 3px      (sığmıyor)
 *   360px ekran, 1,15rem -> levha 122px, taşma 0        ← seçilen
 *   640px+     , 1,35rem -> levha 144px, `.com` 11,2px  ← seçilen
 *
 * Yani en dar telefonda arma küçülür ama kısalmaz: marka adı her ekranda
 * tam hâliyle `Ohaaaa.com` kalır.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Ohaaaa.com ana sayfa"
      className={`inline-flex shrink-0 items-center rounded-lg px-2.5 py-1.5 text-white transition-opacity hover:opacity-90 sm:px-3 ${className}`}
      style={{ backgroundColor: 'var(--brand-cta)' }}
    >
      <Wordmark className="inline-flex text-[1rem] min-[360px]:text-[1.15rem] sm:text-[1.35rem]" />
    </Link>
  );
}
