/**
 * ÜRETİM AJAN KAYIT DEFTERİ.
 *
 * PHASE 1 sonunda `registry.register(...)` yalnızca testlerde çağrılıyordu:
 * motor vardı, işçi yoktu. Burası o boşluğu kapatan tek yer.
 *
 * BİR AJAN. Görev haritası altmış bir tane sayıyor ama burada yalnızca
 * biri var ve bu bilinçli: ilk dikey dilim uçtan uca çalışmadan ikincisini
 * yazmak, doğrulanmamış bir deseni altmış kez kopyalamak olurdu.
 */

import { AgentRegistry } from '../orchestrator/registry.js';
import type { AgentContext } from '../orchestrator/types.js';
import { ToolKayitDefteri } from '../tools/registry.js';
import type { ToolCtx } from '../tools/contract.js';
import { localeParityAjani } from './localeParity.js';

export interface UretimKurulumu {
  /** Depo kökü -- `read_repo` bunun dışına çıkamaz. */
  kokDizin: string;
  /** Güvenli mod açık mı. Kill switch buradan bağlanır. */
  guvenliMod?: boolean;
}

export interface UretimDefteri {
  registry: AgentRegistry;
  araclar: ToolKayitDefteri;
}

/**
 * Üretim kayıt defterini kurar.
 *
 * Araç bağlamı ajanın DIŞINDA üretiliyor: ajan kendi izin listesini
 * genişletemesin diye. `izinliAraclar` ajanın kaydından geliyor, ajanın
 * çalışma anındaki isteğinden değil.
 */
export function uretimDefteriniKur(k: UretimKurulumu): UretimDefteri {
  const araclar = new ToolKayitDefteri(k.kokDizin);
  const registry = new AgentRegistry();

  const ajan = localeParityAjani({
    tool: (ad) => araclar.get(ad),
    toolCtx: (ctx: AgentContext): ToolCtx => ({
      agentId: 'localization-parity',
      izinliAraclar: ctx.tools,
      guvenliMod: k.guvenliMod ?? false,
      kalanMs: Math.max(1, ctx.deadline - Date.now()),
      log: ctx.log,
    }),
  });

  registry.register(ajan);
  return { registry, araclar };
}
