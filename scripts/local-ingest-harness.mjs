#!/usr/bin/env node
/**
 * GERCEK alim hattini YEREL veritabanina karsi ucdan uca calistirir.
 *
 * NEDEN VAR
 * Production'a yazabilmek icin iki sey eksik ve ikisi de bu ortamda YOK:
 * `SUPABASE_SERVICE_ROLE_KEY` (alim CLI'i onsuz baslamiyor) ve Back to the
 * Office'in GERCEK komisyon orani (magaza onsuz yayina alinamiyor). Ikisini
 * beklerken zincirin geri kalanini kanitsiz birakmak, secret'lar geldiginde
 * butun hatalari ayni anda kesfetmek olurdu.
 *
 * Bu betik ayni semaya (ayni gocler) sahip YEREL bir veritabanina, GERCEK
 * feed verisiyle, GERCEK `runSource` islevini calistirir. Sahte urun yok:
 * satirlar Awin'in kendi feed'inden geliyor. Production'a HICBIR SEY yazmaz.
 *
 * Kullanim:
 *   node scripts/local-ingest-harness.mjs <feed.csv.gz> [--limit 500]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import pg from 'pg';

import { runSource } from '../packages/ingest/dist/pipeline.js';
import { AWIN_FEED_MAPPING } from '../packages/shared/dist/providers/awinFeed.js';
import { allowedHostsForMerchant } from '../packages/shared/dist/affiliate.js';

const [, , dosya, ...bayraklar] = process.argv;
if (!dosya) {
  console.error('Kullanim: node scripts/local-ingest-harness.mjs <feed.csv.gz> [--limit N]');
  process.exit(2);
}
const limitIdx = bayraklar.indexOf('--limit');
const LIMIT = limitIdx === -1 ? 500 : Number(bayraklar[limitIdx + 1]);

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgresql:///ohaaaa_src?host=/var/run/postgresql',
});
await db.connect();

const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const [kaynak] = await q(
  `select s.id, s.slug, s.merchant_id, s.kind, s.endpoint_url, s.field_mapping,
          s.currency, s.market_code, s.country_code,
          m.homepage_url, m.deeplink_template
     from public.sources s join public.merchants m on m.id = s.merchant_id
    where s.slug = 'bto-instock'`,
);
if (!kaynak) {
  console.error('bto-instock kaynagi yok. Once gocleri uygulayin.');
  process.exit(1);
}

/*
 * IZINLI ALAN ADLARI: kaynagi okuyan gercek kodla AYNI yerden turetiliyor
 * (`allowedHostsForMerchant`). Harness burada kendi kuralini uydursaydi,
 * kanitladigi sey production'da calisan sey olmazdi.
 */
const izinliHostlar = allowedHostsForMerchant({
  homepageUrl: kaynak.homepage_url ?? '',
  deeplinkTemplate: kaynak.deeplink_template ?? null,
});

/*
 * Feed AGDAN DEGIL diskten okunuyor ve BURADA aciliyor. Gercek hatta bu isi
 * `politeClient` yapar (govde/acilmis boyut sinirleri, gzip bomb korumasi ile
 * birlikte) ve `runSource`a DUZ METIN verir -- adapter dogrudan `body`yi
 * ayristirir. Harness de ayni sekli vermeli; gzip baytlarini dize olarak
 * gecirmek satirlarin yarisini bozuyordu.
 */
const hamGz = readFileSync(dosya);
const ham = dosya.endsWith('.gz') ? gunzipSync(hamGz) : hamGz;

/* Feed AGDAN DEGIL diskten okunuyor: harness'in kanitladigi sey ayristirma
 * ve yazma zinciri; indirme zaten ayrica olculdu (http=200, gzip). */
const fetcher = {
  async get() {
    return { body: ham.toString('utf8'), contentType: 'text/csv' };
  },
};

