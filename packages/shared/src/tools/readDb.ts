/**
 * `read_db` ARACI — SALT OKUNUR ŞEMA META VERİSİ.
 *
 * AJAN SQL GÖNDEREMEZ.
 *
 * Güvenlik sınırı metin süzmeye DAYANMIYOR. "Şu kelimeler yasak" biçiminde
 * bir savunma, her yeni kaçış biçiminde yeniden kırılır ve kırıldığında
 * veritabanının tamamı açılır. Burada saldırı yüzeyi mekanik olarak yok:
 *
 *   1. Girdi kapalı bir enum -- sorgu METNİ değil, sorgu KİMLİĞİ seçiliyor.
 *   2. SQL metinleri bu dosyada SABİT. Çalışma anında üretilmiyor,
 *      birleştirilmiyor, biçimlendirilmiyor.
 *   3. Tablo adı bile metne GİRMİYOR: bağlama parametresi ($1) olarak
 *      geçiyor. Yani `'; DROP TABLE x; --` yazan bir girdi, aranan tablo
 *      ADI olarak işlenir ve hiçbir satır döndürmez.
 *
 * Üçünün birleşimi şunu garanti ediyor: bu araçtan çıkan SQL kümesi
 * SONLU ve bu dosyada okunabilir. Ajanın ne yazdığı o kümeyi değiştirmez.
 *
 * YAZMA YOLU YOK
 * Sorguların tamamı `pg_catalog` / `information_schema` üzerinde `select`.
 * Bir `insert`/`update`/`delete`/DDL ifadesi yazmanın yolu, bu dosyayı
 * düzenlemekten geçer -- ki o da kod incelemesi ve testlerden geçer.
 */

import { z } from 'zod';

import type { ToolCtx, ToolTanimi } from './contract.js';
import { ToolHatasi } from './contract.js';

/**
 * SABİT SORGU KÜMESİ.
 *
 * Hepsi katalog okuması, hepsi hedefli, hiçbiri kullanıcı tablosunu
 * taramıyor. Üretim veritabanını kilitleyecek ya da ağır tarama üretecek
 * bir sorgu bilerek yok: `count(*)` bile bir kullanıcı tablosunda
 * çalıştırılmıyor.
 */
export const SORGULAR = {
  /** public şemasındaki tablolar + RLS durumu + politika sayısı. */
  schema_tables: {
    tabloGerekir: false,
    aciklama: 'public şemasındaki tablolar, RLS durumu ve politika sayısı',
    sql: `select c.relname as tablo,
                 c.relrowsecurity as rls_acik,
                 c.relforcerowsecurity as rls_zorunlu,
                 (select count(*) from pg_policy p where p.polrelid = c.oid)::int as politika
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
          order by c.relname`,
  },
  /** Bir tablonun sütunları. */
  table_columns: {
    tabloGerekir: true,
    aciklama: 'bir tablonun sütun adları ve tipleri',
    sql: `select column_name as sutun, data_type as tip, is_nullable as bos_olabilir
          from information_schema.columns
          where table_schema = 'public' and table_name = $1
          order by ordinal_position`,
  },
  /** Bir tablonun RLS politikaları. */
  table_policies: {
    tabloGerekir: true,
    aciklama: 'bir tablonun RLS politikaları ve hedef rolleri',
    sql: `select p.polname as politika,
                 p.polcmd::text as komut,
                 p.polroles::regrole[]::text[] as roller,
                 p.polpermissive as izin_veren
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1
          order by p.polname`,
  },
  /** Bir tablodaki rol yetkileri. */
  table_grants: {
    tabloGerekir: true,
    aciklama: 'bir tablodaki rol bazlı yetkiler',
    sql: `select grantee as rol, privilege_type as yetki
          from information_schema.role_table_grants
          where table_schema = 'public' and table_name = $1
          order by grantee, privilege_type`,
  },
  /** Bir tablonun indeksleri. */
  table_indexes: {
    tabloGerekir: true,
    aciklama: 'bir tablonun indeksleri',
    sql: `select indexname as indeks, indexdef as tanim
          from pg_indexes
          where schemaname = 'public' and tablename = $1
          order by indexname`,
  },
  /** Bir tabloya bağlı yabancı anahtarlar (iki yön). */
  table_references: {
    tabloGerekir: true,
    aciklama: 'bir tabloya giden ve ondan çıkan yabancı anahtarlar',
    sql: `select con.conname as kisit,
                 src.relname as kaynak_tablo,
                 tgt.relname as hedef_tablo
          from pg_constraint con
          join pg_class src on src.oid = con.conrelid
          join pg_class tgt on tgt.oid = con.confrelid
          where con.contype = 'f'
            and (src.relname = $1 or tgt.relname = $1)
          order by con.conname`,
  },
  /** public şemasındaki fonksiyonların güvenlik meta verisi. */
  function_metadata: {
    tabloGerekir: false,
    aciklama: 'fonksiyonların SECURITY DEFINER ve search_path durumu',
    sql: `select p.proname as fonksiyon,
                 p.prosecdef as security_definer,
                 (coalesce(array_to_string(p.proconfig, ','), '') like '%search_path%') as search_path_sabit
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
          order by p.proname`,
  },
} as const;

