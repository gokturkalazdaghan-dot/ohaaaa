'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import { CategoryBrowser } from '@/components/CategoryBrowser';
import { ChevronDownIcon } from '@/components/Icons';
import { t, type Category, type CategoryNode, type Locale } from '@ohaaaa/shared';

/**
 * Telefonda kenardan çekilen kategori menüsü.
 *
 * NEDEN
 * Telefonda kategoriye gitmenin tek yolu ana sayfaydı: üst çubuktaki şerit
 * yatay kaydırılan bir satır ve alt kategorileri yalnızca `hover` ile
 * açıyor -- dokunmatik ekranda `hover` yok, yani şeritten alt kategoriye
 * hiç ulaşılamıyordu. Ürün sayfasındayken başka bir kategoriye geçmek için
 * geri gidip ana sayfaya dönmek gerekiyordu.
 *
 * Çekmece HER SAYFADA duruyor ve taksonominin tamamını dokunmayla
 * gezilebilir yapıyor.
 *
 * ---------------------------------------------------------------------------
 * NEDEN TUTAMAÇ EKRANIN EN KENARINDA DEĞİL
 * ---------------------------------------------------------------------------
 * iOS Safari'de ekranın sol kenarından başlayan yatay sürükleme TARAYICININ
 * geri gitme hareketidir; `preventDefault` ile bastırılamaz. Kenardan
 * başlayan bir menü hareketi orada ya hiç çalışmaz ya da kullanıcıyı
 * istemediği sayfaya götürür.
 *
 * Bu yüzden sürükleme GÖRÜNEN bir tutamaçtan başlıyor. Tutamaç gerçek bir
 * öge olduğu için `touch-action: none` yazılabiliyor ve üzerindeki hareket
 * tarayıcıya değil bize geliyor. Görünür olması ikinci bir kazanç:
 * kimsenin varlığını bilmediği bir hareket denenmez.
 *
 * ---------------------------------------------------------------------------
 * NEDEN CSS GEÇİŞİ DEĞİL, HER KAREDE YAZILAN BİR SAYI
 * ---------------------------------------------------------------------------
 * Panelin konumu `--k` (0 kapalı, 1 açık) özel özelliğinden geliyor ve
 * sürükleme boyunca parmakla 1:1 yazılıyor, bırakılınca bir yayla (spring)
 * sürülüyor.
 *
 * CSS geçişi kullanılsaydı panel yarı yoldayken yakalanıp geri
 * çevrilemezdi: geçiş bitene kadar yeni hedefe gidilmez, hareket "duvara
 * çarpmış" gibi görünür. Yay ise HER ZAMAN bulunduğu yerden ve o anki
 * hızıyla devam eder -- kullanıcı fikrini hareketin ortasında
 * değiştirebilir.
 *
 * Bırakma anında panel parmağın hızını DEVRALIYOR ve varış noktası hızdan
 * yansıtılıyor (kaydırma yavaşlaması ile aynı formül). Böylece sürükleme
 * ile animasyon arasında görünür bir ek yeri kalmıyor: hafif bir fiske
 * paneli fırlatıyor, yavaş bir çekiş yerine bırakıyor.
 *
 * ---------------------------------------------------------------------------
 * NEDEN <dialog> VE showModal()
 * ---------------------------------------------------------------------------
 * Depoda sepet paneli de öyle (bkz. `CartDrawer`). Odak tuzağı, arka planın
 * etkisizleştirilmesi (inert), ESC ile kapanma ve üst katman sıralaması
 * platformdan geliyor; elle yazılan bir odak tuzağı bunların hepsini daha
 * kötü yapardı.
 *
 * Sürükleme sırasında işaretçi YAKALAMA (pointer capture) kullanılmıyor:
 * `showModal()` tutamacı inert yaptığı an yakalama düşerdi. Bunun yerine
 * dinleyiciler `document` üzerinde; panel bütün ekranı kapladığı için
 * sonraki olaylar zaten oraya düşüyor.
 */

/** Yay: sönüm oranı ve tepki süresi (sn). Apple'ın çekmece değerleri. */
const SONUM = 0.82;
const TEPKI = 0.3;

/** Yatay mı dikey mi olduğuna karar vermeden önce beklenen mesafe. */
const ESIK_PX = 8;

