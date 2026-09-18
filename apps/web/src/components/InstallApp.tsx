'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

import { DownloadIcon, IosShareIcon, PhoneIcon } from './Icons';

/**
 * "Ohaaaa'yı telefonuna al" — tarayıcıdan kurulum çağrısı.
 *
 * ÜÇ PLATFORM, ÜÇ FARKLI GERÇEK
 *
 *   Android/Chrome  Tarayıcı `beforeinstallprompt` olayını yollar; olay
 *                   saklanıp düğmeye basınca GERÇEK sistem kurulum
 *                   penceresi açılıyor.
 *   iOS/Safari      Apple bu olayı hiç yollamaz ve programla kurulum
 *                   YOLU YOKTUR. Yapılabilecek tek dürüst şey adımları
 *                   göstermek: Paylaş -> Ana Ekrana Ekle.
 *   Masaüstü        Chrome/Edge kurulumu destekler; desteklemiyorsa
 *                   telefonla taranacak bir kare kod gösteriliyor.
 *
 * NE YAZMIYOR
 * "App Store'dan indir" ya da "Google Play'de" YOK -- Ohaaaa bir mağaza
 * uygulaması değil ve öyleymiş gibi anlatmak yanlış beyan olurdu. Metin
 * bunu açıkça söylüyor: "uygulama mağazasına gerek yok".
 *
 * ZATEN KURULUYSA HİÇ ÇİZİLMEZ. Ana ekrandan açan birine "kur" demek,
 * arayüzün kullanıcıyı tanımadığını gösterir.
 *
 * NEDEN `useEffect` + `setState` DEĞİL, `useSyncExternalStore`
 * Okunan üç şey de (kurulu mu, hangi platform, istem hazır mı) React'in
 * dışındaki bir kaynakta: tarayıcının kendisinde. Efekt içinde okuyup
 * `setState` çağırmak fazladan bir render turu üretir ve bu depoda
 * `react-hooks/set-state-in-effect` tarafından hata sayılır. Aynı desen
 * `VoiceSearchButton` içinde de kullanılıyor.
 */

/** Chrome'un yükleme olayı; TypeScript'in DOM tanımlarında yok. */
type YuklemeIstemi = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type Platform = 'ios' | 'android' | 'masaustu';

declare global {
  interface Window {
    /** Erken yakalama betiğinin sakladığı olay (bkz. app/layout.tsx). */
    __ohaaaaKurulumIstemi?: YuklemeIstemi | null;
  }
}

/** Oturum boyunca değişmeyen bir değerin aboneliği: hiç haber vermez. */
function abonelikYok(): () => void {
  return () => {};
}

function platformBul(): Platform {
  const ua = navigator.userAgent;
  /*
   * iPadOS 13'ten beri Safari kendini "Macintosh" diye tanıtır. Dokunma
   * noktası sayısı ikisini ayıran tek güvenilir işaret: masaüstü Safari'de
   * 0, iPad'de 5. Bunu atlarsak iPad kullanıcısına masaüstü yönergesi
   * gösterilir ve kurulum hiç yapılamaz.
   */
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'masaustu';
}

