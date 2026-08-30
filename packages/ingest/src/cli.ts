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

import { createClient } from '@supabase/supabase-js';

import { runSource } from './pipeline.js';
import { createSupabaseRepository, loadSources } from './supabaseRepository.js';
import { createPoliteClient } from './http/politeClient.js';
import type { IngestSummary } from './types.js';

const USER_AGENT =
  process.env.OHAAAA_USER_AGENT ??
  'OhaaaaBot/1.0 (+https://ohaaaa.com/bot; iletisim@ohaaaa.com)';

interface CliOptions {
  sourceSlug?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--source=')) options.sourceSlug = arg.slice('--source='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Kullanım: ohaaaa-ingest [seçenekler]',
          '',
          '  --source=<slug>   Yalnızca bu kaynağı çalıştır',
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
    ? dryRunRepository()
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

    if (summary.error) console.log(`    hata: ${summary.error}`);

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
function dryRunRepository() {
  return {
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
  console.error('Alım hattı çöktü:', error instanceof Error ? error.message : error);
  process.exit(1);
});