export type SorguKimligi = keyof typeof SORGULAR;

export const SORGU_KIMLIKLERI = Object.keys(SORGULAR) as SorguKimligi[];

/**
 * Tablo adı biçimi.
 *
 * Enjeksiyona karşı savunma DEĞİL -- ad zaten bağlama parametresi olarak
 * geçiyor ve SQL metnine hiç girmiyor. Bu kontrol yalnızca anlamsız
 * girdiyi erken eler ve hata mesajını okunur tutar.
 *
 * Nokta İZİNLİ: üretimde `Ohaaaa.com` adında bir tablo var ve aracın onu
 * okuyabilmesi gerekiyor.
 */
const TABLO_ADI = /^[A-Za-z0-9_. -]{1,63}$/;

export const readDbGirdi = z.object({
  sorgu: z.enum([
    'schema_tables', 'table_columns', 'table_policies',
    'table_grants', 'table_indexes', 'table_references', 'function_metadata',
  ]),
  tablo: z.string().regex(TABLO_ADI).optional(),
});

export const readDbCikti = z.object({
  sorgu: z.string(),
  tablo: z.string().nullable(),
  satirlar: z.array(z.record(z.unknown())),
  satirSayisi: z.number().int().nonnegative(),
  kirpildi: z.boolean(),
  sureMs: z.number().int().nonnegative(),
});

export type ReadDbGirdi = z.infer<typeof readDbGirdi>;
export type ReadDbCikti = z.infer<typeof readDbCikti>;

/** Kaynak tavanları. Aşan sonuç kırpılır, bayrak kaldırılır. */
export const EN_COK_SATIR = 500;
export const EN_BUYUK_SONUC_BAYT = 256 * 1024;
export const SORGU_SURESI_MS = 15_000;

/**
 * Veritabanı yürütücü ARAYÜZÜ.
 *
 * Araç bir bağlantı AÇMIYOR ve kimlik bilgisi TAŞIMIYOR. Bağlantı dışarıdan
 * enjekte ediliyor; bu sayede araç hiçbir sırra erişemiyor ve testler
 * gerçek bir veritabanı olmadan güvenlik sınırını sınayabiliyor.
 *
 * Üretim uygulaması, S1'de tasarlanan DAR ve SALT OKUNUR role bağlanacak --
 * service-role'e değil. O rol henüz yok (DDL gerektiriyor).
 */
export interface MetadataYurutucu {
  /** Yalnızca sabit SQL ve bağlama parametresi alır. */
  sorgula(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]>;
}