const repository = {
  async findCategoryIdsBySlug(slugs) {
    if (slugs.length === 0) return new Map();
    const rows = await q(`select id, slug from public.categories where slug = any($1)`, [slugs]);
    return new Map(rows.map((r) => [String(r.slug), String(r.id)]));
  },
  async findGroupsByGtin(gtins) {
    if (gtins.length === 0) return new Map();
    const rows = await q(
      `select id, gtin_normalized from public.product_groups where gtin_normalized = any($1)`,
      [gtins],
    );
    return new Map(rows.map((r) => [String(r.gtin_normalized), String(r.id)]));
  },
  async findGroupsBySignature(sigs) {
    if (sigs.length === 0) return new Map();
    const rows = await q(
      `select id, match_signature from public.product_groups where match_signature = any($1)`,
      [sigs],
    );
    return new Map(rows.map((r) => [String(r.match_signature), String(r.id)]));
  },
  async createGroups(groups) {
    /*
     * DONEN HARITA IMZAYLA ANAHTARLANIR, DIZINLE DEGIL. `matchCanonicalGroups`
     * sonucu dogrudan `bySignature`e yaziyor; dizinle anahtarlamak butun
     * gruplarin bulunamamasina ve her teklifin `group_id = null` yazilmasina
     * yol aciyordu -- urunler girer ama HICBIRI aramada gorunmezdi.
     */
    const harita = new Map();
    for (let i = 0; i < groups.length; i += 1) {
      const g = groups[i];
      /*
       * SLUG SONEKI IMZANIN OZETI, IMZANIN ILK 8 KARAKTERI DEGIL.
       *
       * `product_signature` bir HASH degil, normalize edilmis metin. Ilk 8
       * karakterini almak "the-black-..." gibi ortak baslangiclari ayni
       * soneke dusuruyordu ve tek turda `product_groups_slug_key`
       * cakisiyordu. Ozet, imzanin TAMAMINI temsil ediyor.
       */
      const base = (g.title || 'urun').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
      const ozet = createHash('sha1')
        .update(`${g.signature}|${g.gtin ?? ''}`)
        .digest('hex')
        .slice(0, 12);
      const slug = `${base}-${ozet}`;
      /*
       * `match_signature`, `gtin_normalized` ve `canonical_key` URETILMIS
       * sutunlar -- deger yazilamaz, veritabani kendi hesaplar. Cakisma da
       * bu yuzden `canonical_key` uzerinden cozuluyor: kanonik kimligin
       * tekilligini zaten O tasiyor (product_groups_canonical_key_idx).
       */
      const rows = await q(
        `insert into public.product_groups
           (slug, title, brand, gtin, image_url, category_id, offer_count)
         values ($1,$2,$3,$4,$5,$6,0)
         on conflict (canonical_key) do update set title = excluded.title
         returning id`,
        [slug, g.title, g.brand, g.gtin, g.imageUrl, g.categoryId],
      );
      harita.set(g.signature, String(rows[0].id));
    }
    return harita;
  },
  async upsertOffers(merchantId, sourceId, rows, marketCode) {
    const now = new Date().toISOString();
    let created = 0;
    for (const row of rows) {
      const r = await q(
        `insert into public.products
           (fulfillment, merchant_id, source_id, group_id, category_id, external_id,
            title, description, brand, image_urls, product_url, price_cents,
            compare_at_price_cents, currency, market_code, fingerprint, stock,
            shipping_fee_cents, status, last_seen_at, price_checked_at,
            stock_checked_at, offer_checked_at)
         values ('affiliate',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,$19,$19)
         -- YUKLEMSIZ catisma hedefi -- gercek deponun kullandigi bicimin
         -- TA KENDISI (onConflict: 'merchant_id,external_id'). Eskiden
         -- burada yuklem tekrarlamak zorundaydik cunku indeks kismiydi;
         -- 20260907440000 yuklemi kaldirdi. Harness artik production
         -- yazma yoluyla ayni ifadeyi kuruyor.
         on conflict (merchant_id, external_id)
         do update set
            price_cents = excluded.price_cents, stock = excluded.stock,
            status = excluded.status, fingerprint = excluded.fingerprint,
            last_seen_at = excluded.last_seen_at
         returning (xmax = 0) as yeni`,
        [merchantId, sourceId, row.groupId, row.categoryId, row.externalId,
         row.title, row.description, row.brand, row.imageUrls, row.productUrl,
         row.priceCents, row.compareAtPriceCents, row.currency, marketCode,
         row.fingerprint, row.stock, row.shippingFeeCents,
         row.stock > 0 ? 'active' : 'out_of_stock', now],
      );
      if (r[0]?.yeni) created += 1;
    }
    return { created, updated: rows.length - created };
  },
  async getFingerprints() { return new Map(); },
  async touchSeen() {},
  async markStale() { return 0; },
  async saveRefreshPlan() {},
  async startRun() { return '00000000-0000-0000-0000-000000000000'; },
  async finishRun() {},
};

const source = {
  id: String(kaynak.id),
  slug: String(kaynak.slug),
  merchantId: String(kaynak.merchant_id),
  kind: 'feed_csv',
  endpointUrl: 'https://productdata.awin.com/yerel-harness',
  fieldMapping: AWIN_FEED_MAPPING,
  currency: String(kaynak.currency),
  marketCode: String(kaynak.market_code),
  countryCode: kaynak.country_code ? String(kaynak.country_code) : null,
  allowedHosts: izinliHostlar,
  authType: 'query',
  authSecretRef: null,
  maxItems: LIMIT,
};

console.log('izinli hostlar :', izinliHostlar.join(', '));
const ozet = await runSource(source, { fetcher, repository });

console.log('\n=== ALIM OZETI (gercek runSource) ===');
for (const [k, v] of Object.entries(ozet)) {
  if (typeof v === 'number' || typeof v === 'string') console.log(`  ${k.padEnd(20)} ${v}`);
}
await db.end();
