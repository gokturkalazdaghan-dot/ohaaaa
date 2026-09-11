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
import { redact, redactError } from './http/redact.js';
import {
  SUPABASE_SERVICE_KEY_ENV_NAMES,
  SUPABASE_URL_ENV_NAMES,
  readEnvValue,
  resolveEnvName,
} from './envNames.js';
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
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, schedule: false };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--schedule') options.schedule = true;
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
          '  --help            Bu yardım',
          '',
          'Ortam değişkenleri:',
          '  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (zorunlu)',
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
   * Adlar SIRAYLA aranıyor: aynı sır ortama farklı adlarla enjekte
   * edilebiliyor (bkz. envNames.ts). Hata mesajı da hangi ADLARIN arandığını
   * söylüyor -- değerleri değil.
   */
  const supabaseUrl = readEnvValue(SUPABASE_URL_ENV_NAMES);
  const serviceKey = readEnvValue(SUPABASE_SERVICE_KEY_ENV_NAMES);

  if (!supabaseUrl || !serviceKey) {
    console.error(
      'HATA: Supabase adresi ve servis rolü anahtarı tanımlı olmalı.\n' +
        `  adres  : ${SUPABASE_URL_ENV_NAMES.join(' / ')}` +
        ` -> ${resolveEnvName(SUPABASE_URL_ENV_NAMES) ?? 'BULUNAMADI'}\n` +
        `  anahtar: ${SUPABASE_SERVICE_KEY_ENV_NAMES.join(' / ')}` +
        ` -> ${resolveEnvName(SUPABASE_SERVICE_KEY_ENV_NAMES) ?? 'BULUNAMADI'}\n` +
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
