/**
 * `read_repo` ARACI — GERÇEK UYGULAMA.
 *
 * Depo içinden dosya okur. Yazmaz, çalıştırmaz, ağa çıkmaz.
 *
 * EN AZ YETKİ BURADA SOMUTLAŞIYOR
 * Araç bir KÖK dizinle kuruluyor ve o kökün dışına çıkamıyor. Yol
 * birleştirmesi `path.resolve` ile yapılıp sonuç tekrar kökle
 * karşılaştırılıyor: `../../etc/passwd` gibi bir girdi, birleştirmeden
 * SONRA kökün dışına düştüğü için reddediliyor. Yalnızca girdiyi
 * süzmek (".." ara) yeterli olmazdı -- sembolik bağlar ve kodlama
 * varyasyonları o süzgeci atlatır.
 *
 * BOYUT TAVANI
 * Okunacak dosya sınırsız olamaz: bir ajanın yanlışlıkla yüz megabaytlık
 * bir dosyayı belleğe alması, hem maliyet hem de zaman aşımı üretir.
 */

import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import { z } from 'zod';

import type { ToolCtx, ToolTanimi } from './contract.js';
import { ToolHatasi } from './contract.js';

export const readRepoGirdi = z.object({
  /** Kök dizine GÖRE yol. Mutlak yol kabul edilmez. */
  yol: z.string().min(1).max(512),
  /**
   * `oku` dosya içeriğini, `listele` dizin girdilerini döndürür.
   *
   * Listeleme ayrı bir ARAÇ değil aynı aracın ikinci kipi: yol kapsamı,
   * sembolik bağ kontrolü ve salt okunurluk tek yerde duruyor. İkinci bir
   * araç yazmak, o üç kontrolü ikinci kez -- ve bir gün eksik -- yazmak
   * olurdu.
   */
  mod: z.enum(['oku', 'listele']).default('oku'),
});

export const readRepoCikti = z.object({
  yol: z.string(),
  icerik: z.string(),
  bayt: z.number().int().nonnegative(),
  /** `listele` kipinde dizin girdileri; `oku` kipinde boş. */
  girdiler: z.array(z.string()),
});

export type ReadRepoGirdi = z.infer<typeof readRepoGirdi>;
export type ReadRepoCikti = z.infer<typeof readRepoCikti>;

/** Tek dosya için üst sınır. */
export const EN_BUYUK_BAYT = 2 * 1024 * 1024;
/** Bir dizinde döndürülecek en çok girdi. */
export const EN_COK_GIRDI = 1000;

/** Yol kökün İÇİNDE mi? Ayırıcı kontrolü, `/a/bc` ile `/a/b` karışmasın diye. */
function icerideMi(kok: string, tam: string): boolean {
  return tam === kok || tam.startsWith(kok.endsWith(sep) ? kok : kok + sep);
}

/**
 * Kök dizine bağlı bir `read_repo` aracı üretir.
 *
 * Kök kurulum anında sabitleniyor ve çalışma anında değiştirilemiyor --
 * ajanın kendi kapsamını genişletmesinin yolu kapalı.
 */
export function readRepoAraci(kokDizin: string): ToolTanimi<ReadRepoGirdi, ReadRepoCikti> {
  const kok = resolve(kokDizin);

  return {
    ad: 'read_repo',
    aciklama: `${kok} altındaki dosyaları salt okunur açar`,
    girdiSemasi: readRepoGirdi,
    ciktiSemasi: readRepoCikti,
    varsayilanTimeoutMs: 5_000,
    /* Dosya sistemi hatası geçici değil: aynı yol ikinci denemede de yok. */
    maxRetries: 0,

    async calistir(girdi: ReadRepoGirdi, ctx: ToolCtx): Promise<ReadRepoCikti> {
      if (isAbsolute(girdi.yol)) {
        throw new ToolHatasi('gecersiz_girdi', 'read_repo', 'mutlak yol kabul edilmiyor');
      }

      const tam = resolve(kok, girdi.yol);
      if (!icerideMi(kok, tam)) {
        throw new ToolHatasi('izin_yok', 'read_repo', 'yol kök dizinin dışında');
      }

      /*
       * Sembolik bağ, birleştirme sonrası kökün içinde görünüp gerçekte
       * dışarıyı gösterebilir. Gerçek yolu da kontrol ediyoruz.
       */
      let gercek: string;
      try {
        gercek = await realpath(tam);
      } catch {
        throw new ToolHatasi('ic_hata', 'read_repo', `okunamadı: ${girdi.yol}`);
      }
      if (!icerideMi(kok, gercek)) {
        throw new ToolHatasi('izin_yok', 'read_repo', 'sembolik bağ kök dışına çıkıyor');
      }

      if (girdi.mod === 'listele') {
        let girdiler: string[];
        try {
          const d = await stat(gercek);
          if (!d.isDirectory()) {
            throw new ToolHatasi('gecersiz_girdi', 'read_repo', 'yol bir dizin değil');
          }
          girdiler = (await readdir(gercek)).sort();
        } catch (e) {
          if (e instanceof ToolHatasi) throw e;
          throw new ToolHatasi('ic_hata', 'read_repo', `listelenemedi: ${girdi.yol}`);
        }
        const kirpik = girdiler.slice(0, EN_COK_GIRDI);
        ctx.log('read_repo_listele', { yol: girdi.yol, girdi: kirpik.length });
        return { yol: girdi.yol, icerik: '', bayt: 0, girdiler: kirpik };
      }

      let icerik: string;
      try {
        icerik = await readFile(gercek, 'utf8');
      } catch (e) {
        throw new ToolHatasi('ic_hata', 'read_repo', String(e));
      }

      const bayt = Buffer.byteLength(icerik, 'utf8');
      if (bayt > EN_BUYUK_BAYT) {
        throw new ToolHatasi(
          'gecersiz_cikti', 'read_repo',
          `dosya ${bayt} bayt, tavan ${EN_BUYUK_BAYT}`,
        );
      }

      ctx.log('read_repo_ok', { yol: girdi.yol, bayt });
      return { yol: girdi.yol, icerik, bayt, girdiler: [] };
    },
  };
}
