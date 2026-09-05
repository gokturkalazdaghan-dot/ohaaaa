'use client';

import { useRef, useState } from 'react';

import { CameraIcon } from './Icons';

/**
 * Fotoğrafla arama.
 *
 * İKİ AŞAMALI, BİLİNÇLİ SIRAYLA:
 *
 *   1. BARKOD (tarayıcıda, ücretsiz, kesin)
 *      Fotoğrafta barkod varsa okunur ve doğrudan barkodla aranır. Barkod
 *      küresel olarak benzersizdir — "Sony WH-1000XM5" yazıp yanlış modeli
 *      bulma ihtimali ortadan kalkar. Hiçbir sunucu isteği yapılmaz.
 *
 *   2. GÖRME MODELİ (sunucuda, barkod yoksa)
 *      Fotoğraf sunucuya gider ve ürün adı tahmin edilir. Tahmin bir ARAMA
 *      TERİMİne çevrilir, doğrudan bir ürün sayfasına değil: yanlış tahmin
 *      alakasız bir sonuç listesi verir, yanlış bir satın alma değil.
 *
 * NEDEN `capture` ÖZNİTELİĞİ YOK
 *
 * Daha önce girdi `capture="environment"` taşıyordu. Bu öznitelik telefonda
 * seçiciyi ATLAYIP doğrudan arka kamerayı açar. İki somut zararı vardı:
 *
 *   1. KAÇIŞ YOLU KALMIYORDU. Kamera herhangi bir sebeple görüntü
 *      veremediğinde (izin reddi, kamerayı tutan başka bir uygulama,
 *      uygulama içi tarayıcı) kullanıcı siyah bir kameraya çakılıyor ve
 *      geri dönmekten başka bir şey yapamıyordu. Galeriden fotoğraf
 *      seçmek mümkün değildi.
 *   2. GALERİ ZATEN ASIL KULLANIM. Fiyat karşılaştırmada insanlar çoğu
 *      zaman ellerindeki ürünü değil, kaydettikleri bir ekran görüntüsünü
 *      ya da fotoğrafı aratır. `capture` bunu imkânsız kılıyordu.
 *
 * Öznitelik kaldırılınca işletim sisteminin kendi seçicisi çıkar:
 * "Kamera / Galeri / Dosyalar". Kamera bir dokunuş uzakta kalır ama
 * artık tek yol değildir. Düğmenin kendi ipucu da zaten bunu vaat
 * ediyordu: "Fotoğraf çek veya yükle".
 */
export function VisualSearchButton({
  onQuery,
  onBarcode,
  compact = false,
}: {
  /** Model bir arama terimi ürettiğinde çağrılır. */
  onQuery: (query: string) => void;
  /** Fotoğrafta barkod okunduğunda çağrılır. */
  onBarcode: (gtin: string) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);

    try {
      const gtin = await readBarcode(file);
      if (gtin) {
        onBarcode(gtin);
        return;
      }

      const form = new FormData();
      form.append('gorsel', await shrink(file));

      const response = await fetch('/api/gorsel-arama', { method: 'POST', body: form });
      const payload = (await response.json()) as {
        data?: { query?: string };
        error?: { message?: string };
      };

      if (!response.ok || !payload.data?.query) {
        setError(payload.error?.message ?? 'Görsel işlenemedi.');
        return;
      }

      onQuery(payload.data.query);
    } catch {
      setError('Görsel işlenemedi. Ürün adını yazarak arayabilirsiniz.');
    } finally {
      setBusy(false);
      // Aynı dosyayı ikinci kez seçmek de olay üretsin.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        /*
         * Görünmez ama ERİŞİLEBİLİR AD taşır. `aria-hidden` yapmak yanlış
         * olurdu: ekran okuyucu kullanıcısı da dosya seçebilmeli. Adsız
         * bırakmak ise denetimde "etiketsiz form alanı" olarak çıkıyordu —
         * görünür düğmeye basınca odak buraya geçtiğinde kullanıcı ne
         * olduğunu duymaz.
         */
        aria-label="Aranacak fotoğrafı seç"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="Fotoğrafla ara"
        title="Fotoğraf çek veya yükle"
        className={`shrink-0 rounded-xl text-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-50 ${
          compact ? 'grid h-9 w-9 place-items-center' : 'grid h-11 w-11 place-items-center'
        }`}
      >
        {busy ? (
          <span
            aria-hidden="true"
            className="block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand"
          />
        ) : (
          <CameraIcon className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
        )}
      </button>

      {/* Hata, kutunun altında ve rolü bildirilmiş olarak durur: sessiz
          başarısızlık kullanıcıyı butona tekrar tekrar bastırır. */}
      {error && (
        <p role="status" className="absolute left-0 top-full mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Fotoğraftaki barkodu tarayıcıda okur.
 *
 * `BarcodeDetector` her tarayıcıda yok (Safari ve Firefox'ta uzun süre
 * yoktu). Desteklenmiyorsa sessizce null döner ve akış görme modeline
 * düşer — özelliğin yokluğu hata değildir.
 */
async function readBarcode(file: File): Promise<string | null> {
  const Detector = (
    window as unknown as {
      BarcodeDetector?: new (options?: { formats?: string[] }) => {
        detect: (source: ImageBitmap) => Promise<Array<{ rawValue: string }>>;
      };
    }
  ).BarcodeDetector;

  if (!Detector) return null;

  try {
    // Yalnızca ürün barkodu biçimleri: QR kod bir ürün kimliği değildir ve
    // yanlışlıkla bir URL'i barkod sanmak istemeyiz.
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const bitmap = await createImageBitmap(file);

    try {
      const found = await detector.detect(bitmap);
      const raw = found[0]?.rawValue?.trim();
      // Barkod yalnızca rakamdır; başka bir şey geldiyse güvenme.
      return raw && /^[0-9]{8,14}$/.test(raw) ? raw : null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/**
 * Fotoğrafı yüklemeden önce küçültür.
 *
 * Telefon kamerası 8-12 MB üretebilir. Ürün tanımak için 1024 piksel fazlasıyla
 * yeter; küçültmek hem sunucu sınırına takılmayı önler hem de mobil veriyle
 * bekleme süresini birkaç saniyeden bir saniyenin altına indirir.
 *
 * Küçültme başarısız olursa (canvas erişimi engelli, tuhaf dosya) özgün dosya
 * gönderilir: sınırı sunucu zaten kendisi uygular.
 */
async function shrink(file: File): Promise<File> {
  const MAX_EDGE = 1024;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

    if (scale === 1 && file.size <= 1_500_000) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    );

    if (!blob) return file;
    return new File([blob], 'arama.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
