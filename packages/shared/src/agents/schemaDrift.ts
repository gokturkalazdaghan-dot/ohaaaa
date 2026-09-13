/**
 * ŞEMA SAPMASI DENETÇİSİ — üçüncü gerçek uzman ajan.
 *
 * `security` süpervizörüne bağlı. İşi: üretimdeki şema ve yetki durumunu
 * depodaki göç tanımlarıyla karşılaştırıp şüpheli sapmaları ve gizli
 * (latent) yetki risklerini SINIFLANDIRMAK.
 *
 * TESPİT EDER, DÜZELTMEZ.
 *
 * Bu ajan `propose_ddl` bile taşımıyor. Taşıdığı iki araç da salt okunur.
 * Bir bulguya "sil" diyemez, diyemeyeceği için de yanlış pozitif bir
 * bulgunun üretimde karşılığı olamaz. Sınır kod disiplininde değil, araç
 * listesinde.
 *
 * "GÖÇTE YOK" ≠ "SİLİNMELİ"
 *
 * Ohaaaa'nın üretim şeması ile göç geçmişi ayrışmış durumda: üretimde 51
 * tablo var, göçlerde 42 tablo bildiriliyor. Bu ayrışma bilinen bir durum
 * ve bir nesnenin göçlerde bulunamaması TEK BAŞINA onu fazlalık yapmaz.
 * Bu yüzden ajan asla "silinmeli" demiyor; "depo tanımında karşılığı
 * bulunamadı" diyor ve kararı insana bırakıyor.
 */

import { z } from 'zod';

import type { AgentContext, AgentDefinition, AgentResult } from '../orchestrator/types.js';
import type { ToolCtx, ToolKaydi } from '../tools/contract.js';
import { aracCalistir } from '../tools/contract.js';
import type { ReadDbCikti } from '../tools/readDb.js';
import type { ReadRepoCikti } from '../tools/readRepo.js';

export const DRIFT_YETENEGI = 'schema_drift_audit';

/** Göç dosyalarının bulunduğu dizin. */
export const GOC_DIZINI = 'supabase/migrations';

/**
 * BULGU SINIFLARI.
 *
 * Her sınıf bir EYLEM değil bir GÖZLEM. "Human review" sınıfı bilerek var:
 * belirsizliği bir sınıfa zorlamak, belirsizliği gizlemek olurdu.
 */
export type BulguSinifi =
  /** A — depoda tanımlı ve üretimde var. Normal. */
  | 'uyumlu'
  /** B — depo tanımında karşılığı yok ama üretimde var. */
  | 'sema_sapmasi_adayi'
  /** C — üretimde beklenmeyen yetki. */
  | 'yetki_sapmasi_adayi'
  /** D — RLS açık ve izin veren politika var. Güvenlik açısından hassas. */
  | 'guvenlik_hassas'
  /** E — RLS açık, politika yok, anon yazma yetkisi var. Gizli yetki riski. */
  | 'gizli_yetki_riski'
  /** F — kombinasyon belirsiz. İnsan incelemesi. */
  | 'insan_incelemesi';

export type Siddet = 'bilgi' | 'dusuk' | 'orta' | 'yuksek';

export const bulguSemasi = z.object({
  nesne: z.string(),
  sinif: z.enum([
    'uyumlu', 'sema_sapmasi_adayi', 'yetki_sapmasi_adayi',
    'guvenlik_hassas', 'gizli_yetki_riski', 'insan_incelemesi',
  ]),
  siddet: z.enum(['bilgi', 'dusuk', 'orta', 'yuksek']),
  depoTanimiVar: z.boolean(),
  rlsAcik: z.boolean(),
  politikaSayisi: z.number().int().nonnegative(),
  anonYazma: z.array(z.string()),
  /** Şu anda sömürülebilir mi — gizli risk ile karıştırılmamalı. */
  suAnSomurulebilir: z.boolean(),
  somurulemezlikSebebi: z.string().nullable(),
  /** Düzeltme HER ZAMAN insan onayı ister. */
  insanOnayiGerekir: z.boolean(),
});

export type Bulgu = z.infer<typeof bulguSemasi>;

export const driftCiktiSemasi = z.object({
  uretimTablo: z.number().int().nonnegative(),
  depoTablo: z.number().int().nonnegative(),
  gocDosyasi: z.number().int().nonnegative(),
  bulgular: z.array(bulguSemasi),
  /** Yalnızca dikkat isteyen sınıflar. */
  dikkatGerektiren: z.number().int().nonnegative(),
  temiz: z.boolean(),
});

export type DriftSonucu = z.infer<typeof driftCiktiSemasi>;

