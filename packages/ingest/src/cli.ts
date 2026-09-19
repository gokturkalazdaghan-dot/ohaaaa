#!/usr/bin/env node
/**
 * Alım hattı komut satırı arayüzü.
 *
 *   ohaaaa-ingest                       # etkin tüm kaynakları çalıştır
 *   ohaaaa-ingest --source=magaza-a     # tek kaynak
 *   ohaaaa-ingest --dry-run             # yazmadan dene
 *
 * Zamanlama için tasarım kararı: bu bir DAEMON DEĞİLDİR. Tek seferlik çalışır
 * ve çıkar. Zamanlamayı işletim sistemi (cron / systemd timer) ya da barındırma
 * platformu (Vercel Cron, GitHub Actions schedule) yapar.
 *
 * Sebep: sürekli çalışan bir süreç, çöktüğünde sessizce durur ve kimse fark
 * etmez. Cron ise her tetiklemede yeniden başlar; çıkış kodu izlenebilir,
 * günlükleri ayrıdır ve tek kişilik bir operasyonda gözetimi çok daha kolaydır.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { runSource } from './pipeline.js';
import { runScheduledIngest } from './runner.js';
import { createSupabaseRepository, loadSources } from './supabaseRepository.js';
import { createPoliteClient } from './http/politeClient.js';
import { awinFeedListesiniGetir, kesfiYazdir } from './awinKesif.js';
import { redact, redactError } from './http/redact.js';
import type { IngestSummary } from './types.js';

const USER_AGENT =
  process.env.OHAAAA_USER_AGENT ??
  'OhaaaaBot/1.0 (+https://ohaaaa.com/bot; iletisim@ohaaaa.com)';

interface CliOptions {
  sourceSlug?: string;
  dryRun: boolean;
  /**
   * Zamanlayıcı kipi.
   *
   * Varsayılan kip (kaynakları doğrudan sırayla çalıştırmak) KORUNUYOR:
   * elle müdahale ve hata ayıklama için gerekli. Zamanlayıcı kipi onun
   * yerine geçmiyor, yanına ekleniyor.
   */
  schedule: boolean;
  /**
   * Awin feed listesi keşfi. YALNIZCA OKUR: eksik olan `fid` ve üyelik
   * durumunu basar, veritabanına hiçbir şey yazmaz.
   */
  awinFeedListesi: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, schedule: false, awinFeedListesi: false };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--schedule') options.schedule = true;
    else if (arg === '--awin-feed-listesi') options.awinFeedListesi = true;
    else if (arg.startsWith('--source=')) options.sourceSlug = arg.slice('--source='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Kullanım: ohaaaa-ingest [seçenekler]',
          '',
          '  --source=<slug>   Yalnızca bu kaynağı çalıştır',
          '  --schedule        Zamanlayıcı kipi: due kaynakları kuyruğa al',
          '                    ve kuyruktaki işleri çalıştır',
          '  --dry-run         Veritabanına yazmadan dene',
          '  --awin-feed-listesi  Awin feed listesini indir ve YAZDIR',
          '                    (yalnızca okur; AWIN_DATAFEED_API_KEY ister)',
          '  --help            Bu yardım',
          '',
          'Ortam değişkenleri:',
          '  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (zorunlu)',
          '  AWIN_DATAFEED_API_KEY                    (--awin-feed-listesi için)',
          '  OHAAAA_USER_AGENT                        (isteğe bağlı)',
        ].join('\n'),
      );
      process.exit(0);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  /*
   * AWIN FEED LİSTESİ KEŞFİ -- SUPABASE GEREKTİRMEZ.
   *
   * Bu dal veritabanına DOKUNMAZ, bu yüzden Supabase kimlik kontrolünden
   * ÖNCE duruyor: keşfi çalıştırmak için service-role anahtarı istemek,
   * okuma işi için yazma yetkisi istemek olurdu.
   *
   * Yazma adımı bilerek YOK. Ayrıştırıcı gerçek bir Awin yanıtıyla henüz
   * çalışmadı; ilk turda 38 programın satırlarını yazmak, doğrulanmamış
   * bir okumaya dayanarak toplu veri yazmak demekti. Önce çıktı görülür.
   */
  if (options.awinFeedListesi) {
    const kesifIstemcisi = createPoliteClient({
      userAgent: USER_AGENT,
      minDelayMs: 0,
      timeoutMs: 60_000,
      maxRetries: 2,
      circuitBreakerThreshold: 3,
    });

    try {
      const sonuc = await awinFeedListesiniGetir(async (url) => {
        const yanit = await kesifIstemcisi.get(url);
        return { body: yanit.body, status: yanit.status };
      });
      kesfiYazdir(sonuc);
      process.exit(0);
    } catch (error) {
      // redactError: anahtar hata metnine girmiş olsa bile silinir.
      console.error(`Awin feed listesi alınamadı: ${redactError(error)}`);
      process.exit(1);
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error(
      'HATA: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanımlı olmalı.\n' +
        '.env.example dosyasına bakın.',
    );
    process.exit(2);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const fetcherForAll = createPoliteClient({
    userAgent: USER_AGENT,
    minDelayMs: 2000,
    timeoutMs: 30_000,
    maxRetries: 3,
    circuitBreakerThreshold: 5,
  });

  /*
   * ZAMANLAYICI KİPİ — zincirin giriş noktası.
   *
   * Zincirin KENDİSİ `runner.ts` içindedir (`runScheduledIngest`) çünkü
   * aynı tur HTTP tetikleyiciden de çalıştırılıyor. Burada yalnızca
   * çağrılır ve sonucu insana okunur biçimde yazılır.
   *
   * Kuru çalışmada zamanlayıcı ÇALIŞTIRILMAZ: kuyruğa iş yazmak da bir
   * yazma işlemidir ve `--dry-run` sözünü bozardı.
   */
  if (options.schedule) {
    if (options.dryRun) {
      console.error('HATA: --schedule ile --dry-run birlikte kullanılamaz.');
      process.exit(2);
    }

    /*
     * ZİNCİRİN KENDİSİ ARTIK BURADA DEĞİL: `runScheduledIngest`.
     *
     * Aynı tur HTTP tetikleyiciden de (Vercel Cron) çalıştırılıyor. Adımları
     * burada TEKRAR yazmak iki alım yolu demekti ve iki yol zamanla AYRIŞIR:
     * biri yetim işleri kurtarır, diğeri unutur; biri nezaket gecikmesini
     * uygular, diğeri uygulamaz. Ayrışma sessizdir -- ikisi de "çalışıyor"
     * görünür ve fark yalnızca veri bozulduğunda ortaya çıkar.
     *
     * Bu dal artık yalnızca SUNUM yapıyor: turu çalıştırır, sonucu insana
     * okunur biçimde yazar ve çıkış kodunu belirler.
     */
    const sonuc = await runScheduledIngest({
      supabase,
      fetcher: fetcherForAll,
      log: (event, data) => console.log(JSON.stringify({ event, ...data })),
    });

    console.log(`▸ Zamanlayıcı: ${sonuc.scheduled.length} kaynak kuyruğa alındı`);
    for (const p of sonuc.scheduled) console.log(`  · ${p.sourceId} (${p.reason})`);

    if (sonuc.orphansRecovered === null) {
      console.error('  ! yetim kurtarma başarısız (tur yine de sürdü)');
    } else if (sonuc.orphansRecovered > 0) {
      console.log(`  · ${sonuc.orphansRecovered} yetim iş kurtarıldı`);
    }

    for (const summary of sonuc.summaries) {
      console.log(
        `  ${statusIcon(summary.status)} ${summary.status} · ` +
          `${summary.itemsSeen} görüldü, ${summary.itemsNew} yeni, ` +
          `${summary.itemsChanged} değişti, ${summary.itemsUnchanged} aynı, ` +
          `${summary.itemsDeleted} eksildi`,
      );
    }

    console.log(
      `▸ Worker: ${sonuc.worker.claimed} alındı, ${sonuc.worker.completed} tamamlandı, ` +
        `${sonuc.worker.failed} başarısız`,
    );

    /*
     * ======================================================================
     * SESSİZ ÖLÜM ARTIK YEŞİL RAPORLAMIYOR
     * ======================================================================
     * ÖLÇÜLEN ARIZA: alım hattı 12 Eylül'den 19 Eylül'e kadar HİÇ çalışmadı
     * ama zamanlanmış iş her turda "success" verdi. Altı gün boyunca
     * katalog dondu ve hiçbir sinyal çıkmadı.
     *
     * Sebep tam olarak bu satırdı: çıkış kodu YALNIZCA `worker.failed`e
     * bakıyordu. Hat bir ölü mektubun arkasında tıkandığında ise:
     *   claimed = 0, completed = 0, failed = 0
     * Yani "hiçbir şey başarısız olmadı" -- çünkü hiçbir şey DENENMEDİ.
     * Ölü bir hat ile boşta duran sağlıklı bir hat aynı görünüyordu.
     *
     * Bu dosyanın üstündeki iş akışı "çöktüğünde sessizce durup kimsenin
     * fark etmediği şey odur" diye yazıyor. Tam da o oldu.
     *
     * ----------------------------------------------------------------------
     * AYRIM: "YAPACAK İŞ YOKTU" ile "İŞ VARDI AMA İLERLEMEDİ"
     * ----------------------------------------------------------------------
     * Boşta geçen bir tur normaldir ve kırmızı olmamalı: kaynakların hiçbiri
     * vadesi gelmemişse yapacak iş yoktur. Kırmızı olması gereken durum,
     * YAPILACAK İŞ VARKEN hiçbir ilerleme olmamasıdır.
     *
     * İki işaret aranıyor:
     *   • ölü mektuptaki iş  -> denemeler tükenmiş, kimse elle dokunmadıkça
     *                           hat o kaynakta bir daha ilerlemez
     *   • kaynak kuyruğa alındı ama worker hiçbir şey alamadı
     *                        -> iş var, ama alınamıyor (takılı kira, tıkalı
     *                           kuyruk); tam olarak altı gün süren durum
     */
    const { data: oluMektuplar, error: oluHata } = await supabase
      .from('jobs')
      .select('id, kind, last_error, created_at')
      .eq('status', 'olu_mektup');

    if (oluHata) {
      /*
       * Kontrolün kendisi düşerse turu düşürmüyoruz: bu bir SAĞLIK
       * kontrolü, alımın kendisi değil. Ama sessiz de kalmıyor -- yoksa
       * bu kez kontrolün ölümü fark edilmezdi.
       */
      console.error(`  ! olu mektup kontrolu basarisiz: ${oluHata.message}`);
    } else if ((oluMektuplar?.length ?? 0) > 0) {
      console.error(
        `\n✗ ${oluMektuplar!.length} is OLU MEKTUP'ta: denemeleri tukendi ve ` +
          'elle mudahale edilmedikce hat bu kaynaklarda ILERLEMEZ.',
      );
      for (const is of oluMektuplar!) {
        console.error(`  · ${is.kind} (${is.created_at}): ${is.last_error ?? 'sebep yok'}`);
      }
      process.exit(1);
    }

    /*
     * Kaynak kuyruğa alındı ama worker hiçbir iş alamadıysa, arada bir
     * tıkanıklık var. `scheduled` boşsa bu kontrol hiç çalışmaz -- yani
     * gerçekten boşta geçen turlar yeşil kalır.
     */
    if (sonuc.scheduled.length > 0 && sonuc.worker.claimed === 0) {
      console.error(
        `\n✗ ${sonuc.scheduled.length} kaynak kuyruga alindi ama worker HICBIR is alamadi. ` +
          'Kuyruk tikali: takili kira ya da alinamayan is olabilir.',
      );
      process.exit(1);
    }

    process.exit(sonuc.worker.failed > 0 ? 1 : 0);
  }

  const sources = await loadSources(supabase, { slug: options.sourceSlug });

  if (sources.length === 0) {
    console.log(
      options.sourceSlug
        ? `Kaynak bulunamadı veya etkin değil: ${options.sourceSlug}`
        : 'Çalıştırılacak etkin kaynak yok.',
    );
    process.exit(0);
  }

  const fetcher = createPoliteClient({
    userAgent: USER_AGENT,
    minDelayMs: 2000,
    timeoutMs: 30_000,
    maxRetries: 3,
    circuitBreakerThreshold: 5,
  });

  const repository = options.dryRun
    ? dryRunRepository(supabase)
    : createSupabaseRepository(supabase);

  const summaries: IngestSummary[] = [];

  // Kaynaklar SIRAYLA işlenir. Paralel çalıştırmak aynı mağazaya eşzamanlı
  // istek göndermek demektir — nezaket ayarlarını anlamsız kılar.
  for (const source of sources) {
    console.log(`▸ ${source.slug} (${source.kind})`);

    const summary = await runSource(source, { fetcher, repository });
    summaries.push(summary);

    const line =
      `  ${statusIcon(summary.status)} ${summary.status} · ` +
      `${summary.itemsSeen} görüldü, ${summary.itemsCreated} yeni, ` +
      `${summary.itemsUpdated} güncel, ${summary.itemsFailed} hatalı · ` +
      `${summary.durationMs} ms`;

    console.log(line);

    // CI günlüğü kalıcıdır ve repoya erişebilen herkes okur.
    if (summary.error) console.log(`    hata: ${redact(summary.error)}`);

    for (const sample of summary.sampleErrors.slice(0, 5)) {
      console.log(`    - ${sample.externalId ?? '(genel)'}: ${sample.reason}`);
    }
  }

  // --- Özet ------------------------------------------------------------------
  const failed = summaries.filter((s) => s.status === 'failed').length;
  const partial = summaries.filter((s) => s.status === 'partial').length;

  console.log(
    `\n${summaries.length} kaynak · ${summaries.length - failed - partial} başarılı · ` +
      `${partial} kısmi · ${failed} başarısız`,
  );

  // Çıkış kodu izleme içindir: cron/CI bunu okuyup uyarı üretebilir.
  process.exit(failed > 0 ? 1 : 0);
}

function statusIcon(status: IngestSummary['status']): string {
  return status === 'success' ? '✓' : status === 'partial' ? '~' : '✗';
}

/** Yazma yapmayan sahte depo — alan haritası doğrulamak için. */
function dryRunRepository(supabase: SupabaseClient) {
  return {
    /*
     * Kategori cozumlemesi kuru calismada da GERCEK katalogtan okunur.
     *
     * Bu bir SELECT; kuru calismanin "hicbir sey yazma" sozunu bozmaz.
     * Bos harita dondurmek daha kolay olurdu ama operatore YALAN soylerdi:
     * her kalem "siniflandirilamadi" gorunur ve gercek bir feed'i baglamadan
     * once "kac urun kategori sayfalarinda gorunecek" sorusu -- kuru
     * calismanin cevaplamasi gereken en onemli sorulardan biri --
     * cevapsiz kalirdi.
     */
    async findCategoryIdsBySlug(slugs: string[]) {
      const result = new Map<string, string>();
      if (slugs.length === 0) return result;

      const { data, error } = await supabase
        .from('categories')
        .select('id, slug')
        .eq('is_active', true)
        .in('slug', slugs);

      if (error) throw new Error(`Kategoriler okunamadi: ${error.message}`);

      for (const row of data ?? []) {
        if (row.slug) result.set(String(row.slug).toLowerCase(), String(row.id));
      }

      return result;
    },
    /*
     * Kuru çalışmada BOŞ harita dönüyor ve bu kasıtlı: her kalem NEW
     * görünür, yani operatör "bu feed'de ne var" sorusunun tam cevabını
     * alır. Gerçek parmak izlerini okusaydık kuru çalışma yalnızca
     * değişenleri gösterir ve feed'in tamamını denetlemek imkânsız olurdu.
     */
    async getFingerprints() {
      return new Map<string, string>();
    },
    async touchSeen() {
      // Kuru çalışma hiçbir şey yazmaz.
    },
    async saveRefreshPlan() {
      // Kuru çalışma zamanlamayı da değiştirmez.
    },
    async findGroupsByGtin() {
      return new Map<string, string>();
    },
    async findGroupsBySignature() {
      return new Map<string, string>();
    },
    async createGroups(groups: Array<{ signature: string }>) {
      return new Map(groups.map((g, i) => [g.signature, `dry-${i}`]));
    },
    async upsertOffers(_m: string, _s: string, rows: unknown[]) {
      return { created: rows.length, updated: 0 };
    },
    async markStale() {
      return 0;
    },
    async startRun() {
      return 'dry-run';
    },
    async finishRun() {
      /* deneme çalışmasında kayıt tutulmaz */
    },
  };
}

main().catch((error: unknown) => {
  console.error('Alım hattı çöktü:', redactError(error));
  process.exit(1);
});
