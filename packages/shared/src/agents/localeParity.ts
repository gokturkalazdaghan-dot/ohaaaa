/**
 * YERELLEŞTİRME PARİTE AJANI — ilk gerçek uzman ajan.
 *
 * NEDEN BU İŞ GERÇEKTEN GEREKLİ
 * `MessageKey` tipi, `en.ts`'in `tr.ts` ile AYNI ANAHTARLARI taşımasını
 * derleme zamanında zorluyor. Yani "eksik anahtar" diye bir sorun yok ve
 * onu arayan bir ajan tip sisteminin kopyası olurdu.
 *
 * Tipin GÖREMEDİĞİ şey yer tutuculardır. `'ev.altBaslik'` metni `{vurgu}`
 * taşıyor; İngilizcesi `{highlight}` yazsa ya da hiç yazmasa DERLENİR --
 * ve çalışma anında kullanıcıya içi doldurulmamış bir metin gösterilir.
 * Ölçüldü: 135 anahtarın 52'si yer tutucu taşıyor, yani bu değişmez
 * katalogun üçte birini kapsıyor.
 *
 * İkinci kontrol: iki dilde BİREBİR AYNI olan uzun metinler. Bunların
 * çoğu çevrilmeyi bekleyen metindir. Hepsi değil -- `'{ad} · Ohaaaa'`
 * gibi marka kalıpları haklı olarak aynıdır. O yüzden bu bulgu HATA
 * değil UYARI olarak dönüyor: ajan karar vermiyor, işaret ediyor.
 *
 * DETERMİNİSTİK, MODELSİZ
 * Bu ajan `call_model` taşımıyor. Maliyet zincirinin en ucuz basamağı
 * (`deterministik`) bu işi tamamen çözüyor; modele çıkmak için hiçbir
 * gerekçe yok.
 */

import { z } from 'zod';

import type { AgentContext, AgentDefinition, AgentResult } from '../orchestrator/types.js';
import type { ToolCtx, ToolKaydi } from '../tools/contract.js';
import { aracCalistir } from '../tools/contract.js';
import type { ReadRepoCikti } from '../tools/readRepo.js';

export const YETENEK = 'locale_parity_audit';

export const TR_YOLU = 'packages/shared/src/messages/tr.ts';
export const EN_YOLU = 'packages/shared/src/messages/en.ts';

/** İki dilde farklı yer tutucu taşıyan anahtar. */
export interface YerTutucuSapmasi {
  anahtar: string;
  tr: string[];
  en: string[];
}

export const ciktiSemasi = z.object({
  /** İncelenen anahtar sayısı. */
  anahtar: z.number().int().nonnegative(),
  /** Yer tutucu taşıyan anahtar sayısı. */
  yerTutuculu: z.number().int().nonnegative(),
  /** HATA: iki dilde yer tutucular ayrışmış. */
  sapmalar: z.array(z.object({
    anahtar: z.string(), tr: z.array(z.string()), en: z.array(z.string()),
  })),
  /** UYARI: iki dilde birebir aynı uzun metinler. */
  cevrilmemisAdaylari: z.array(z.string()),
  temiz: z.boolean(),
});

export type ParitesonucU = z.infer<typeof ciktiSemasi>;

/** Marka kalıbı sayılacak uzunluk eşiği; altındakiler uyarı üretmez. */
const KISA_METIN_ESIGI = 12;

/**
 * Sözlük dosyasından `anahtar -> metin` çıkarır.
 *
 * TypeScript AYRIŞTIRILMIYOR ve bu bilinçli: dosyayı çalıştırmak
 * (`import`) bu ajanı derlenmiş çıktıya bağlardı; tam AST ayrıştırıcısı
 * ise bu iş için fazladan bir bağımlılık olurdu. Sözlükler tek biçimde
 * yazılıyor (`'anahtar': '...'`) ve düzenli ifade o biçimi karşılıyor.
 * Biçim değişirse anahtar sayısı düşer ve `anahtarSayisiTutarli`
 * doğrulaması bunu yakalar.
 */
