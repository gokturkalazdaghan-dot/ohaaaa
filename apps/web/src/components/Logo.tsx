'use client';

import Link from 'next/link';

/**
 * Ohaaaa arması — kelime işareti ve OHA monogramı.
 *
 * İKİ TASARIM KURALI, İKİSİ DE ÖLÇÜLEREK BULUNDU
 *
 * 1) OH BİRLEŞİK. O ile H bağımsız iki harf gibi durmamalı. Bu, negatif
 *    kern ile sağlanıyor: H'nin sol dikmesi O'nun sağ gövdesinin içine
 *    giriyor. Değer tahminle seçilmedi -- dört kademe (-0,10 / -0,15 /
 *    -0,20 / -0,25) 14px'ten 52px'e kadar ölçüldü:
 *      -0,10  harfler ayrı duruyor, bağ yok
 *      -0,15  değiyor ama kaynaşmıyor
 *      -0,20  gerçekten kaynaşıyor ve 14px'te hâlâ "OH" okunuyor  ← seçilen
 *      -0,25  O kesilmeye başlıyor, "Œ" gibi okunuyor
 *
 * 2) DÖRT A SOLDAN SAĞA BÜYÜR. Sesin yükselmesini yazıya çeviriyor.
 *    Rampa yine ölçülerek seçildi: daha yumuşak bir dizi (.82 .90 1.0 1.10)
 *    fark edilmiyordu, daha sert olanı (.64 .82 1.0 1.28) çocuk markası
 *    hissi veriyordu. Seçilen dizi belirgin ama kontrollü.
 *
 * NEDEN CANLI METİN, ÇİZİM DEĞİL?
 * Önce geometrik primitiflerle (daire + dikdörtgen) çizildi ve ölçüldü:
 * üç harf ağır konturlarla üst üste binince "OHA" değil "GIVA" gibi
 * okunuyordu. Gerçek harf formları 16px'te bile doğru okunuyor. Ayrıca
 * canlı metin kullanıcının yazı tipi ayarıyla ölçekleniyor.
 *
 * Yazı tipi Outfit — favicon ve arma da aynı harflerle çizildiği için
 * başlık ile sekme ikonu aynı dili konuşuyor.
 */

/**
 * H'nin İKİ YANI DA bağlı.
 *
 * O ile H arasındaki kern (-0,20em) daha önce ölçülmüştü. Ama H'nin sağ
 * tarafı açıkta kalıyordu: O ile H birleşik, A ise ayrı duruyordu. H'nin
 * ortada olması, iki yandan da bağlı olmasını gerektiriyor -- aksi halde
 * "birleşik OH + ayrı AAAA" gibi iki parça okunuyor.
 *
 * H→A kerni de aynı yöntemle ölçüldü (14px–52px, dört kademe):
 *    0      H ve A ayrı duruyor
 *   -0,06   değiyor
 *   -0,12   birleşiyor, 14px'te hâlâ okunuyor          ← seçilen
 *   -0,18   "HA" tek bir şekle dönüşüyor, okunurluk kayboluyor
 */
const OH_KERN = '-0.2em';
const HA_KERN = '-0.12em';

/** Dört A'nın göreli boyutu — soldan sağa büyür. */
const A_RAMPA = [0.7, 0.85, 1.0, 1.2] as const;

/**
 * OHA monogramı.
 *
 * Favicon, mobil başlık, uygulama ikonu ve sosyal avatar için. Tek parça
 * bir marka işareti gibi çalışması, OH birleşmesinden geliyor: üç harf
 * yan yana dizilmiş gibi değil, bağlı bir işaret gibi okunuyor.
 */
export function Monogram({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      /*
        `display` SINIFI BURADA YOK ve bu kasıtlı.
        Önce base sınıfta `inline-flex` vardı; çağıran taraf `hidden`
        geçtiğinde ikisi aynı özgüllükte çakışıyor ve stil sırasına göre
        `inline-flex` kazanıyordu. Sonuç mobil başlıkta "OHAAAAOHA" idi --
        kelime ve monogram aynı anda çiziliyordu (ölçüldü). Display kararı
        artık tek yerde: çağıran tarafta.
      */
      className={`items-baseline font-bold leading-none tracking-tight ${className}`}
      style={{ fontFamily: 'var(--font-outfit), sans-serif' }}
    >
      <span style={{ letterSpacing: OH_KERN }}>O</span>
      <span style={{ letterSpacing: HA_KERN }}>H</span>
      <span>A</span>
    </span>
  );
}

/** Tam kelime işareti: OHAAAA. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      /* `display` sınıfı yok — gerekçe Monogram'da yazılı. */
      className={`items-baseline font-bold leading-none tracking-tight ${className}`}
      style={{ fontFamily: 'var(--font-outfit), sans-serif' }}
    >
      <span style={{ letterSpacing: OH_KERN }}>O</span>
      <span style={{ letterSpacing: HA_KERN }}>H</span>
      {A_RAMPA.map((oran, i) => (
        <span key={i} style={{ fontSize: `${oran}em` }}>
          A
        </span>
      ))}
    </span>
  );
}

/**
 * Başlıktaki arma kilidi.
 *
 * Masaüstünde tam kelime, dar ekranda yalnızca monogram: 390px'lik bir
 * telefonda altı harflik kelime, aramanın ve sepetin yerini yiyordu.
 *
 * Erişilebilir ad BAĞLANTIDA; harfler `aria-hidden` çünkü ekran okuyucu
 * onları tek tek okursa "O, H, A, A, A, A" duyulur.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Ohaaaa ana sayfa"
      /*
        ANA KOMBİNASYON: turuncu arma, bej zemin. Koyu bir arma da geçerli
        bir varyant ama birincil olan bu -- arma markanın tanınma noktası ve
        turuncu, Ohaaaa'yı bir bakışta ayırt eden şey.
      */
      className={`group inline-flex items-center text-brand transition-opacity hover:opacity-80 ${className}`}
    >
      <Wordmark className="hidden text-[1.35rem] sm:inline-flex" />
      <Monogram className="inline-flex text-[1.35rem] sm:hidden" />
    </Link>
  );
}
