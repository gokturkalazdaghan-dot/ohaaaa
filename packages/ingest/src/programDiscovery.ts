/**
 * Program keşif turu — ağ kataloglarını tarar, `programs`'a yazar.
 *
 * ======================================================================
 * BU DOSYA HİÇBİR AĞIN SÖZLEŞMESİNİ BİLMEZ
 * ======================================================================
 * Ne endpoint, ne kimlik doğrulama, ne alan adı. Hepsi sağlayıcıda.
 * Buradaki iş: hangi ağların keşfi DESTEKLEDİĞİNİ sormak, destekleyenleri
 * çağırmak, sonucu yazmak ve ne olduğunu raporlamak.
 *
 * Böylece yeni bir ağ eklemek bu dosyayı DEĞİŞTİRMEZ.
 *
 * ======================================================================
 * DESTEKLEMEYEN AĞ BİR HATA DEĞİL
 * ======================================================================
 * Bugün hiçbir ağın keşif sözleşmesi doğrulanmadı; `callCapability` hepsi
 * için fırlatıyor. Tur bunu ÇÖKEREK değil, SAYARAK raporluyor:
 *
 *   manual_required            -> operatöre iş düşer
 *   capability_unavailable     -> ağın sözleşmesi doğrulanmalı
 *   capability_not_implemented -> bizim hatamız
 *
 * Üçü ayrı sayılıyor çünkü üçünün aksiyonu farklı. Tek bir "atlandı"
 * sayacı, "bakmadık" ile "bakamayız"ı aynı kefeye koyar ve kimse geri
 * dönüp bakmaz.
 *
 * ======================================================================
 * GÜVENLİK
 * ======================================================================
 * Ağ erişimi YALNIZCA çağıranın verdiği getirici üzerinden. Üretimde bu
 * `createPoliteClient`'tır: SSRF kapısı, gövde boyutu sınırı, zaman aşımı,
 * yeniden deneme, nezaket gecikmesi ve devre kesici oradadır. Bu dosya
 * `fetch` çağırmaz ve sağlayıcılar da çağıramaz (`ProviderContext`).
 *
 * Bir sağlayıcının döndürdüğü `homepage_url` gibi alanlar DIŞ VERİDİR ve
 * burada FETCH EDİLMEZ; yalnızca kaydedilir. Onları çekmek gerektiğinde
 * (feed onboarding) aynı korumalı getirici kullanılır.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ProviderError,
  callCapability,
  getProvider,
  knownNetworks,
  type NormalizedProgram,
  type ProviderContext,
  type ProviderFetcher,
} from '@ohaaaa/shared/providers';

import { createProgramRepository } from './programRepository.js';

/** Bir ağın bu turdaki sonucu. */
export interface NetworkDiscoveryOutcome {
  network: string;
  status: 'discovered' | 'manual_required' | 'unavailable' | 'not_implemented' | 'failed';
  programCount: number;
  firstSeenCount: number;
  /** Ağdan/koddan gelen açıklama; hata yoksa null. */
  detail: string | null;
}

export interface DiscoveryRunResult {
  outcomes: NetworkDiscoveryOutcome[];
  totalPrograms: number;
  totalFirstSeen: number;
  durationMs: number;
}

export interface DiscoveryOptions {
  supabase: SupabaseClient;
  /** Ağa erişimin tek yolu — üretimde createPoliteClient. */
  fetcher: ProviderFetcher;
  /** Yalnızca bu ağlar; verilmezse kayıtlı tüm ağlar. */
  networks?: string[];
  /** Ortam değişkeni ADIYLA sır çözer; değeri koda girmez. */
  secret?: (envVarName: string) => string | null;
  now?: () => string;
  log?: (event: string, data: Record<string, unknown>) => void;
}

/**
 * Bir keşif turu çalıştırır.
 *
 * FIRLATMAZ: bir ağın düşmesi diğerlerini durdurmaz. Tek bir ağın API'si
 * bozuk diye tüm turun iptal olması, çalışan ağların da keşfini
 * kaybetmek olurdu. Her ağ kendi `outcome`'unu alır.
 */
