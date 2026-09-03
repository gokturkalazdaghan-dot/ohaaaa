'use client';

import { useEffect, useRef, useState } from 'react';

import { CheckIcon, CopyIcon, ShareIcon } from './Icons';

/**
 * Paylaş düğmesi.
 *
 * ÖLÇÜM UTM PARAMETRELERİYLE, AYRI BİR SAYAÇLA DEĞİL.
 * "Paylaş"a basmak paylaşıldığı anlamına gelmez: menü açılır, kullanıcı
 * vazgeçer. Bu yüzden düğmeye basılmasını saymıyoruz. Bağlantıya `utm_*`
 * ekleniyor ve gerçekten GELEN ziyaret, zaten kurulu olan (ve onaya bağlı
 * çalışan) ölçümlemede görünüyor. Ölçtüğümüz şey, olan şey.
 *
 * Yeni bir "paylaşım sayısı" tablosu KASITLI olarak açılmadı: oturumsuz
 * yazılabilen bir uç nokta, istenildiği kadar şişirilebilecek bir sayı
 * üretirdi — ve o sayı sonra "X kez paylaşıldı" diye gösterilirdi.
 *
 * ÖNCE İŞLETİM SİSTEMİNİN KENDİ PAYLAŞIM SAYFASI.
 * Telefonda `navigator.share` kullanıcının gerçekten kullandığı
 * uygulamaları listeler; bizim seçtiğimiz beş ikon değil. Yoksa (masaüstü
 * tarayıcıların çoğu) aşağıdaki menüye düşülür.
 */

type Kanal = { ad: string; etiket: string; url: (baglanti: string, metin: string) => string };

const KANALLAR: Kanal[] = [
  {
    ad: 'whatsapp',
    etiket: 'WhatsApp',
    url: (b, m) => `https://wa.me/?text=${encodeURIComponent(`${m} ${b}`)}`,
  },
  {
    ad: 'telegram',
    etiket: 'Telegram',
    url: (b, m) => `https://t.me/share/url?url=${encodeURIComponent(b)}&text=${encodeURIComponent(m)}`,
  },
  {
    ad: 'x',
    etiket: 'X',
    url: (b, m) => `https://x.com/intent/tweet?url=${encodeURIComponent(b)}&text=${encodeURIComponent(m)}`,
  },
  {
    ad: 'facebook',
    etiket: 'Facebook',
    url: (b) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(b)}`,
  },
];

/** Bağlantıya kaynağı yazar: hangi kanaldan gelindiği ölçümlemede görünür. */
function kanalliBaglanti(yol: string, kanal: string): string {
  const url = new URL(yol, typeof window === 'undefined' ? 'https://www.ohaaaa.com' : window.location.origin);
  url.searchParams.set('utm_source', kanal);
  url.searchParams.set('utm_medium', 'paylasim');
  return url.toString();
}

export function ShareButton({
  path,
  title,
  text,
  className = '',
}: {
  /** Paylaşılacak sayfanın yolu, örn. `/urun/iphone-15`. */
  path: string;
  title: string;
  /**
   * Paylaşım metni. YALNIZCA gerçek veriden kurulmalı: fiyat, mağaza sayısı
   * gibi bir iddia varsa çağıran taraf onu ölçülmüş değerden geçirmeli.
   */
  text: string;
  className?: string;
}) {
  const [acik, setAcik] = useState(false);
  const [kopyalandi, setKopyalandi] = useState(false);
  const kutuRef = useRef<HTMLDivElement>(null);

  // Menü dışına tıklayınca kapanmalı; kapanmayan menü, altındaki içeriği
  // tıklanamaz hâle getirir.
  useEffect(() => {
    if (!acik) return;

    function disariTiklandi(olay: MouseEvent) {
      if (kutuRef.current && !kutuRef.current.contains(olay.target as Node)) setAcik(false);
    }
    function kacisTusu(olay: KeyboardEvent) {
      if (olay.key === 'Escape') setAcik(false);
    }

    document.addEventListener('mousedown', disariTiklandi);
    document.addEventListener('keydown', kacisTusu);
    return () => {
      document.removeEventListener('mousedown', disariTiklandi);
      document.removeEventListener('keydown', kacisTusu);
    };
  }, [acik]);

  async function paylas() {
    const baglanti = kanalliBaglanti(path, 'sistem');

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url: baglanti });
        return;
      } catch {
        // Kullanıcı vazgeçtiyse ya da tarayıcı reddettiyse menüye düşülür.
        // Hata gösterilmez: vazgeçmek hata değil.
      }
    }
    setAcik((onceki) => !onceki);
  }

  async function kopyala() {
    const baglanti = kanalliBaglanti(path, 'kopyala');
    try {
      await navigator.clipboard.writeText(baglanti);
      setKopyalandi(true);
      window.setTimeout(() => setKopyalandi(false), 2000);
    } catch {
      // Pano izni yoksa bağlantı seçilebilir biçimde gösterilir; sessizce
      // "kopyalandı" demek yalan olurdu.
      window.prompt('Bağlantıyı kopyalayın:', baglanti);
    }
  }

  return (
    <div ref={kutuRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={paylas}
        aria-expanded={acik}
        aria-haspopup="menu"
        className="press inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-brand"
      >
        <ShareIcon className="h-4 w-4" />
        Paylaş
      </button>

      {acik && (
        <div
          role="menu"
          aria-label="Paylaşım seçenekleri"
          className="absolute left-0 z-30 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
        >
          {KANALLAR.map((kanal) => (
            <a
              key={kanal.ad}
              role="menuitem"
              href={kanal.url(kanalliBaglanti(path, kanal.ad), text)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setAcik(false)}
              className="block px-4 py-2.5 text-sm text-fg transition-colors hover:bg-surface-2"
            >
              {kanal.etiket}
            </a>
          ))}

          <button
            type="button"
            role="menuitem"
            onClick={kopyala}
            className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-sm text-fg transition-colors hover:bg-surface-2"
          >
            {kopyalandi ? (
              <CheckIcon className="h-4 w-4 text-success" />
            ) : (
              <CopyIcon className="h-4 w-4" />
            )}
            {kopyalandi ? 'Kopyalandı' : 'Bağlantıyı kopyala'}
          </button>
        </div>
      )}
    </div>
  );
}