/** Sır biçimli değerler sonuçta görünürse maskelenir. */
const SIR_KALIPLARI: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bsb[ps]_[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bpostgres(?:ql)?:\/\/[^\s"']+/g,
];

/** Bir değerdeki sır biçimlerini maskeler. Nesneleri derinlemesine gezer. */
export function degeriMaskele(v: unknown): unknown {
  if (typeof v === 'string') {
    let m = v;
    for (const k of SIR_KALIPLARI) m = m.replace(k, '[MASKELENDI]');
    return m;
  }
  if (Array.isArray(v)) return v.map(degeriMaskele);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = degeriMaskele(x);
    return o;
  }
  return v;
}

/**
 * Hata metnini temizler.
 *
 * Veritabanı hataları bağlantı dizesi, sunucu adı ve sorgu parçası
 * taşıyabiliyor. Ham hatayı ajana ve denetim izine geçirmek, keşif
 * bilgisini saldırganın eline vermek olurdu.
 */
export function hatayiTemizle(e: unknown): string {
  const ham = e instanceof Error ? e.message : String(e);
  const maskeli = degeriMaskele(ham) as string;
  return maskeli.length > 300 ? maskeli.slice(0, 300) + '…' : maskeli;
}

/**
 * Salt okunur meta veri aracı üretir.
 *
 * Yürütücü kurulum anında veriliyor; ajan onu değiştiremiyor.
 */
export function readDbAraci(yurutucu: MetadataYurutucu): ToolTanimi<ReadDbGirdi, ReadDbCikti> {
  return {
    ad: 'read_db',
    aciklama: `${SORGU_KIMLIKLERI.length} sabit salt okunur katalog sorgusu`,
    girdiSemasi: readDbGirdi,
    ciktiSemasi: readDbCikti,
    varsayilanTimeoutMs: SORGU_SURESI_MS,
    /* Katalog okuması geçici hata üretmez; tekrar aynı sonucu verir. */
    maxRetries: 0,

    async calistir(girdi: ReadDbGirdi, ctx: ToolCtx): Promise<ReadDbCikti> {
      const tanim = SORGULAR[girdi.sorgu];
      if (!tanim) {
        throw new ToolHatasi('gecersiz_girdi', 'read_db', 'bilinmeyen sorgu kimliği');
      }
      if (tanim.tabloGerekir && !girdi.tablo) {
        throw new ToolHatasi('gecersiz_girdi', 'read_db', `${girdi.sorgu} tablo adı ister`);
      }

      /*
       * Parametre listesi sorgu tanımından türetiliyor, girdiden değil:
       * tablo istemeyen bir sorguya tablo geçirilmesi sessizce yok sayılır,
       * fazladan parametre SQL'e ulaşmaz.
       */
      const params = tanim.tabloGerekir ? [girdi.tablo] : [];

      const t0 = Date.now();
      let ham: Record<string, unknown>[];
      try {
        ham = await yurutucu.sorgula(tanim.sql, params);
      } catch (e) {
        throw new ToolHatasi('ic_hata', 'read_db', hatayiTemizle(e));
      }
      const sureMs = Date.now() - t0;

      let satirlar = ham.map((r) => degeriMaskele(r) as Record<string, unknown>);
      let kirpildi = false;

      if (satirlar.length > EN_COK_SATIR) {
        satirlar = satirlar.slice(0, EN_COK_SATIR);
        kirpildi = true;
      }
      /* Bayt tavanı: satır sayısı düşükken bile tek bir dev alan olabilir. */
      while (satirlar.length > 0 &&
             Buffer.byteLength(JSON.stringify(satirlar), 'utf8') > EN_BUYUK_SONUC_BAYT) {
        satirlar = satirlar.slice(0, Math.floor(satirlar.length / 2));
        kirpildi = true;
      }

      ctx.log('read_db_bitti', {
        sorgu: girdi.sorgu, satir: satirlar.length, kirpildi, sureMs,
      });

      return {
        sorgu: girdi.sorgu,
        tablo: girdi.tablo ?? null,
        satirlar,
        satirSayisi: satirlar.length,
        kirpildi,
        sureMs,
      };
    },
  };
}