/** Hareketten doğan `click` bu süre içinde gelirse yutulur. */
const BASTIRMA_PENCERESI_MS = 700;

/**
 * Hızın paneli nereye taşıyacağını yansıtır -- kaydırma yavaşlamasının
 * kendi formülü. "En yakın kenara yapış" demek, hızlı bir fiskeyi yavaş
 * bir çekişten ayırt etmemek olurdu.
 */
function yansit(hiz: number, yavaslama = 0.998): number {
  return ((hiz / 1000) * yavaslama) / (1 - yavaslama);
}

export function CategoryDrawer({
  nodes,
  locale,
}: {
  nodes: CategoryNode<Category>[];
  locale: Locale;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /** Panelin açıklık oranı. DOM'un tek gerçeği; React durumu değil. */
  const kRef = useRef(0);
  const cerceveRef = useRef<number | null>(null);
  const surukleRef = useRef<{
    baslangicX: number;
    baslangicY: number;
    baslangicK: number;
    /** Yön kararı verildi mi; verildiyse bizim mi? */
    karar: 'bekliyor' | 'yatay' | 'dikey';
    gecmis: { x: number; t: number }[];
    /** Sürükleme oldu mu -- sonraki tıklama bastırılsın diye. */
    tasindi: boolean;
  } | null>(null);

  /*
   * HAREKETİN ARDINDAN GELEN `click` YUTULUR.
   *
   * İki ölçülen arıza bunu gerektirdi:
   *
   *  1) Tutamaca DOKUNMAK paneli açıp anında kapatıyordu. `pointerdown`
   *     paneli sahneye alıyor, panel parmağın altını kaplıyor ve
   *     `pointerup`'tan doğan `click` artık tutamaca değil PANELİN
   *     ÖRTÜSÜNE düşüyor -- örtüye tıklamak da "kapat" demek.
   *  2) Paneli sürükleyip bırakırken parmağın altında bir kategori
   *     bağlantısı varsa o bağlantı açılıyordu: kapatmak isterken
   *     istemediğin sayfaya gidiyordun.
   *
   * `surukleRef` ile yapılamaz: `click`, `pointerup`'tan SONRA gelir ve o
   * sırada `surukleRef` temizlenmiştir. Zaman damgası tutuluyor çünkü
   * hareketin ardından `click` HİÇ gelmeyebilir (tarayıcı bastırmış
   * olabilir); kalıcı bir bayrak o durumda sonraki gerçek tıklamayı yerdi.
   */
  const bastirRef = useRef(0);

  const pathname = usePathname();

  const kYaz = useCallback((k: number) => {
    kRef.current = k;
    dialogRef.current?.style.setProperty('--k', String(k));
  }, []);

  const durdur = useCallback(() => {
    if (cerceveRef.current !== null) {
      cancelAnimationFrame(cerceveRef.current);
      cerceveRef.current = null;
    }
  }, []);

  /** Yayı hedefe sürer. Her zaman BULUNDUĞU yerden başlar. */
  const yayaBirak = useCallback(
    (hedef: 0 | 1, baslangicHiz: number) => {
      durdur();

      const dialog = dialogRef.current;
      if (!dialog) return;

      const bitir = () => {
        kYaz(hedef);
        if (hedef === 0) dialog.close();
      };

      /*
       * Hareket azaltılmışsa yay hiç çalışmaz: kullanıcının kendi parmağı
       * baş döndürmez, rahatsız eden kendiliğinden hareket eden arayüzdür.
       */
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        bitir();
        return;
      }

      const w = 2 * Math.PI / TEPKI;
      let x = kRef.current;
      let v = baslangicHiz;
      let onceki = performance.now();

      const adim = (simdi: number) => {
        /*
         * Adım SINIRLI. Sekme arkaya alınıp geri gelindiğinde `dt`
         * saniyeler olur ve açık integrasyon patlar -- panel ekranın
         * dışına fırlardı.
         */
        const dt = Math.min((simdi - onceki) / 1000, 1 / 30);
        onceki = simdi;

        const a = -w * w * (x - hedef) - 2 * SONUM * w * v;
        v += a * dt;
        x += v * dt;

        if (Math.abs(x - hedef) < 0.001 && Math.abs(v) < 0.02) {
          cerceveRef.current = null;
          bitir();
          return;
        }

        kYaz(x);
        cerceveRef.current = requestAnimationFrame(adim);
      };

      cerceveRef.current = requestAnimationFrame(adim);
    },
    [durdur, kYaz],
  );

  /** Paneli sahneye alır; konumunu DEĞİŞTİRMEZ (parmak sürüyor olabilir). */
  const sahneyeAl = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    kYaz(kRef.current);
    dialog.showModal();
  }, [kYaz]);

  /*
   * Dokunmadan açma yolu: klavye (tutamaca odaklanıp Enter) ve fare.
   * Yalnızca `showModal()` çağırmak YETMİYORDU -- panel açık ama `--k`
   * hâlâ 0, yani ekranın solunda görünmez duruyordu. Klavye kullanıcısı
   * paneli hiç göremiyordu; ölçüldü.
   */
  const ac = useCallback(() => {
    if (dialogRef.current?.open) return;
    sahneyeAl();
    yayaBirak(1, 0);
  }, [sahneyeAl, yayaBirak]);

  const kapat = useCallback(() => yayaBirak(0, 0), [yayaBirak]);

  /* ---------------------------------------------------------------------
     SÜRÜKLEME
     --------------------------------------------------------------------- */

  const sonlandir = useCallback(() => {
    const s = surukleRef.current;
    surukleRef.current = null;
    if (!s) return;

    const genislik = panelRef.current?.offsetWidth ?? 320;
    const g = s.gecmis;
    const toplamDx = Math.abs((g.at(-1)?.x ?? s.baslangicX) - s.baslangicX);

    /*
     * DOKUNUŞ MU, SÜRÜKLEME Mİ.
     *
     * Ölçüldü: tutamaca dokunmak paneli açıp ANINDA kapatıyordu. Sebep,
     * tutamaçta yönün baştan "yatay" sayılması: bırakma her zaman hız
     * dalına giriyor, hareket olmadığı için hız 0 çıkıyor, 0 hız da
     * "kapat" demek oluyordu.
     *
     * Eşiğin altında kalan her bırakma artık DOKUNUŞ sayılıyor: kapalıysa
     * açar, açıksa olduğu gibi bırakır. Bu ayrım ayrıca parmağın doğal
     * titremesini sürükleme sanmayı engelliyor.
     */
    if (toplamDx < ESIK_PX) {
      if (s.baslangicK === 0) yayaBirak(1, 0);
      else kYaz(s.baslangicK);
      return;
    }

    bastirRef.current = performance.now();

    if (s.karar !== 'yatay') return;

    /*
     * Hız son ~80 ms'den okunuyor. Tek bir olaydan okumak gürültülü:
     * parmak bırakmadan hemen önce sıklıkla duraklar ve o an okunan hız
     * sıfıra yakın çıkar -- fiske "yavaş çekiş" sanılırdı.
     */
    const son = g.at(-1);
    const ilk = son ? (g.find((n) => son.t - n.t <= 80) ?? g[0]) : undefined;
    const dt = son && ilk ? (son.t - ilk.t) / 1000 : 0;
    const hizPx = son && ilk && dt > 0 ? (son.x - ilk.x) / dt : 0;
    const hiz = hizPx / genislik;

    const varis = kRef.current + yansit(hiz);
    const hedef: 0 | 1 = varis >= 0.5 ? 1 : 0;
    yayaBirak(hedef, hiz);
  }, [kYaz, yayaBirak]);

  useEffect(() => {
    function hareket(olay: PointerEvent) {
      const s = surukleRef.current;
      if (!s) return;

      const dx = olay.clientX - s.baslangicX;
      const dy = olay.clientY - s.baslangicY;

      if (s.karar === 'bekliyor') {
        if (Math.abs(dx) < ESIK_PX && Math.abs(dy) < ESIK_PX) return;
        /*
         * Yön BİR KEZ seçilir. Her karede yeniden karar vermek, çapraz
         * hareketlerde panelin kaydırma ile takışmasına yol açardı.
         */
        s.karar = Math.abs(dx) > Math.abs(dy) ? 'yatay' : 'dikey';
        if (s.karar === 'dikey') {
          surukleRef.current = null;
          return;
        }
      }

      s.tasindi = true;
      s.gecmis.push({ x: olay.clientX, t: olay.timeStamp });
      if (s.gecmis.length > 8) s.gecmis.shift();

      const genislik = panelRef.current?.offsetWidth ?? 320;
      let k = s.baslangicK + dx / genislik;

      /*
       * LASTİK KENAR. Açık sınırının ötesine çekildiğinde panel durmaz,
       * gitgide daha az takip eder. Sert duruş "dondu" diye okunur;
       * artan direnç "buraya kadar" der.
       */
      if (k > 1) k = 1 + (k - 1) * 0.12;
      if (k < 0) k = 0;

      kYaz(k);
      if (olay.cancelable) olay.preventDefault();
    }

    function birak() {
      if (!surukleRef.current) return;
      sonlandir();
    }

    document.addEventListener('pointermove', hareket, { passive: false });
    document.addEventListener('pointerup', birak);
    document.addEventListener('pointercancel', birak);
    return () => {
      document.removeEventListener('pointermove', hareket);
      document.removeEventListener('pointerup', birak);
      document.removeEventListener('pointercancel', birak);
    };
  }, [kYaz, sonlandir]);

  /** Tutamaçtan başlayan sürükleme: panel hemen sahneye girer. */
  const tutamactanBasla = useCallback(
    (olay: React.PointerEvent) => {
      durdur();
      sahneyeAl();
      /*
       * Bu hareketten doğacak `click` şimdiden işaretleniyor: panel
       * parmağın altını kapladığı için o tıklama örtüye düşecek ve paneli
       * anında kapatacaktı.
       */
      bastirRef.current = performance.now();
      surukleRef.current = {
        baslangicX: olay.clientX,
        baslangicY: olay.clientY,
        baslangicK: kRef.current,
        /* Tutamaçta yön tartışması yok: orada dikey kaydırma yok. */
        karar: 'yatay',
        gecmis: [{ x: olay.clientX, t: olay.timeStamp }],
        tasindi: false,
      };
    },
    [durdur, sahneyeAl],
  );

  /** Panelden başlayan sürükleme: önce yatay mı dikey mi anlaşılır. */
  const paneldenBasla = useCallback(
    (olay: React.PointerEvent, kesin: boolean) => {
      /*
       * Fare de sürükleyebilir. Önce `pointerType === 'mouse'` elenmişti
       * ("masaüstünde metin seçimini bozmasın") ama çekmece zaten yalnızca
       * telefonda görünüyor ve eleme, dokunmatik ekranlı dizüstülerde
       * paneli sürüklenemez yapıyordu. Sekiz piksellik eşik ile yön kararı
       * metin seçimini ve bağlantı tıklamasını zaten koruyor.
       */
      durdur();
      bastirRef.current = 0;
      surukleRef.current = {
        baslangicX: olay.clientX,
        baslangicY: olay.clientY,
        baslangicK: kRef.current,
        karar: kesin ? 'yatay' : 'bekliyor',
        gecmis: [{ x: olay.clientX, t: olay.timeStamp }],
        tasindi: false,
      };
    },
    [durdur],
  );

  /*
   * Sürükleyip bırakınca altındaki bağlantı AÇILMAMALI. Parmağın altında
   * bir kategori bağlantısı varken paneli kapatmak, istemediğin sayfaya
   * gitmek demek olurdu.
   */
  const tiklamayiBastir = useCallback((olay: React.MouseEvent) => {
    if (performance.now() - bastirRef.current > BASTIRMA_PENCERESI_MS) return;
    bastirRef.current = 0;
    olay.preventDefault();
    olay.stopPropagation();
  }, []);

  /* ---------------------------------------------------------------------
     PLATFORMLA UYUM
     --------------------------------------------------------------------- */

  /* ESC tarayıcının kendi yolu; paneli ANINDA kapatmasın, geri kaysın. */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const iptal = (olay: Event) => {
      olay.preventDefault();
      kapat();
    };
    dialog.addEventListener('cancel', iptal);
    return () => dialog.removeEventListener('cancel', iptal);
  }, [kapat]);

  /* Arka plan kaymasın: showModal() bunu her tarayıcıda yapmıyor. */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onceki = document.body.style.overflow;
    const gozlemci = new MutationObserver(() => {
      document.body.style.overflow = dialog.open ? 'hidden' : onceki;
    });
    gozlemci.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    return () => {
      gozlemci.disconnect();
      document.body.style.overflow = onceki;
    };
  }, []);

  /* Bir kategoriye gidildiğinde panel açık kalmamalı. */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      durdur();
      kYaz(0);
      dialog.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  /*
   * Ekran masaüstü genişliğine çıkarsa panel kapanır: tutamaç orada
   * gizlidir ve kullanıcı açık kalan paneli kapatacak tutamağı bulamazdı.
   */
  useEffect(() => {
    const olcut = window.matchMedia('(min-width: 1024px)');
    const degisti = () => {
      if (olcut.matches && dialogRef.current?.open) {
        durdur();
        kYaz(0);
        dialogRef.current.close();
      }
    };
    olcut.addEventListener('change', degisti);
    return () => olcut.removeEventListener('change', degisti);
  }, [durdur, kYaz]);

  useEffect(() => durdur, [durdur]);

  if (nodes.length === 0) return null;

  return (
    <>
      {/*
        KENAR TUTAMACI. `lg:hidden`: geniş ekranda üst çubuktaki şerit
        zaten `hover` ile açılıyor ve orada imleç var.
      */}
      <button
        type="button"
        onPointerDown={tutamactanBasla}
        onClick={ac}
        aria-label={t(locale, 'ev.kategorilerGez')}
        className="kategori-tutamac fixed left-0 top-1/2 z-40 flex h-20 w-5 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 border-line bg-surface/90 shadow-lg backdrop-blur-sm transition-[width,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:w-6 active:bg-surface lg:hidden"
      >
        {/* Ok SAĞI gösterir: panel oradan gelecek. */}
        <ChevronDownIcon className="h-4 w-4 -rotate-90 text-muted" aria-hidden="true" />
      </button>

      <dialog
        ref={dialogRef}
        className="kategori-dialog"
        aria-label={t(locale, 'ev.kategorilerGez')}
        onClickCapture={tiklamayiBastir}
        style={{ ['--k' as string]: 0 }}
      >
        {/*
          Örtü. `::backdrop` yerine kendi katmanımız, çünkü opaklığı
          sürükleme oranına bağlamak gerekiyor; `::backdrop` özel
          özellikleri her tarayıcıda devralmıyor.
        */}
        <button
          type="button"
          onClick={kapat}
          aria-label={t(locale, 'ortak.kapat')}
          tabIndex={-1}
          className="kategori-ortu absolute inset-0 h-full w-full cursor-default"
        />

        <div
          ref={panelRef}
          onPointerDown={(o) => paneldenBasla(o, false)}
          className="kategori-panel absolute left-0 top-0 flex h-full w-[min(20rem,85vw)] flex-col border-r border-line bg-bg-elevated shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3.5">
            <h2 className="text-base font-semibold">{t(locale, 'ev.kategoriler')}</h2>
            <button
              type="button"
              onClick={kapat}
              className="rounded-lg px-2 py-1 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              {t(locale, 'ortak.kapat')}
            </button>
          </header>

          <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
            {/*
              Akordeonun ikinci bir kopyası YAZILMADI: ana sayfadaki
              bileşen görünümü parametreyle değiştiriyor. İki kopya, biri
              düzeltilip diğeri unutulduğunda menünün iki yerde farklı
              davranması demekti.
            */}
            <CategoryBrowser
              nodes={nodes}
              locale={locale}
              gorunum="cekmece"
              etiket={t(locale, 'ev.kategoriler')}
            />
          </div>

          {/*
            TUTMA ÇUBUĞU. Panelin sağ kenarında, dikey ortada duran ince
            bir çubuk: "burası çekilir" demenin metin kullanmayan yolu.
            `aria-hidden` çünkü klavye kullanıcısının çekecek bir şeyi yok;
            onun yolu ESC ve "Kapat" düğmesi.
          */}
          <span
            onPointerDown={(o) => paneldenBasla(o, true)}
            aria-hidden="true"
            className="kategori-tutma-cubugu absolute right-0 top-1/2 h-16 w-4 -translate-y-1/2 cursor-grab"
          >
            <span className="absolute right-1 top-1/2 h-10 w-1 -translate-y-1/2 rounded-full bg-line-strong" />
          </span>
        </div>
      </dialog>
    </>
  );
}
