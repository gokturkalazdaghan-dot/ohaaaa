'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';

/**
 * Ohaaaa arması.
 *
 * MARKA İMZASI: HARFLER SOLDAN SAĞA KÜÇÜLÜR.
 * O h a a a a — ilk harf en güçlü, her harf bir öncekinden küçük. Bu
 * dekoratif bir ayrıntı değil; markanın tanınma işareti. Sesin sönümlenmesini
 * ("ohaaaa" derken sesin azalması) yazıya çeviriyor ve altı harfli bir
 * kelimeyi tek bakışta ayırt edilir kılıyor.
 *
 * ORTAK TABAN ÇİZGİSİ ŞART. Harfler `items-baseline` ile hizalanır; ortadan
 * hizalansalardı küçülen harfler havada asılı kalır ve kademe bir dalga
 * değil, dağınıklık gibi okunurdu.
 *
 * NEDEN CANLI METİN, PNG DEĞİL?
 * Harflerin tek tek hareket edebilmesi için metin olmalı. Ayrıca kademeli
 * boyut, kullanıcının yazı tipi ayarıyla birlikte ölçeklenir — sabit
 * piksellik bir görselde bu olmaz.
 *
 * DOKUNMA
 * Animasyon yalnızca :hover'a bağlansaydı telefonda hiç çalışmazdı; dokunmalı
 * ekranda hover yoktur. Bu yüzden pointerdown ile bir sınıf ekleniyor ve
 * süre dolunca kaldırılıyor: parmak kalksa bile animasyon tamamlanır.
 */

/**
 * Harfler ve göreli boyutları.
 *
 * Oran dizisi düz bir aritmetik iniş DEĞİL: baştaki düşüş daha keskin,
 * sona doğru yumuşuyor. Eşit adımlarla inen bir dizi, son "a"ları okunmaz
 * hale getiriyordu.
 */
const HARFLER: Array<{ ch: string; olcek: number }> = [
  { ch: 'O', olcek: 1 },
  { ch: 'h', olcek: 0.84 },
  { ch: 'a', olcek: 0.72 },
  { ch: 'a', olcek: 0.63 },
  { ch: 'a', olcek: 0.56 },
  { ch: 'a', olcek: 0.5 },
];

/** Son harfin animasyonu bitene kadar geçen süre. */
const TAP_MS = 640;

export function Logo({ className = '' }: { className?: string }) {
  const [tapped, setTapped] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const play = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setTapped(true);
    timer.current = setTimeout(() => setTapped(false), TAP_MS);
  }, []);

  return (
    <Link
      href="/"
      onPointerDown={play}
      /*
        Erişilebilir ad ARMANIN KENDİSİNDE. Harfler `aria-hidden` çünkü
        ekran okuyucu onları tek tek okursa "O, h, a, a, a, a" duyulur.
      */
      aria-label="Ohaaaa ana sayfa"
      className={`group -my-2 flex items-center gap-2 py-2 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/ohaaaa-disc.png"
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 shrink-0"
      />

      <span
        aria-hidden="true"
        className={`oha-word flex items-baseline ${tapped ? 'oha-word-tap' : ''}`}
        style={{ fontFamily: 'var(--font-outfit), sans-serif' }}
      >
        {HARFLER.map(({ ch, olcek }, i) => (
          <span
            key={`${ch}-${i}`}
            className="oha-letter font-bold leading-none tracking-tight text-fg"
            style={{
              fontSize: `${olcek * 1.5}rem`,
              animationDelay: `${i * 62}ms`,
              /*
                Küçülen harfler arasındaki boşluk da küçülmeli; sabit boşluk
                bırakılsaydı sondaki küçük "a"lar birbirinden kopardı.
              */
              marginLeft: i === 0 ? 0 : `${-0.02 * olcek}em`,
            }}
          >
            {ch}
          </span>
        ))}
      </span>
    </Link>
  );
}
