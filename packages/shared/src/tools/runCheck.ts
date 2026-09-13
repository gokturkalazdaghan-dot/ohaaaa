/**
 * `run_check` ARACI — GERÇEK UYGULAMA.
 *
 * BU BİR KABUK DEĞİL.
 *
 * Genel amaçlı komut çalıştırma bu araçta YOK ve olmayacak. Ajan bir komut
 * adı, bir yol ya da bir argüman VEREMEZ; yalnızca aşağıdaki listede
 * kimliği yazılı bir doğrulamayı SEÇEBİLİR. Komut satırının tamamı --
 * çalıştırılabilir dosya, argümanlar, çalışma dizini, ortam -- bu dosyada
 * sabit.
 *
 * Neden böyle: "komut alan ama süzen" bir araç, süzgecin her boşluğunda
 * uzaktan kod çalıştırmaya dönüşür. Süzmek yerine seçtirmek, o sınıfı
 * tamamen ortadan kaldırıyor. Bilinmeyen kimlik istenirse fail-closed
 * reddedilir.
 *
 * KABUK YOK: `execFile` kullanılıyor, `shell` hiç açılmıyor. `;`, `&&`,
 * `$(...)` gibi metinlerin yorumlanacağı bir ayrıştırıcı yok -- kabuk
 * enjeksiyonu sınıfı mekanik olarak kapalı.
 *
 * ORTAM SIZDIRILMIYOR: `process.env` alt sürece GEÇİRİLMİYOR. Çocuğa
 * yalnızca aşağıda adı geçen birkaç değişken veriliyor. Sır taşıyan bir
 * değişkenin yanlışlıkla miras kalması böylece mümkün değil.
 */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

import { z } from 'zod';

import type { ToolCtx, ToolTanimi } from './contract.js';
import { ToolHatasi } from './contract.js';

/**
 * ÇALIŞTIRILABİLİR DOĞRULAMALAR.
 *
 * Üçü de STATİK: veritabanına gitmiyor, çalışan sunucu istemiyor, ağa
 * çıkmıyor. Üçü de bugün CI adımı, yani bu araç yeni bir yetki açmıyor --
 * zaten çalışan bir doğrulamayı ajanın erişebileceği hâle getiriyor.
 *
 * Betik yolları burada SABİT. Ajan yol veremez, yeni betik yazamaz,
 * yazdığı bir dosyayı çalıştıramaz.
 */
export const KONTROLLER = {
  marka: {
    betik: 'scripts/verify-brand.mjs',
    aciklama: 'Marka yazımı tutarlılığı — depo genelinde statik tarama',
  },
  sirlar: {
    betik: 'scripts/verify-secrets.mjs',
    aciklama: 'Takip edilen dosyalarda sır taraması',
  },
  basliklar: {
    betik: 'scripts/verify-headers.mjs',
    aciklama: 'Güvenlik başlıkları ve permissions-policy tutarlılığı',
  },
} as const;

export type KontrolKimligi = keyof typeof KONTROLLER;

export const runCheckGirdi = z.object({
  /* Serbest metin DEĞİL, kapalı küme. Bilinmeyen kimlik şemada düşer. */
  kontrol: z.enum(['marka', 'sirlar', 'basliklar']),
});

export const runCheckCikti = z.object({
  kontrol: z.string(),
  betik: z.string(),
  cikisKodu: z.number().int(),
  gecti: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  kirpildi: z.boolean(),
  sureMs: z.number().int().nonnegative(),
});

export type RunCheckGirdi = z.infer<typeof runCheckGirdi>;
export type RunCheckCikti = z.infer<typeof runCheckCikti>;

/** Çıktı tavanı. Aşan çıktı kırpılır ve bayrak kaldırılır. */
export const EN_BUYUK_CIKTI = 64 * 1024;
/** Tek doğrulama için üst sınır. */
export const VARSAYILAN_SURE_MS = 120_000;

/**
 * Alt sürece verilecek ortam — TAM LİSTE.
 *
 * `PATH` gerekiyor çünkü `verify-secrets` `git ls-files` çağırıyor.
 * `HOME` git'in çalışması için. Başka hiçbir şey geçmiyor: ne Supabase
 * anahtarı, ne `CRON_SECRET`, ne model anahtarı.
 */
export function cocukOrtami(): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    /* Git, kimliği tanımlı olmayan ortamda uyarı basmasın. */
    GIT_CONFIG_NOSYSTEM: '1',
    /* Betikler renk kodu basmasın -- çıktı denetim izine yazılıyor. */
    NO_COLOR: '1',
  };
}

/**
 * Sır kalıpları — çıktıya sızarsa maskelenir.
 *
 * Araç ortamı geçirmiyor ama bir betik kendi bulduğu bir sırrı hata
 * mesajında gösterebilir (`verify-secrets` tam olarak sır arıyor).
 * Çıktı denetim izine ve doğrulayıcıya gittiği için burada bir kez daha
 * süzülüyor: savunma tek katmana bırakılmıyor.
 */
