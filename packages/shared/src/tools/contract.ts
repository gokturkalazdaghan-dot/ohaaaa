/**
 * ARAÇ SÖZLEŞMESİ.
 *
 * PHASE 1'de `ToolName` yalnızca bir İSİM kümesiydi: ajan bir aracı
 * "taşıyabiliyordu" ama o araç hiçbir şey yapmıyordu. Burası o boşluğu
 * kapatıyor -- ve kapatırken bir şeyi açıkça bırakıyor: yirmi beş adın
 * çoğunun hâlâ uygulaması YOK ve bu durum gizlenmiyor. Uygulanmamış bir
 * aracı çağırmak `uygulanmamis` hatası döndürür; sessizce boş sonuç
 * dönmez.
 *
 * KAPILAR ARAÇTA DEĞİL, ÇALIŞTIRICIDA
 * İzin, zaman aşımı, yeniden deneme ve güvenli mod kontrolü aracın
 * gövdesinde olsaydı, her yeni aracın bunları yeniden yazması gerekirdi
 * ve bir tanesinin unutması yetkiyi delerdi. Araç yalnızca işini yapar;
 * kapıları `aracCalistir` tutar.
 */

import type { ToolName } from '../orchestrator/types.js';
import { aracRiski, guvenliModdaIzinli } from '../governance/tools.js';
import type { AracRiski } from '../governance/tools.js';

export type ToolHataKodu =
  /** Ajanın izin listesinde bu araç yok. */
  | 'izin_yok'
  /** Girdi şemaya uymuyor. */
  | 'gecersiz_girdi'
  /** Çıktı şemaya uymuyor -- aracın kendi hatası. */
  | 'gecersiz_cikti'
  | 'zaman_asimi'
  /** Araç adı tanımlı ama uygulaması yok. */
  | 'uygulanmamis'
  /** Güvenli mod açık ve bu araç yan etkili. */
  | 'guvenli_mod'
  /** Aracın kendi çalışmasında hata. */
  | 'ic_hata';

export class ToolHatasi extends Error {
  constructor(
    readonly kod: ToolHataKodu,
    readonly tool: ToolName,
    mesaj: string,
    /** Yeniden denemenin anlamı var mı? */
    readonly yenidenDenenebilir = false,
  ) {
    super(`[${tool}] ${kod}: ${mesaj}`);
    this.name = 'ToolHatasi';
  }
}

/** Bir aracın çalışma anında ihtiyaç duyduğu bağlam. */
export interface ToolCtx {
  /** Aracı çağıran ajan. Denetim izine bu yazılır. */
  agentId: string;
  /** Ajanın izin listesi. Çalışma anında genişletilemez. */
  izinliAraclar: ReadonlySet<ToolName>;
  /** Güvenli mod açık mı. */
  guvenliMod: boolean;
  /** Kalan süre (ms). */
  kalanMs: number;
  log(event: string, data?: Record<string, unknown>): void;
}

/**
 * Girdi/çıktı doğrulayıcı.
 *
 * `zod` şeması da bu şekle uyuyor (`safeParse`), ama arayüz `zod`'a
 * bağlanmıyor: araç katmanının tek bir doğrulama kütüphanesine
 * kilitlenmesi gereksiz.
 */
export interface Sema<T> {
  safeParse(x: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export interface ToolTanimi<I, O> {
  ad: ToolName;
  /** Ne yaptığı -- denetim izinde okunacak. */
  aciklama: string;
  girdiSemasi: Sema<I>;
  ciktiSemasi: Sema<O>;
  /** Bu araca tanınan en uzun süre. */
  varsayilanTimeoutMs: number;
  /** Geçici hatalarda kaç kez yeniden denenir. */
  maxRetries: number;
  calistir(girdi: I, ctx: ToolCtx): Promise<O>;
}

/** Uygulanmamış araç: adı var, gövdesi yok. */
export interface UygulanmamisTool {
  ad: ToolName;
  uygulanmamis: true;
  /** Neyin eksik olduğu. Boş bırakılmaz. */
  neden: string;
}

export type ToolKaydi = ToolTanimi<never, never> | UygulanmamisTool;

export function uygulanmamisMi(t: ToolKaydi): t is UygulanmamisTool {
  return 'uygulanmamis' in t;
}

/** Bir aracın risk sınıfı -- PHASE 1 sınıflandırmasına bağlanır. */
export function toolRiski(ad: ToolName): AracRiski {
  return aracRiski(ad);
}

/** Süre sınırlı bekleme. Zaman aşımı, işin kendisini iptal etmez ama sonucu reddeder. */
async function sureli<T>(is: Promise<T>, ms: number, tool: ToolName): Promise<T> {
  let zamanlayici: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      is,
      new Promise<never>((_, red) => {
        zamanlayici = setTimeout(
          () => red(new ToolHatasi('zaman_asimi', tool, `${ms} ms aşıldı`, true)),
          ms,
        );
      }),
    ]);
  } finally {
    if (zamanlayici) clearTimeout(zamanlayici);
  }
}

/**
 * Bir aracı kapılardan geçirerek çalıştırır.
 *
 * SIRA ÖNEMLİ: izin → güvenli mod → girdi → çalıştırma → çıktı.
 * İzin kontrolü en başta, çünkü izinsiz bir çağrının girdisinin geçerli
 * olup olmadığı ilgisiz bir sorudur ve hata mesajı yanlış yeri gösterirdi.
 */
export async function aracCalistir<I, O>(
  tanim: ToolKaydi,
  girdi: unknown,
  ctx: ToolCtx,
): Promise<O> {
  const ad = tanim.ad;

  if (!ctx.izinliAraclar.has(ad)) {
    throw new ToolHatasi('izin_yok', ad, `${ctx.agentId} bu aracı taşımıyor`);
  }

  if (ctx.guvenliMod && !guvenliModdaIzinli(ad)) {
    throw new ToolHatasi('guvenli_mod', ad, 'güvenli modda yan etkili araç çalışmaz');
  }

  if (uygulanmamisMi(tanim)) {
    throw new ToolHatasi('uygulanmamis', ad, tanim.neden);
  }

  const t = tanim as unknown as ToolTanimi<I, O>;

  const g = t.girdiSemasi.safeParse(girdi);
  if (!g.success) {
    throw new ToolHatasi('gecersiz_girdi', ad, 'girdi şemaya uymuyor');
  }

  const timeout = Math.max(1, Math.min(t.varsayilanTimeoutMs, ctx.kalanMs));

  let sonHata: unknown;
  for (let deneme = 0; deneme <= t.maxRetries; deneme++) {
    try {
      ctx.log('tool_started', { tool: ad, deneme });
      const ham = await sureli(t.calistir(g.data, ctx), timeout, ad);

      const c = t.ciktiSemasi.safeParse(ham);
      if (!c.success) {
        /*
         * Çıktı doğrulaması BAŞARISIZLIKTIR ve yeniden denenmez: aracın
         * kendi sözleşmesini bozması geçici bir arıza değil.
         */
        throw new ToolHatasi('gecersiz_cikti', ad, 'çıktı şemaya uymuyor');
      }
      ctx.log('tool_succeeded', { tool: ad, deneme });
      return c.data;
    } catch (e) {
      sonHata = e;
      const yeniden = e instanceof ToolHatasi ? e.yenidenDenenebilir : true;
      ctx.log('tool_failed', { tool: ad, deneme, yeniden });
      if (!yeniden || deneme === t.maxRetries) break;
    }
  }

  if (sonHata instanceof ToolHatasi) throw sonHata;
  throw new ToolHatasi('ic_hata', ad, String(sonHata), false);
}
