'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';

/**
 * Başlık kilidi: arma + turuncu zemin üzerinde vaat.
 *
 * ARMANIN YAZISI NEDEN CANLI METİN?
 * Harflerin tek tek hareket edebilmesi için yazının metin olması gerekir;
 * tek parça PNG'de "a"ları ayrı ayrı büyütmek mümkün değil. Bu yüzden disk
 * bir görsel, üzerindeki "Ohaaaa" ise gerçek metin.
 *
 * Konum ve ölçü, armanın kendi çiziminden ÖLÇÜLEREK alındı (1024 piksellik
 * asılda yazı 771x155, merkezden %0,5 yukarıda). Oranlar aşağıda sabit;
 * arma boyutu değişse de yazı yerinde kalır.
 *
 * Yazı tipi Outfit — armanın çizildiği yazı tipiyle aynı. Farklı olsaydı
 * favicon ile başlık farklı harflerle yazılmış görünürdü.
 *
 * DOKUNMA
 * Animasyon yalnızca :hover'a bağlansaydı telefonda hiç çalışmazdı; dokunmalı
 * ekranda hover yoktur. Bu yüzden pointerdown ile bir sınıf ekleniyor ve
 * süre dolunca kaldırılıyor: parmak kalksa bile animasyon tamamlanır.
 */

const LETTERS = ['O', 'h', 'a', 'a', 'a', 'a'];

// Armadan ölçülen oranlar (bkz. assets/brand/ohaaaa-word-1024.png)
const WORD_WIDTH_RATIO = 0.753; // yazı genişliği / arma genişliği (asıldan ölçüldü)
// Punto katsayısı: canlı metin tarayıcıda ölçülüp asıldaki 0,753 oranına
// oturtuldu. Yazı tipi metriklerinden hesaplamak yerine ölçmek daha güvenli;
// Outfit'in ascender oranı sürümle değişebilir.
const WORD_SHIFT_RATIO = -0.005; // dikey kayma / arma yüksekliği

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
      className={`group -my-2 flex items-center py-2 ${className}`}
      aria-label="Ohaaaa ana sayfa"
    >
      <span className="relative z-10 block h-9 w-9 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ohaaaa-disc.png" alt="" width={36} height={36} className="h-9 w-9" />

        <span
          aria-hidden="true"
          className={`oha-word absolute inset-0 flex items-center justify-center ${
            tapped ? 'oha-word-tap' : ''
          }`}
          style={{
            transform: `translateY(${WORD_SHIFT_RATIO * 100}%)`,
            fontFamily: 'var(--font-outfit), sans-serif',
            fontSize: `${WORD_WIDTH_RATIO * 0.2706 * 36}px`,
          }}
        >
          {LETTERS.map((ch, i) => (
            <span
              key={`${ch}-${i}`}
              className="oha-letter"
              style={{ animationDelay: `${i * 55}ms` }}
            >
              {ch}
            </span>
          ))}
        </span>
      </span>

      <span className="-ml-4 rounded-r-full bg-gradient-to-r from-[#E9692A] via-[#D4501F] to-[#C13515] py-[7px] pl-5 pr-4 text-[15px] font-extrabold leading-none tracking-tight text-[#fffaf5] shadow-sm transition-transform duration-200 origin-left group-hover:scale-x-[1.02]">
        kargo dahil fiyat
      </span>
    </Link>
  );
}