const SIR_KALIPLARI: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\bsb[ps]_[A-Za-z0-9_-]{16,}/g,                                     // Supabase anahtarı
  /\bsk-[A-Za-z0-9_-]{16,}/g,                                         // sağlayıcı anahtarı
  /\bghp_[A-Za-z0-9]{20,}/g,                                          // GitHub jetonu
  /\bpostgres(?:ql)?:\/\/[^\s]+/g,                                    // bağlantı dizesi
];

/** Sır kalıplarını maskeler ve boyutu kırpar. */
export function ciktiyiTemizle(ham: string): { metin: string; kirpildi: boolean } {
  let m = ham;
  for (const k of SIR_KALIPLARI) m = m.replace(k, '[MASKELENDI]');
  if (m.length > EN_BUYUK_CIKTI) {
    return { metin: m.slice(0, EN_BUYUK_CIKTI) + '\n…[KIRPILDI]', kirpildi: true };
  }
  return { metin: m, kirpildi: false };
}

interface SurecSonucu {
  kod: number;
  stdout: string;
  stderr: string;
  zamanAsimi: boolean;
}

function surecCalistir(
  betikTamYolu: string, kok: string, sureMs: number,
): Promise<SurecSonucu> {
  return new Promise((coz) => {
    /*
     * Çalıştırılabilir dosya `process.execPath` -- yani bu süreci çalıştıran
     * Node'un MUTLAK yolu. `PATH` araması yok, dolayısıyla `PATH` üzerinden
     * sahte bir `node` koyup ele geçirme yolu da yok.
     */
    execFile(
      process.execPath,
      [betikTamYolu],
      {
        cwd: kok,
        env: cocukOrtami(),
        timeout: sureMs,
        killSignal: 'SIGKILL',
        maxBuffer: EN_BUYUK_CIKTI * 4,
        shell: false,
        windowsHide: true,
      },
      (hata, stdout, stderr) => {
        const zamanAsimi =
          !!hata && (hata as NodeJS.ErrnoException).code === 'ETIMEDOUT';
        /*
         * Sıfırdan farklı çıkış BAŞARISIZLIKTIR. `execFile` bunu bir
         * `Error` olarak veriyor; kodu oradan okuyoruz ve BAŞARI SAYMIYORUZ.
         */
        const kod =
          hata && typeof (hata as { code?: unknown }).code === 'number'
            ? ((hata as { code: number }).code)
            : hata
              ? 1
              : 0;
        coz({ kod, stdout: String(stdout), stderr: String(stderr), zamanAsimi });
      },
    );
  });
}

/**
 * Depo köküne bağlı bir `run_check` aracı üretir.
 *
 * Kök kurulum anında sabitleniyor; ajan çalışma anında değiştiremiyor.
 */
export function runCheckAraci(kokDizin: string): ToolTanimi<RunCheckGirdi, RunCheckCikti> {
  const kok = resolve(kokDizin);

  return {
    ad: 'run_check',
    aciklama: `${Object.keys(KONTROLLER).length} adet izin listesindeki statik doğrulamayı çalıştırır`,
    girdiSemasi: runCheckGirdi,
    ciktiSemasi: runCheckCikti,
    varsayilanTimeoutMs: VARSAYILAN_SURE_MS,
    /*
     * Yeniden deneme YOK. Bir doğrulamanın başarısızlığı geçici bir arıza
     * değil, bulgudur; tekrarlamak aynı bulguyu bir kez daha üretir ve
     * başarısız bir kontrolü "sonunda geçti" hâline getirme riski doğurur.
     */
    maxRetries: 0,

    async calistir(girdi: RunCheckGirdi, ctx: ToolCtx): Promise<RunCheckCikti> {
      const tanim = KONTROLLER[girdi.kontrol];
      if (!tanim) {
        /* Şema zaten süzüyor; bu ikinci kapı, liste ile şema ayrışırsa diye. */
        throw new ToolHatasi('gecersiz_girdi', 'run_check', 'bilinmeyen kontrol kimliği');
      }

      /*
       * Yol SABİT listeden geliyor ama yine de kök içinde olduğu
       * doğrulanıyor: liste bir gün yanlış düzenlenirse kaçış olmasın.
       */
      const tam = resolve(kok, tanim.betik);
      if (!tam.startsWith(kok + '/')) {
        throw new ToolHatasi('izin_yok', 'run_check', 'betik yolu kök dışında');
      }

      const t0 = Date.now();
      const s = await surecCalistir(tam, kok, VARSAYILAN_SURE_MS);
      const sureMs = Date.now() - t0;

      if (s.zamanAsimi) {
        throw new ToolHatasi(
          'zaman_asimi', 'run_check',
          `${girdi.kontrol} ${VARSAYILAN_SURE_MS} ms içinde bitmedi`, true,
        );
      }

      const o = ciktiyiTemizle(s.stdout);
      const e = ciktiyiTemizle(s.stderr);

      ctx.log('run_check_bitti', {
        kontrol: girdi.kontrol, cikisKodu: s.kod, sureMs,
      });

      return {
        kontrol: girdi.kontrol,
        betik: tanim.betik,
        cikisKodu: s.kod,
        /* Yalnızca 0 geçer. Başka hiçbir kod başarı sayılmaz. */
        gecti: s.kod === 0,
        stdout: o.metin,
        stderr: e.metin,
        kirpildi: o.kirpildi || e.kirpildi,
        sureMs,
      };
    },
  };
}
