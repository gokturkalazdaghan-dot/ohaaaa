/**
 * SÖZLEŞME DOĞRULAMA AJANI — ikinci gerçek uzman ajan.
 *
 * `engineering` süpervizörüne bağlı. İşi: izin listesindeki statik
 * doğrulamaları çalıştırmak ve sonucu yapılandırılmış olarak raporlamak.
 *
 * ARAÇ ÇIKTISI GÜVENİLİR DEĞİLDİR.
 *
 * Bu ajan bir alt sürecin söylediğine dayanıyor ve alt süreç bu sistemin
 * en az güvenilen parçası. Bu yüzden ajan çıktıyı YORUMLAMIYOR: "geçti"
 * kararını betiğin metninden değil ÇIKIŞ KODUNDAN türetiyor. Bir betik
 * stdout'a "başarılı" yazıp 1 ile çıkarsa, bu ajan başarısız der.
 *
 * Ajanın güveni de buna göre: bütün kontroller geçtiğinde 1 değil, çıkış
 * kodunun ne kadar kesin bir sinyal olduğuna göre sabit. Deterministik
 * bir okuma değil, bir alt sürecin raporu -- ve doğrulayıcı bunu bağımsız
 * olarak yeniden çalıştırabiliyor.
 */

import { z } from 'zod';

import type { AgentContext, AgentDefinition, AgentResult } from '../orchestrator/types.js';
import type { ToolCtx, ToolKaydi } from '../tools/contract.js';
import { aracCalistir } from '../tools/contract.js';
import { KONTROLLER } from '../tools/runCheck.js';
import type { KontrolKimligi, RunCheckCikti } from '../tools/runCheck.js';

export const SOZLESME_YETENEGI = 'contract_verification';

export const sozlesmeCiktiSemasi = z.object({
  calistirilan: z.number().int().nonnegative(),
  gecen: z.number().int().nonnegative(),
  kalan: z.array(z.object({
    kontrol: z.string(), cikisKodu: z.number().int(), betik: z.string(),
  })),
  sonuclar: z.array(z.object({
    kontrol: z.string(), betik: z.string(),
    cikisKodu: z.number().int(), gecti: z.boolean(), sureMs: z.number().int(),
  })),
  temiz: z.boolean(),
});

export type SozlesmeSonucu = z.infer<typeof sozlesmeCiktiSemasi>;

/** Bu ajanın çalıştırdığı kontroller. Sabit sıra: rapor karşılaştırılabilir kalsın. */
export const CALISTIRILAN: readonly KontrolKimligi[] = ['marka', 'sirlar', 'basliklar'];

export interface SozlesmeSecenekleri {
  tool(ad: 'run_check'): ToolKaydi | undefined;
  toolCtx(ctx: AgentContext): ToolCtx;
}

export function contractVerificationAjani(opt: SozlesmeSecenekleri): AgentDefinition<
  unknown, SozlesmeSonucu
> {
  return {
    id: 'contract-verification',
    supervisor: 'engineering',
    capabilities: [SOZLESME_YETENEGI],
    /* EN AZ YETKİ: tek araç, ve o araç yalnızca üç kimliği çalıştırabiliyor. */
    allowedTools: ['run_check'],
    timeoutMs: 300_000,
    maxRetries: 0,
    marketScope: 'all',
    enabled: true,

    async run(_girdi: unknown, ctx: AgentContext): Promise<AgentResult<SozlesmeSonucu>> {
      const arac = opt.tool('run_check');
      if (!arac) throw new Error('run_check aracı kayıtlı değil');
      const tctx = opt.toolCtx(ctx);

      const sonuclar: RunCheckCikti[] = [];
      for (const kontrol of CALISTIRILAN) {
        /*
         * SIRAYLA, paralel değil. Üçü de aynı depoyu tarıyor; paralel
         * çalıştırmak ölçülebilir bir kazanç vermiyor ama zaman aşımı
         * bütçesini paylaştırıyor ve hangi kontrolün yavaşladığını
         * görünmez kılıyor.
         */
        const r = await aracCalistir<{ kontrol: KontrolKimligi }, RunCheckCikti>(
          arac, { kontrol }, tctx,
        );
        sonuclar.push(r);
      }

      const kalan = sonuclar
        .filter((r) => !r.gecti)
        .map((r) => ({ kontrol: r.kontrol, cikisKodu: r.cikisKodu, betik: r.betik }));

      const cikti: SozlesmeSonucu = {
        calistirilan: sonuclar.length,
        gecen: sonuclar.filter((r) => r.gecti).length,
        kalan,
        sonuclar: sonuclar.map((r) => ({
          kontrol: r.kontrol, betik: r.betik,
          cikisKodu: r.cikisKodu, gecti: r.gecti, sureMs: r.sureMs,
        })),
        temiz: kalan.length === 0,
      };

      return {
        output: cikti,
        /*
         * 0.9 -- 1 DEĞİL. Sonuç bir alt sürecin çıkış kodundan geliyor;
         * betiğin kendisi hatalı olabilir. Ajan bunu bildiğini beyan
         * ediyor ve doğrulayıcıya bağımsız çalıştırma alanı bırakıyor.
         */
        confidence: 0.9,
        /*
         * KANITTA BETİK YOLU YOK ve bu bilinçli.
         *
         * İlk gerçek çalıştırmada denetim izinin hassas veri süzgeci bu
         * kaydı REDDETTİ: kanıt metni `verify-secrets.mjs` içeriyordu ve
         * süzgeç `secret` kelimesini yakaladı. Süzgeç doğru davrandı --
         * fazla yakalamak, az yakalamaktan iyidir.
         *
         * Doğru düzeltme süzgeci gevşetmek değil, kanıta yalnızca gerekeni
         * yazmaktı. Kontrol kimliği ile betik yolu arasındaki eşleme
         * `KONTROLLER` içinde sabit ve denetlenebilir; kanıtta tekrar
         * etmesi hiçbir izlenebilirlik kazandırmıyordu.
         */
        evidence: sonuclar.map(
          (r) => `${r.kontrol}: çıkış ${r.cikisKodu}, ${r.sureMs} ms`,
        ),
      };
    },
  };
}

/** İzin listesindeki kontrollerin insan tarafından okunabilir dökümü. */
export function kontrolDokumu(): Array<{ kimlik: string; betik: string; aciklama: string }> {
  return Object.entries(KONTROLLER).map(([kimlik, v]) => ({
    kimlik, betik: v.betik, aciklama: v.aciklama,
  }));
}