export async function runProgramDiscovery(
  options: DiscoveryOptions,
): Promise<DiscoveryRunResult> {
  const {
    supabase,
    fetcher,
    networks = knownNetworks(),
    secret = (name) => process.env[name] ?? null,
    now = () => new Date().toISOString(),
    log = () => {},
  } = options;

  const basladi = Date.now();
  const repository = createProgramRepository(supabase);
  const outcomes: NetworkDiscoveryOutcome[] = [];

  const ctx: ProviderContext = { fetch: fetcher, secret, now };

  for (const network of networks) {
    outcomes.push(await discoverOne(network, ctx, repository, log));
  }

  const totalPrograms = outcomes.reduce((s, o) => s + o.programCount, 0);
  const totalFirstSeen = outcomes.reduce((s, o) => s + o.firstSeenCount, 0);

  log('discovery.finished', { networks: networks.length, totalPrograms, totalFirstSeen });

  return {
    outcomes,
    totalPrograms,
    totalFirstSeen,
    durationMs: Date.now() - basladi,
  };
}

async function discoverOne(
  network: string,
  ctx: ProviderContext,
  repository: ReturnType<typeof createProgramRepository>,
  log: (event: string, data: Record<string, unknown>) => void,
): Promise<NetworkDiscoveryOutcome> {
  let programs: NormalizedProgram[];

  try {
    /*
     * `callCapability` ile çağrılıyor, `provider.discoverPrograms?.()` ile
     * DEĞİL. Optional chaining, beyanı `unavailable` olan bir yeteneği
     * sessizce `undefined` döndürerek atlar ve tur bunu "0 program" sanar --
     * yani bir BOŞLUK, geçerli bir sonuç gibi görünür.
     */
    const provider = getProvider(network);
    const discover = callCapability(
      network,
      'program_discovery',
      (p) => p.discoverPrograms,
    ) as NonNullable<typeof provider.discoverPrograms>;

    programs = await discover.call(provider, ctx);
  } catch (error) {
    return capabilityOutcome(network, error, log);
  }

  // Ağ bağımsız doğrulama: sağlayıcı ne döndürürse döndürsün, şemaya
  // uymayan satır YAZILMAZ. Sağlayıcıya güvenmek, bir ağın bozuk yanıtının
  // tabloya girmesi demek olurdu.
  const gecerli = programs.filter((p) => isWellFormed(p, network));
  const atilan = programs.length - gecerli.length;

  if (atilan > 0) {
    log('discovery.malformed_dropped', { network, dropped: atilan });
  }

  try {
    const sonuc = await repository.upsertDiscovered(gecerli);
    log('discovery.network_done', {
      network,
      programs: sonuc.written,
      firstSeen: sonuc.firstSeen.length,
    });

    return {
      network,
      status: 'discovered',
      programCount: sonuc.written,
      firstSeenCount: sonuc.firstSeen.length,
      detail: atilan > 0 ? `${atilan} bozuk kayit atlandi` : null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log('discovery.write_failed', { network, error: detail });
    return { network, status: 'failed', programCount: 0, firstSeenCount: 0, detail };
  }
}

/** Yetenek hatalarını sayılabilir sonuçlara çevirir. */
function capabilityOutcome(
  network: string,
  error: unknown,
  log: (event: string, data: Record<string, unknown>) => void,
): NetworkDiscoveryOutcome {
  const detail = error instanceof Error ? error.message : String(error);

  if (error instanceof ProviderError) {
    const status =
      error.code === 'manual_required'
        ? 'manual_required'
        : error.code === 'capability_unavailable'
          ? 'unavailable'
          : error.code === 'capability_not_implemented'
            ? 'not_implemented'
            : 'failed';

    log('discovery.skipped', { network, reason: error.code });
    return { network, status, programCount: 0, firstSeenCount: 0, detail };
  }

  log('discovery.failed', { network, error: detail });
  return { network, status: 'failed', programCount: 0, firstSeenCount: 0, detail };
}

/**
 * Şemanın reddedeceği kaydı ÖNCEDEN eler.
 *
 * Veritabanı zaten reddederdi ama tek bir bozuk satır TÜM toplu yazmayı
 * düşürürdü ve o ağın geçerli programları da kaybolurdu. Burada elemek,
 * bozuk olanı atıp geri kalanı kurtarıyor.
 */
function isWellFormed(program: NormalizedProgram, network: string): boolean {
  return (
    program.network === network &&
    typeof program.networkProgramId === 'string' &&
    program.networkProgramId.trim().length > 0 &&
    typeof program.merchantName === 'string' &&
    program.merchantName.trim().length > 0 &&
    typeof program.lastVerifiedAt === 'string' &&
    program.lastVerifiedAt.length > 0 &&
    (program.commissionRate === null ||
      (Number.isFinite(program.commissionRate) &&
        program.commissionRate >= 0 &&
        program.commissionRate <= 0.9)) &&
    (program.cookieWindowDays === null || program.cookieWindowDays > 0) &&
    (program.productCount === null || program.productCount >= 0)
  );
}