/** Yazma sayılan yetkiler. */
const YAZMA_YETKILERI = new Set(['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']);

/**
 * Göç SQL'inden bildirilen tablo adlarını çıkarır.
 *
 * Tam SQL ayrıştırıcısı DEĞİL ve olmamalı: amaç "bu ad depoda geçiyor mu"
 * sorusuna cevap vermek. Fazla yakalaması, az yakalamasından iyidir --
 * fazla yakalama bir tabloyu yanlışlıkla "uyumlu" sayar (sessiz), az
 * yakalama ise masum bir tabloyu "sapma" diye işaretler (gürültü ve
 * yanlış alarm). Bu ajanda yanlış alarm daha pahalı.
 */
export function gocteBildirilenTablolar(sql: string): Set<string> {
  const out = new Set<string>();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([A-Za-z0-9_.]+)"?/gi;
  for (const m of sql.matchAll(re)) out.add(m[1]!);
  /* `alter table ... rename to` ile doğan adlar da depo tanımıdır. */
  const yeniden = /alter\s+table\s+[^\s;]+\s+rename\s+to\s+"?([A-Za-z0-9_.]+)"?/gi;
  for (const m of sql.matchAll(yeniden)) out.add(m[1]!);
  return out;
}

export interface UretimTablo {
  tablo: string;
  rls_acik: boolean;
  politika: number;
}

export interface UretimYetki {
  rol: string;
  yetki: string;
}

/**
 * Tek bir tabloyu sınıflandırır. SAF FONKSİYON.
 *
 * Ayrı durması, doğrulayıcının aynı kuralı bağımsız toplanmış veriyle
 * yeniden uygulayabilmesini sağlıyor.
 */
export function siniflandir(
  t: UretimTablo, depoda: boolean, yetkiler: readonly UretimYetki[],
): Bulgu {
  const anonYazma = yetkiler
    .filter((y) => y.rol === 'anon' && YAZMA_YETKILERI.has(y.yetki))
    .map((y) => y.yetki)
    .sort();

  /*
   * SÖMÜRÜLEBİLİRLİK İLE GİZLİ RİSK AYRI ŞEYLER.
   *
   * RLS açık ve hiç politika yoksa varsayılan REDDİR: yetki dursa bile
   * anon satır yazamaz. Bunu "şu an sömürülebilir" diye raporlamak yanlış
   * alarm olurdu. Ama yetki orada bekliyor: bir gün izin veren tek bir
   * politika eklenirse anonim CRUD açılır. Doğru ifade budur.
   */
  const varsayilanRet = t.rls_acik && t.politika === 0;
  const suAnSomurulebilir = anonYazma.length > 0 && !varsayilanRet;

  let sinif: BulguSinifi;
  let siddet: Siddet;

  if (anonYazma.length > 0 && varsayilanRet) {
    sinif = 'gizli_yetki_riski';
    siddet = 'yuksek';
  } else if (anonYazma.length > 0) {
    sinif = 'guvenlik_hassas';
    siddet = 'yuksek';
  } else if (!t.rls_acik) {
    sinif = 'yetki_sapmasi_adayi';
    siddet = 'yuksek';
  } else if (!depoda) {
    sinif = 'sema_sapmasi_adayi';
    siddet = 'orta';
  } else {
    sinif = 'uyumlu';
    siddet = 'bilgi';
  }

  return {
    nesne: `public."${t.tablo}"`,
    sinif,
    siddet,
    depoTanimiVar: depoda,
    rlsAcik: t.rls_acik,
    politikaSayisi: t.politika,
    anonYazma,
    suAnSomurulebilir,
    somurulemezlikSebebi: suAnSomurulebilir
      ? null
      : varsayilanRet
        ? 'RLS açık ve politika yok — varsayılan ret'
        : 'anon yazma yetkisi yok',
    /* Hiçbir bulgu otomatik düzeltilemez. */
    insanOnayiGerekir: sinif !== 'uyumlu',
  };
}

/** Dikkat isteyen sınıflar — `uyumlu` dışındakiler. */
export function dikkatGerektirir(b: Bulgu): boolean {
  return b.sinif !== 'uyumlu';
}

export interface DriftSecenekleri {
  tool(ad: 'read_db' | 'read_repo'): ToolKaydi | undefined;
  toolCtx(ctx: AgentContext): ToolCtx;
}

/**
 * Ajan tanımı.
 *
 * İki araç, ikisi de salt okunur. `propose_ddl` YOK: bu ajan bir
 * düzeltme öneremez bile, yalnızca gözlem ve sınıflandırma üretir.
 */
export function schemaDriftAjani(opt: DriftSecenekleri): AgentDefinition<
  unknown, DriftSonucu
