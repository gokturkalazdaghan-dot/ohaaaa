import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ToolHatasi, aracCalistir } from './contract.js';
import type { ToolCtx, ToolKaydi } from './contract.js';
import {
  EN_COK_SATIR, SORGULAR, SORGU_KIMLIKLERI, degeriMaskele, hatayiTemizle, readDbAraci,
} from './readDb.js';
import type { MetadataYurutucu } from './readDb.js';

/**
 * KAYIT TUTAN YÜRÜTÜCÜ.
 *
 * Testlerin çoğu "hata fırlattı mı" diye bakmıyor; araçtan veritabanına
 * GERÇEKTEN NE ULAŞTIĞINI ölçüyor. Güvenlik iddiası "reddedildi" değil,
 * "o SQL hiç üretilmedi" -- ve bunu ancak kaydı okuyarak kanıtlayabiliriz.
 */
class KayitliYurutucu implements MetadataYurutucu {
  readonly cagrilar: Array<{ sql: string; params: readonly unknown[] }> = [];
  constructor(private readonly sonuc: Record<string, unknown>[] = []) {}
  async sorgula(sql: string, params: readonly unknown[]) {
    this.cagrilar.push({ sql, params });
    return this.sonuc;
  }
}

function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    agentId: 'test', izinliAraclar: new Set(['read_db']),
    guvenliMod: false, kalanMs: 20_000, log: () => {}, ...over,
  };
}
const arac = (y: MetadataYurutucu) => readDbAraci(y) as unknown as ToolKaydi;

// --- 1 · bilinen sorgu ----------------------------------------------------

test('1 · bilinen sorgu kimligi calisir ve SABIT SQL gonderilir', async () => {
  const y = new KayitliYurutucu([{ tablo: 'products', rls_acik: true }]);
  const r = await aracCalistir<{ sorgu: 'schema_tables' }, { satirSayisi: number }>(
    arac(y), { sorgu: 'schema_tables' }, ctx(),
  );
  assert.equal(r.satirSayisi, 1);
  assert.equal(y.cagrilar.length, 1);
  assert.equal(y.cagrilar[0]!.sql, SORGULAR.schema_tables.sql);
});

// --- 2 · bilinmeyen sorgu -------------------------------------------------

