import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * `OHAAAA_IMAGE_HOSTS` -> Next.js remotePatterns.
 *
 * Biçim: virgülle ayrılmış alan adları, ör. `cdn.magaza.com,img.baska.net`.
 * Tanımsız veya boşsa BOŞ liste döner ve uzak görsel optimizasyonu kapalı
 * kalır — güvenli varsayılan budur.
 *
 * JOKER KABUL EDİLMEZ. `*` ya da `**` içeren bir giriş derlemeyi DÜŞÜRÜR.
 * Sebebi doğrudan bu dosyanın geçmişi: joker bir kez yazıldığında kimse
 * fark etmeden aylarca açık kalıyor. Ortam değişkeni üzerinden geri
 * gelmesini imkânsız kılmak, yorum yazmaktan daha güvenilir.
 */
function imageRemotePatterns(): Array<{ protocol: 'https'; hostname: string }> {
  const raw = process.env.OHAAAA_IMAGE_HOSTS?.trim();
  if (!raw) return [];

  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
    .map((host) => {
      if (host.includes('*')) {
        throw new Error(
          `OHAAAA_IMAGE_HOSTS joker karakter kabul etmez: "${host}". ` +
            'Alan adlarını tek tek yazın.',
        );
      }

      // Kaba ama yeterli bir alan adı denetimi: şema, yol, port ya da
      // kimlik bilgisi içeren bir giriş yapılandırma hatasıdır.
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
        throw new Error(
          `OHAAAA_IMAGE_HOSTS gecersiz alan adi: "${host}". ` +
            'Yalnizca alan adi yazin (sema, port ve yol olmadan).',
        );
      }

      return { protocol: 'https' as const, hostname: host };
    });
}

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,

  /*
   * "X-Powered-By: Next.js" başlığını kapatır.
   *
   * Tek başına bir açık değil, ama saldırgana hangi yığını kullandığımızı
   * söyler. Bilinen bir Next.js açığı çıktığında taramalar önce bu başlığa
   * bakarak hedef listesi çıkarır. Söylememek bedava.
   */
  poweredByHeader: false,

  // Monorepo'daki paylaşılan paket TypeScript kaynağından derlenir.
  transpilePackages: ['@ohaaaa/shared'],

  images: {
    /*
     * UZAK GÖRSEL ALAN ADLARI — JOKER YOK.
     *
     * Önceki hâli `hostname: '**'` idi: `/_next/image?url=...` uç noktası
     * İSTENEN HER https adresini sunucu tarafından indirip optimize
     * ediyordu. Bu iki şey demekti:
     *   • SSRF benzeri bir çıkış: sunucumuz, saldırganın seçtiği adrese
     *     istek atan bir vekile dönüşür.
     *   • Kaynak tüketimi: her istek indirme + yeniden kodlama, kimlik
     *     doğrulaması ve hız sınırı olmadan.
     *
     * Ve karşılığında HİÇBİR ŞEY kazanmıyorduk: depoda `next/image` bir
     * kez bile import edilmiyor (arandı, sıfır sonuç). Bütün görseller düz
     * `<img>` etiketiyle, tarayıcı tarafından doğrudan çekiliyor. Yani
     * optimizasyon uç noktası kullanılmıyor, yalnızca açık duruyordu.
     *
     * Liste artık ortam değişkeninden gelir ve VARSAYILAN BOŞTUR. Boş liste
     * = uzak görsel optimizasyonu kapalı; `<img>` ile doğrudan yükleme
     * etkilenmez, dolayısıyla vitrinde hiçbir değişiklik olmaz.
     *
     * İlk gerçek mağaza bağlandığında yalnızca o mağazanın CDN alan adı
     * `OHAAAA_IMAGE_HOSTS` değişkenine yazılır. Kod değişmez.
     */
    remotePatterns: imageRemotePatterns(),
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
          { key: 'x-frame-options', value: 'SAMEORIGIN' },
          /*
           * HSTS burada da tanımlı, yalnızca vercel.json'da değil.
           *
           * Panelde ya da platform yapılandırmasında duran bir güvenlik
           * başlığı, dağıtım başka bir yere taşındığında sessizce kaybolur.
           * Uygulamanın kendisi göndermeli ki nerede çalışırsa çalışsın
           * korunsun. Aynı başlığın iki yerden gelmesi sorun değildir;
           * eksik olması sorundur.
           *
           * Tarayıcılar HSTS'i yalnızca HTTPS yanıtlarında dikkate alır;
           * yerel http sunucuda etkisizdir, zarar vermez.
           *
           * preload YOK: preload listesine girmek geri dönüşü çok zor bir
           * taahhüttür (tüm alt alan adları kalıcı olarak HTTPS zorunlu).
           * Buna site sahibi karar vermeli.
           */
          {
            key: 'strict-transport-security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

/*
 * DİL ÖNEKİ YÖNLENDİRMESİ.
 *
 * `/en-gb/kategori/x` adresinin `/kategori/x` rotasına düşmesini sağlar.
 * Böylece her sayfa için ikinci bir dosya ağacı açmaya gerek kalmıyor:
 * tek rota, önekten gelen dil ve pazarla çalışıyor.
 *
 * NEDEN `beforeFiles` VE NEDEN MIDDLEWARE DEĞİL
 * Next.js sırası: middleware → beforeFiles → dosya sistemi. Yani middleware
 * ADRESİ ÖNEKLİ GÖRÜR (dili oradan okuyabilir), bu kural da rotaya
 * düşmeden önce öneki soyar. Yeniden yazmayı middleware içinde yapmak,
 * oradaki üç ayrı yanıt üretim noktasının hepsini değiştirmeyi
 * gerektirirdi -- oturum ve CSP akışına dokunmadan aynı sonucu almanın
 * yolu bu.
 *
 * DESEN İKİ HARF DİL + 2-15 KARAKTER PAZAR: `urlLocale.ts` içindeki
 * `SEGMENT_DESENI` ile aynı. Ayrışmamaları gerekiyor; biri değişirse
 * diğeri de değişmeli.
 *
 * `/urun/...` gibi mevcut yollar bu desene UYMAZ (tek parça, tire yok),
 * dolayısıyla yanlışlıkla soyulmazlar.
 */
const DIL_ONEKI = ':dil([a-z]{2}-[a-z][a-z0-9_]{1,15})';

config.rewrites = async () => ({
  beforeFiles: [
    { source: `/${DIL_ONEKI}`, destination: '/' },
    { source: `/${DIL_ONEKI}/:yol*`, destination: '/:yol*' },
  ],
  afterFiles: [],
  fallback: [],
});

export default config;