function kuruluMu(): boolean {
  /*
   * İki ayrı sinyal, çünkü tek başına ikisi de yetmiyor: `display-mode`
   * standart ama iOS'ta uzun süre desteklenmedi; `navigator.standalone`
   * yalnızca Safari'de var.
   */
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function kurulumaAbone(bildir: () => void): () => void {
  const olcut = window.matchMedia?.('(display-mode: standalone)');
  olcut?.addEventListener('change', bildir);
  window.addEventListener('appinstalled', bildir);
  return () => {
    olcut?.removeEventListener('change', bildir);
    window.removeEventListener('appinstalled', bildir);
  };
}

function istemeAbone(bildir: () => void): () => void {
  /*
   * Olayı burada da saklıyoruz. Normalde düzendeki erken betik yakalar --
   * ama o betik (CSP, betik engelleyici, eski tarayıcı) çalışmamışsa tek
   * yedek bu dinleyici. İki kez saklamak zararsız: aynı olay nesnesi.
   */
  function yakala(olay: Event) {
    // Chrome'un kendi alt şeridini bastır: çağrı zaten footer'da duruyor.
    olay.preventDefault();
    window.__ohaaaaKurulumIstemi = olay as YuklemeIstemi;
    bildir();
  }
  window.addEventListener('beforeinstallprompt', yakala);
  window.addEventListener('ohaaaa:kurulabilir', bildir);
  window.addEventListener('appinstalled', bildir);
  return () => {
    window.removeEventListener('beforeinstallprompt', yakala);
    window.removeEventListener('ohaaaa:kurulabilir', bildir);
    window.removeEventListener('appinstalled', bildir);
  };
}

function istemHazirMi(): boolean {
  return window.__ohaaaaKurulumIstemi != null;
}

export function InstallApp() {
  /*
   * Sunucu anlık görüntüleri BİLEREK "gösterme" tarafında: platform
   * yalnızca tarayıcıda bilinir ve sunucuda bir tahmin çizmek, yanlış
   * yönergeyi bir an için göstermek demek olurdu. `kurulu = true` dönmek
   * bileşeni sunucuda ve ilk hidrasyonda hiç çizmez.
   */
  const kurulu = useSyncExternalStore(kurulumaAbone, kuruluMu, () => true);
  const platform = useSyncExternalStore<Platform>(
    abonelikYok,
    platformBul,
    () => 'masaustu',
  );
  const istemVar = useSyncExternalStore(istemeAbone, istemHazirMi, () => false);

  const [adimlarAcik, setAdimlarAcik] = useState(false);

  const kur = useCallback(async () => {
    const istem = window.__ohaaaaKurulumIstemi;
    if (!istem) {
      setAdimlarAcik(true);
      return;
    }
    /*
     * `prompt()` BİR KEZ kullanılabilir. Kullanıcı reddederse olay
     * tüketilmiş olur ve ikinci çağrı fırlatır; bu yüzden sonuç ne olursa
     * olsun saklanan olay temizleniyor ve arayüz elle yönergeye düşüyor.
     * Temizlikten sonra olay yayınlamak, `useSyncExternalStore`un yeni
     * durumu okumasını sağlıyor.
     */
    try {
      await istem.prompt();
      await istem.userChoice;
    } catch {
      /* Kullanıcıya hata göstermeye değmez: yönerge zaten aşağıda. */
    }
    window.__ohaaaaKurulumIstemi = null;
    window.dispatchEvent(new Event('ohaaaa:kurulabilir'));
  }, []);

  if (kurulu) return null;

  return (
    <section
      aria-labelledby="kurulum-basligi"
      className="mx-auto max-w-6xl px-4 pb-10 sm:px-6"
    >
      <div className="card flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"
          >
            <PhoneIcon className="h-6 w-6" />
          </span>
          <div>
            <h2 id="kurulum-basligi" className="text-base font-semibold text-fg">
              Ohaaaa’yı telefonuna al
            </h2>
            {/*
              "Uygulama mağazasına gerek yok" cümlesi SÜS DEĞİL: kullanıcı
              "uygulama" kelimesini görünce App Store aramaya gider ve
              bulamayınca sitenin sahte olduğunu düşünür. Ne olduğunu ilk
              satırda söylemek bunu önlüyor.
            */}
            <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
              Ana ekranına ekle, tek dokunuşla aç. Tarayıcıdan kurulan bir web
              uygulaması — uygulama mağazasına gerek yok, yer kaplamaz.
            </p>
          </div>
        </div>

        <div className="shrink-0 sm:text-right">
          {istemVar ? (
            <button
              type="button"
              onClick={kur}
              className="press inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-cta px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:w-auto"
            >
              <DownloadIcon className="h-5 w-5" />
              Telefonuna kur
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setAdimlarAcik((acik) => !acik)}
              aria-expanded={adimlarAcik}
              aria-controls="kurulum-adimlari"
              className="press inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line-strong px-5 py-3 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 sm:w-auto"
            >
              <DownloadIcon className="h-5 w-5" />
              Nasıl kurulur?
            </button>
          )}
        </div>
      </div>

      {adimlarAcik && (
        <div
          id="kurulum-adimlari"
          className="card mt-3 p-5 text-sm leading-relaxed text-muted sm:p-6"
        >
          {platform === 'ios' && (
            <>
              <p className="font-semibold text-fg">iPhone / iPad — Safari</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>
                  Alttaki{' '}
                  <IosShareIcon className="inline h-4 w-4 align-text-bottom" />{' '}
                  <strong className="text-fg">Paylaş</strong> simgesine dokun.
                </li>
                <li>
                  Listeyi kaydır,{' '}
                  <strong className="text-fg">Ana Ekrana Ekle</strong>’yi seç.
                </li>
                <li>
                  Sağ üstten <strong className="text-fg">Ekle</strong>’ye dokun.
                </li>
              </ol>
              {/*
                Bu uyarı olmazsa kullanıcı Chrome'da deneyip başaramaz ve
                "çalışmıyor" der. iOS'ta ana ekrana ekleme yalnızca Safari'de
                vardır; Apple'ın kısıtı, bizim eksiğimiz değil.
              */}
              <p className="mt-3 text-xs text-subtle">
                iOS’ta ana ekrana ekleme yalnızca Safari üzerinden yapılabilir.
              </p>
            </>
          )}

          {platform === 'android' && (
            <>
              <p className="font-semibold text-fg">Android — Chrome</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>
                  Sağ üstteki <strong className="text-fg">⋮</strong> menüsünü aç.
                </li>
                <li>
                  <strong className="text-fg">Uygulamayı yükle</strong> ya da{' '}
                  <strong className="text-fg">Ana ekrana ekle</strong>’yi seç.
                </li>
                <li>
                  <strong className="text-fg">Yükle</strong>’ye dokun.
                </li>
              </ol>
            </>
          )}

          {platform === 'masaustu' && (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {/*
                Kare kod SABİT bir dosya: içinde yalnızca ana sayfanın
                adresi var, kişiye özel hiçbir şey yok. Çalışma anında kod
                üretmek bunun için bir kitaplık eklemek demekti.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/marka/ohaaaa-qr.svg"
                alt="ohaaaa.com adresini açan kare kod"
                width={132}
                height={132}
                className="shrink-0 rounded-xl border border-line bg-white p-1"
              />
              <div>
                <p className="font-semibold text-fg">Telefonunla tara</p>
                <p className="mt-2">
                  Kamerayı kare koda tut, açılan sayfada bu bölümdeki kurulum
                  adımlarını izle.
                </p>
                <p className="mt-3 text-xs text-subtle">
                  Bilgisayara kurmak istersen: Chrome veya Edge’de adres
                  çubuğunun sağındaki kurulum simgesine tıkla.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