test('2 · bilinmeyen sorgu kimligi REDDEDILIR ve DB HIC CAGRILMAZ', async () => {
  const y = new KayitliYurutucu();
  await assert.rejects(
    aracCalistir(arac(y), { sorgu: 'her_seyi_oku' }, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'gecersiz_girdi',
  );
  assert.equal(y.cagrilar.length, 0, 'reddedilen sorgu veritabanina ULASMAMALI');
});

// --- 3 · keyfi SQL --------------------------------------------------------

test('3 · keyfi SQL gondermek MUMKUN DEGIL -- alan yok', async () => {
  const y = new KayitliYurutucu();
  for (const girdi of [
    { sql: 'select * from users' },
    { sorgu: 'select 1' },
    { sorgu: 'schema_tables', sql: 'drop table products' },
    { query: 'select * from api_keys' },
  ]) {
    try {
      await aracCalistir(arac(y), girdi, ctx());
    } catch { /* bazilari semada duser, bazilari gecebilir */ }
  }
  /* Asil iddia: gonderilen HER SQL sabit kumeden. */
  const sabitler = new Set<string>(Object.values(SORGULAR).map((s) => s.sql));
  for (const c of y.cagrilar) {
    assert.ok(sabitler.has(c.sql), `sabit olmayan SQL uretildi: ${c.sql.slice(0, 60)}`);
  }
});

// --- 4-8 · yazma / DDL denemeleri ----------------------------------------

test('4-8 · INSERT/UPDATE/DELETE/DROP/GRANT denemeleri DB YE ULASMAZ', async () => {
  const y = new KayitliYurutucu();
  const kotucul = [
    "insert into users values (1)",
    "update products set price = 0",
    "delete from orders",
    "drop table product_groups",
    "grant all on users to anon",
    "; truncate products; --",
  ];
  for (const k of kotucul) {
    /* Hem sorgu kimligi olarak hem tablo adi olarak deniyoruz. */
    await aracCalistir(arac(y), { sorgu: k }, ctx()).catch(() => {});
    await aracCalistir(arac(y), { sorgu: 'table_columns', tablo: k }, ctx()).catch(() => {});
  }
  const sabitler = new Set<string>(Object.values(SORGULAR).map((s) => s.sql));
  for (const c of y.cagrilar) {
    assert.ok(sabitler.has(c.sql));
    /* Kotucul metin SQL'e degil PARAMETREYE dusmus olabilir -- sorun degil. */
    assert.ok(!/insert|update|delete|drop|grant|truncate|alter/i.test(c.sql),
              'uretilen SQL yazma ifadesi icermemeli');
  }
});

test('4b · sabit SQL kumesinin TAMAMI salt okunur', () => {
  for (const [kimlik, s] of Object.entries(SORGULAR)) {
    assert.ok(/^\s*select\b/i.test(s.sql.trim()), `${kimlik} select ile baslamiyor`);
    assert.ok(!/\b(insert|update|delete|drop|create|alter|grant|revoke|truncate)\b/i.test(s.sql),
              `${kimlik} yazma anahtar kelimesi iceriyor`);
  }
});

// --- 9 · tablo enjeksiyonu ------------------------------------------------

test('9 · tablo adi SQL METNINE GIRMEZ, baglama parametresi olur', async () => {
  const y = new KayitliYurutucu();
  const kotucul = "x'; drop table products; --";
  /* Bicim suzgeci bunu zaten eler; once onu dogrula. */
  await assert.rejects(
    aracCalistir(arac(y), { sorgu: 'table_columns', tablo: kotucul }, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'gecersiz_girdi',
  );
  assert.equal(y.cagrilar.length, 0);

  /* Bicime uyan bir ad ise: SQL degismez, ad parametre olarak gider. */
  const y2 = new KayitliYurutucu();
  await aracCalistir(arac(y2), { sorgu: 'table_columns', tablo: 'Ohaaaa.com' }, ctx());
  assert.equal(y2.cagrilar[0]!.sql, SORGULAR.table_columns.sql);
  assert.deepEqual(y2.cagrilar[0]!.params, ['Ohaaaa.com']);
  assert.equal(y2.cagrilar[0]!.sql.includes('Ohaaaa'), false, 'ad SQL metnine girmemeli');
});

test('9b · tablo istemeyen sorguya tablo gecirmek parametre EKLEMEZ', async () => {
  const y = new KayitliYurutucu();
  await aracCalistir(arac(y), { sorgu: 'schema_tables', tablo: 'users' }, ctx());
  assert.deepEqual(y.cagrilar[0]!.params, []);
});

test('9c · tablo isteyen sorgu tablosuz REDDEDILIR', async () => {
  const y = new KayitliYurutucu();
  await assert.rejects(
    aracCalistir(arac(y), { sorgu: 'table_grants' }, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'gecersiz_girdi',
  );
  assert.equal(y.cagrilar.length, 0);
});

// --- 10 · zaman aşımı -----------------------------------------------------

test('10 · yavas sorgu zaman asimina ugrar', async () => {
  const yavas: MetadataYurutucu = {
    async sorgula() { await new Promise((r) => setTimeout(r, 500)); return []; },
  };
  await assert.rejects(
    aracCalistir(arac(yavas), { sorgu: 'schema_tables' }, ctx({ kalanMs: 20 })),
    (e) => e instanceof ToolHatasi && e.kod === 'zaman_asimi',
  );
});

// --- 11 · sonuç boyutu ----------------------------------------------------

test('11 · satir tavani asilirsa KIRPILIR', async () => {
  const cok = Array.from({ length: EN_COK_SATIR + 50 }, (_, i) => ({ tablo: `t${i}` }));
  const r = await aracCalistir<{ sorgu: 'schema_tables' }, { satirSayisi: number; kirpildi: boolean }>(
    arac(new KayitliYurutucu(cok)), { sorgu: 'schema_tables' }, ctx(),
  );
  assert.equal(r.satirSayisi, EN_COK_SATIR);
  assert.equal(r.kirpildi, true);
});

test('11b · bayt tavani satir sayisi dusukken de uygulanir', async () => {
  const dev = [{ tanim: 'x'.repeat(300 * 1024) }];
  const r = await aracCalistir<{ sorgu: 'schema_tables' }, { satirSayisi: number; kirpildi: boolean }>(
    arac(new KayitliYurutucu(dev)), { sorgu: 'schema_tables' }, ctx(),
  );
  assert.equal(r.kirpildi, true);
  assert.equal(r.satirSayisi, 0);
});

// --- 12 · sır maskeleme ---------------------------------------------------

test('12 · sonuctaki sir bicimli degerler MASKELENIR', async () => {
  /* Fixture'lar calisma aninda birlestiriliyor: tam metin yazilsaydi
     `verify-secrets` bu dosyayi hakli olarak sizinti sayardi. */
  const sizinti = [{
    tanim: 'baglanti postgres' + 'ql://kullanici:parola@host/db',
    not: 'anahtar sb' + 'p_0123456789abcdefghij',
    ic: { derin: 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJhIjoxfQ.abcdefghijklmnop' },
  }];
  const r = await aracCalistir<{ sorgu: 'schema_tables' }, { satirlar: Record<string, unknown>[] }>(
    arac(new KayitliYurutucu(sizinti)), { sorgu: 'schema_tables' }, ctx(),
  );
  const metin = JSON.stringify(r.satirlar);
  assert.ok(metin.includes('[MASKELENDI]'));
  assert.equal(metin.includes('sbp_0123456789'), false);
  assert.equal(metin.includes('postgresql://'), false);
  assert.equal(metin.includes('eyJhbGciOiJIUzI1NiJ9'), false);
});

test('12b · maskeleme ic ice nesnelerde de calisir', () => {
  const m = degeriMaskele({ a: [{ b: 'gh' + 'p_012345678901234567890123' }] });
  assert.equal(JSON.stringify(m).includes('gh' + 'p_'), false);
});

// --- 13 · hata temizleme --------------------------------------------------

test('13 · veritabani hatasi TEMIZLENIR -- ham hata sizmaz', async () => {
  const patlayan: MetadataYurutucu = {
    async sorgula() {
      throw new Error('connection failed: postgres' + 'ql://u:gizli@db.host:5432/postgres');
    },
  };
  await assert.rejects(
    aracCalistir(arac(patlayan), { sorgu: 'schema_tables' }, ctx()),
    (e) => e instanceof ToolHatasi && e.kod === 'ic_hata' &&
           !e.message.includes('gizli') && e.message.includes('[MASKELENDI]'),
  );
});

test('13b · cok uzun hata kirpilir', () => {
  assert.ok(hatayiTemizle(new Error('x'.repeat(1000))).length <= 301);
});

// --- 14-15 · izin ve yetenek ---------------------------------------------

test('14 · read_db tasimayan ajan CALISTIRAMAZ ve DB CAGRILMAZ', async () => {
  const y = new KayitliYurutucu();
  await assert.rejects(
    aracCalistir(arac(y), { sorgu: 'schema_tables' },
                 ctx({ izinliAraclar: new Set(['read_repo']) })),
    (e) => e instanceof ToolHatasi && e.kod === 'izin_yok',
  );
  assert.equal(y.cagrilar.length, 0);
});

test('15 · guvenli modda read_db calisir -- okuma sinifi', async () => {
  const y = new KayitliYurutucu([{ tablo: 'x' }]);
  const r = await aracCalistir<{ sorgu: 'schema_tables' }, { satirSayisi: number }>(
    arac(y), { sorgu: 'schema_tables' }, ctx({ guvenliMod: true }),
  );
  assert.equal(r.satirSayisi, 1);
});

// --- 16 · yazma yolu erişilemez ------------------------------------------

test('16 · aractan cikabilecek SQL kumesi SONLU ve tamami salt okunur', () => {
  /* Bu testin iddiasi su: aracin uretebilecegi butun SQL metinleri bu
     dosyada okunabilir durumda ve sayisi yedi. Ajanin ne yazdigi bu
     kumeyi degistiremez. */
  assert.equal(SORGU_KIMLIKLERI.length, 7);
  assert.equal(Object.keys(SORGULAR).length, 7);
  for (const s of Object.values(SORGULAR)) {
    assert.ok(!s.sql.includes('${'), 'SQL metninde sablon ifadesi olmamali');
    assert.ok(!s.sql.includes('+'), 'SQL metni birlestirilmemeli');
  }
});

test('16b · yurutucu araca DISARIDAN veriliyor -- arac kimlik TASIMIYOR', async () => {
  /*
   * Arac bir baglanti ACMIYOR ve kimlik bilgisi TASIMIYOR: hangi kimlikle
   * calisilacagina cagiran karar veriyor. Iddia davranissal olarak
   * kanitlaniyor -- iki ayri yurutucuyle kurulan iki arac, her biri
   * KENDI yurutucusune gidiyor; arac icinde saklanan global bir baglanti
   * olsaydi bu ayrim cokerdi.
   */
  const a = new KayitliYurutucu();
  const b = new KayitliYurutucu();
  await aracCalistir(arac(a), { sorgu: 'schema_tables' }, ctx());
  assert.equal(a.cagrilar.length, 1);
  assert.equal(b.cagrilar.length, 0);

  await aracCalistir(arac(b), { sorgu: 'function_metadata' }, ctx());
  assert.equal(a.cagrilar.length, 1, 'ilk arac ikinci cagriyi gormemeli');
  assert.equal(b.cagrilar.length, 1);
});