export function sozlukAyristir(kaynak: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^[ \t]*'([^']+)':[ \t]*\n?[ \t]*'((?:[^'\\]|\\.)*)'/gm;
  for (const m of kaynak.matchAll(re)) out.set(m[1]!, m[2]!);
  return out;
}

/** Bir metindeki `{ad}` yer tutucuları -- sıralı ve tekrarsız. */
export function yerTutucular(metin: string): string[] {
  return [...new Set([...metin.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
}

/**
 * İki sözlüğü karşılaştırır. SAF FONKSİYON -- dosya okumaz.
 *
 * Ayrı durması, doğrulayıcının aynı mantığı bağımsız çalıştırabilmesini
 * sağlıyor: validator aracı yeniden çağırıp bu fonksiyonu kendisi
 * uyguluyor ve sonucu ajanınkiyle karşılaştırıyor.
 */
export function pariteyiOlc(
  tr: Map<string, string>, en: Map<string, string>,
): ParitesonucU {
  const sapmalar: YerTutucuSapmasi[] = [];
  const cevrilmemisAdaylari: string[] = [];
  let yerTutuculu = 0;

  for (const [anahtar, trMetin] of tr) {
    const enMetin = en.get(anahtar);
    if (enMetin === undefined) continue; // tip zaten engelliyor

    const a = yerTutucular(trMetin);
    const b = yerTutucular(enMetin);
    if (a.length > 0) yerTutuculu++;
    if (a.join('|') !== b.join('|')) sapmalar.push({ anahtar, tr: a, en: b });

    if (trMetin === enMetin && trMetin.length > KISA_METIN_ESIGI) {
      cevrilmemisAdaylari.push(anahtar);
    }
  }

  return {
    anahtar: tr.size,
    yerTutuculu,
    sapmalar,
    cevrilmemisAdaylari,
    /* TEMİZ yalnızca sapma yoksa. Uyarılar temizliği bozmaz. */
    temiz: sapmalar.length === 0,
  };
}

/** Sözlük beklenenden az anahtar verdiyse ayrıştırma bozulmuş demektir. */
export const EN_AZ_ANAHTAR = 50;

export interface ParitesAjaniSecenekleri {
  /** Araçları çözen fonksiyon. Ajan kendi aracını kendisi üretmez. */
  tool(ad: 'read_repo'): ToolKaydi | undefined;
  toolCtx(ctx: AgentContext): ToolCtx;
}

/**
 * Ajan tanımı.
 *
 * `growth` süpervizörüne bağlı, yalnızca `read_repo` taşıyor. Yazma
 * yetkisi yok, model çağrısı yok, ağ erişimi yok -- en az yetki.
 */
export function localeParityAjani(opt: ParitesAjaniSecenekleri): AgentDefinition<
  unknown, ParitesonucU
> {
  return {
    id: 'localization-parity',
    supervisor: 'growth',
    capabilities: [YETENEK],
    allowedTools: ['read_repo'],
    timeoutMs: 15_000,
    /* Dosya okuma hatası geçici değil; yeniden deneme yeni bilgi vermez. */
    maxRetries: 0,
    marketScope: 'all',
    enabled: true,

    async run(_girdi: unknown, ctx: AgentContext): Promise<AgentResult<ParitesonucU>> {
      const arac = opt.tool('read_repo');
      if (!arac) throw new Error('read_repo aracı kayıtlı değil');
      const tctx = opt.toolCtx(ctx);

      const trDosya = await aracCalistir<{ yol: string }, ReadRepoCikti>(
        arac, { yol: TR_YOLU }, tctx,
      );
      const enDosya = await aracCalistir<{ yol: string }, ReadRepoCikti>(
        arac, { yol: EN_YOLU }, tctx,
      );

      const tr = sozlukAyristir(trDosya.icerik);
      const en = sozlukAyristir(enDosya.icerik);

      /*
       * FAIL-CLOSED: ayrıştırma beklenenden az anahtar verdiyse sözlük
       * biçimi değişmiş demektir. Bu durumda "sapma yok" demek, kontrolü
       * hiç yapmamışken temiz rapor vermek olurdu.
       */
      if (tr.size < EN_AZ_ANAHTAR || en.size < EN_AZ_ANAHTAR) {
        throw new Error(
          `Sözlük ayrıştırması güvenilmez: tr=${tr.size}, en=${en.size}, ` +
          `beklenen en az ${EN_AZ_ANAHTAR}`,
        );
      }

      const sonuc = pariteyiOlc(tr, en);

      return {
        output: sonuc,
        /*
         * Deterministik bir ölçümün güveni tam. Ajan bir tahmin
         * yürütmüyor; iki dosyayı okuyup karşılaştırıyor.
         */
        confidence: 1,
        evidence: [
          `${TR_YOLU}: ${tr.size} anahtar, ${trDosya.bayt} bayt`,
          `${EN_YOLU}: ${en.size} anahtar, ${enDosya.bayt} bayt`,
          `${sonuc.yerTutuculu} anahtar yer tutucu taşıyor`,
          `${sonuc.sapmalar.length} yer tutucu sapması`,
        ],
      };
    },
  };
}