> {
  return {
    id: 'schema-drift-auditor',
    supervisor: 'security',
    capabilities: [DRIFT_YETENEGI],
    allowedTools: ['read_db', 'read_repo'],
    timeoutMs: 120_000,
    maxRetries: 0,
    marketScope: 'all',
    enabled: true,

    async run(_g: unknown, ctx: AgentContext): Promise<AgentResult<DriftSonucu>> {
      const db = opt.tool('read_db');
      const repo = opt.tool('read_repo');
      if (!db) throw new Error('read_db aracı kayıtlı değil');
      if (!repo) throw new Error('read_repo aracı kayıtlı değil');
      const tctx = opt.toolCtx(ctx);

      // --- Depo tarafı: göçlerde hangi tablolar bildiriliyor ---
      const dizin = await aracCalistir<
        { yol: string; mod: 'listele' }, ReadRepoCikti
      >(repo, { yol: GOC_DIZINI, mod: 'listele' }, tctx);

      const gocler = dizin.girdiler.filter((f) => f.endsWith('.sql'));
      const depoTablolari = new Set<string>();
      for (const dosya of gocler) {
        const d = await aracCalistir<{ yol: string; mod: 'oku' }, ReadRepoCikti>(
          repo, { yol: `${GOC_DIZINI}/${dosya}`, mod: 'oku' }, tctx,
        );
        for (const t of gocteBildirilenTablolar(d.icerik)) depoTablolari.add(t);
      }

      /*
       * FAIL-CLOSED: göç dosyası okunamadıysa hiçbir tabloyu "depoda yok"
       * ilan etmeyiz. Boş bir depo kümesiyle karşılaştırmak, 51 tablonun
       * tamamını sapma diye raporlamak olurdu.
       */
      if (gocler.length === 0 || depoTablolari.size === 0) {
        throw new Error(
          `Depo tanımı okunamadı: ${gocler.length} göç dosyası, ` +
          `${depoTablolari.size} tablo bildirimi — karşılaştırma güvenilmez`,
        );
      }

      // --- Üretim tarafı: tablo envanteri ---
      const envanter = await aracCalistir<{ sorgu: 'schema_tables' }, ReadDbCikti>(
        db, { sorgu: 'schema_tables' }, tctx,
      );
      const uretim = envanter.satirlar as unknown as UretimTablo[];
      if (uretim.length === 0) {
        throw new Error('Üretim tablo envanteri boş döndü — okuma güvenilmez');
      }

      // --- Yetkiler: yalnızca depoda karşılığı olmayan ya da RLS'siz olanlar ---
      const bulgular: Bulgu[] = [];
      for (const t of uretim) {
        const depoda = depoTablolari.has(t.tablo);
        /*
         * Yetki sorgusu HER tablo için atılmıyor: 51 ayrı sorgu üretim
         * veritabanını gereksiz yorar. Yalnızca ilgi çeken adaylar
         * sorgulanıyor -- depoda olmayanlar ve RLS'i kapalı olanlar.
         * Geri kalanlar için anon yazma yetkisi boş varsayılıyor ve bu
         * varsayım `uyumlu` sınıfının dışına çıkamaz.
         */
        let yetkiler: UretimYetki[] = [];
        if (!depoda || !t.rls_acik || t.politika === 0) {
          const y = await aracCalistir<
            { sorgu: 'table_grants'; tablo: string }, ReadDbCikti
          >(db, { sorgu: 'table_grants', tablo: t.tablo }, tctx);
          yetkiler = y.satirlar as unknown as UretimYetki[];
        }
        bulgular.push(siniflandir(t, depoda, yetkiler));
      }

      const dikkat = bulgular.filter(dikkatGerektirir);

      const cikti: DriftSonucu = {
        uretimTablo: uretim.length,
        depoTablo: depoTablolari.size,
        gocDosyasi: gocler.length,
        bulgular: dikkat,
        dikkatGerektiren: dikkat.length,
        temiz: dikkat.length === 0,
      };

      return {
        output: cikti,
        /*
         * 0.85 -- katalog okuması deterministik ama depo tarafı düzenli
         * ifadeyle çıkarılıyor ve göç ayrışması biliniyor. Ajan bu
         * belirsizliği beyan ediyor.
         */
        confidence: 0.85,
        evidence: [
          `üretim: ${uretim.length} tablo`,
          `depo: ${depoTablolari.size} tablo, ${gocler.length} göç dosyası`,
          `dikkat gerektiren: ${dikkat.length}`,
          ...dikkat.slice(0, 5).map((b) => `${b.nesne}: ${b.sinif}/${b.siddet}`),
        ],
      };
    },
  };
}
