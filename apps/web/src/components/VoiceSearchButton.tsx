'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { MicIcon } from './Icons';

/**
 * Sesli arama.
 *
 * Tarayıcının kendi konuşma tanımasını (Web Speech API) kullanır — ses
 * hiçbir sunucumuza gitmez, tanıma cihazda/tarayıcının kendi servisinde olur.
 * Bu hem gizlilik açısından daha iyi hem de bizim için maliyetsiz.
 *
 * API her tarayıcıda yok. DESTEKLENMİYORSA BUTON HİÇ ÇİZİLMEZ: çalışmayan bir
 * mikrofon simgesi, olmayan bir simgeden kötüdür — kullanıcı bozuk sanır.
 *
 * Dil `tr-TR` sabit: site Türkçe, kullanıcı Türkçe konuşur. Tarayıcı diline
 * bırakmak, İngilizce arayüz kullanan bir Türk kullanıcıda tanımayı bozardı.
 */
export function VoiceSearchButton({
  onResult,
  compact = false,
}: {
  /** Tanınan metinle çağrılır. */
  onResult: (text: string) => void;
  compact?: boolean;
}) {
  /*
   * Destek yalnızca tarayıcıda bilinir; sunucuda ve hidrasyon sırasında
   * `false` döner, sonra gerçek değere geçer.
   *
   * `useEffect` + `setState` yerine `useSyncExternalStore`: aynı sonucu
   * fazladan bir render turu üretmeden verir. Abone olunacak bir kaynak yok
   * (tarayıcı yeteneği oturum boyunca değişmez), bu yüzden `subscribe` boş.
   */
  const supported = useSyncExternalStore(
    subscribeNothing,
    () => Boolean(getRecognitionConstructor()),
    () => false,
  );

  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Kullanıcı sayfadan ayrılırken mikrofon açık kalmamalı.
  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  if (!supported) return null;

  function start() {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) return;

    setError(null);

    const recognition = new Recognition();
    /*
     * TANIMA DİLİ SAYFANIN DİLİNDEN GELİR (madde 17).
     *
     * Önce 'tr-TR' gömülüydü: Almanca konuşan bir ziyaretçinin sesi Türkçe
     * fonetikle çözülmeye çalışılıyor ve pratikte hiçbir zaman doğru
     * sonuç vermiyordu.
     *
     * Değer NEDEN prop olarak geçilmiyor? Çünkü tek doğru kaynak zaten
     * `<html lang>`: sunucu, GERÇEKTEN sunduğu dili oraya yazıyor
     * (bkz. lib/locale.ts). Prop'u beş bileşen aşağı taşımak, aynı bilgiyi
     * ikinci bir yoldan taşımak ve iki yolun sapma ihtimalini yaratmak
     * olurdu -- sesli aramanın sayfa dilinden farklı bir dil dinlemesi.
     *
     * Öznitelik okunamazsa tarayıcının kendi varsayılanı kalır; sabit bir
     * dil dayatmaktan iyidir.
     */
    const pageLang =
      typeof document !== 'undefined' ? document.documentElement.lang.trim() : '';
    if (pageLang) recognition.lang = pageLang;
    // Tek bir arama sorgusu: sürekli dinleme gereksiz ve mikrofonu açık tutar.
    recognition.continuous = false;
    // Ara sonuç göstermiyoruz; kullanıcı yarım kelimeleri okumak zorunda kalmasın.
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim();
      if (text) onResult(text);
    };

    recognition.onerror = (event) => {
      setListening(false);
      // 'aborted' kullanıcının kendi iptalidir; hata göstermek kafa karıştırır.
      if (event.error === 'aborted') return;
      setError(
        event.error === 'not-allowed'
          ? 'Mikrofon izni verilmedi.'
          : event.error === 'no-speech'
            ? 'Ses algılanmadı, tekrar deneyin.'
            : 'Ses tanınamadı.',
      );
    };

    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-label={listening ? 'Dinlemeyi durdur' : 'Sesle ara'}
        aria-pressed={listening}
        title={listening ? 'Dinleniyor — durdurmak için tıklayın' : 'Sesle ara'}
        className={`shrink-0 rounded-xl transition-colors ${
          listening ? 'bg-brand/15 text-brand' : 'text-muted hover:bg-surface hover:text-fg'
        } ${compact ? 'grid h-9 w-9 place-items-center' : 'grid h-11 w-11 place-items-center'}`}
      >
        <MicIcon
          className={`${compact ? 'h-5 w-5' : 'h-6 w-6'} ${listening ? 'animate-pulse' : ''}`}
        />
      </button>

      {error && (
        <p role="status" className="absolute left-0 top-full mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Web Speech API — tarayıcı tipleri
// ---------------------------------------------------------------------------
/*
 * TypeScript'in DOM tanımlarında SpeechRecognition standart olarak yok
 * (uzun süre yalnızca webkit önekiyle vardı). İhtiyacımız olan yüzeyi
 * burada tanımlıyoruz; `any` kullanmak tüm dosyada tip denetimini kapatırdı.
 */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

/** Değişmeyen bir değerin aboneliği: hiçbir zaman haber vermez. */
function subscribeNothing(): () => void {
  return () => {};
}

function getRecognitionConstructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;

  const scope = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };

  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}
