/**
 * SUPREME ORCHESTRATOR ve SUPREME AUDITOR.
 *
 * MEVCUT MOTOR KORUNDU. `orchestrate` yeniden yazılmadı; bu katman onu
 * SARMALIYOR. Planlama, bütçe, yeniden deneme ve araç izinleri hâlâ
 * orada. Buraya eklenen şey, o motorun bilmediği tek soru:
 *
 *   "Bu iş şu anda, bu ajanla, bu yetkiyle çalıştırılmalı mı?"
 *
 * GÖREV AYRILIĞI
 * `SupremeAuditor` ayrı bir sınıf ve Orchestrator'a BAĞLI DEĞİL. Aynı
 * nesnenin iki metodu olsalardı, "bağımsız denetim" bir isimlendirme
 * tercihinden ibaret kalırdı. Ayrıca denetçi kimliği orchestrator
 * kimliğinden farklı olmak zorunda ve bu çalışma anında kontrol ediliyor.
 */

import { orchestrate } from '../orchestrator/orchestrator.js';
import type { AgentRegistry } from '../orchestrator/registry.js';
import type {
  AgentDefinition, OrchestrationResult, TaskNode,
} from '../orchestrator/types.js';
import type { Market } from '../market.js';

import { KillSwitch } from './killswitch.js';
import { MaliyetYoneticisi } from './cost.js';
import { AjanSagligi, ekDogrulamaGerekir, gorevAlabilir, yazmaIzinli } from './health.js';
import { OnayKuyrugu, onayGerekiyorMu } from './approval.js';
import type { OnayKonusu } from './approval.js';
import { enYuksekRisk } from './tools.js';
import { zincirTam } from './audit.js';
import type { DenetimDeposu, DenetimKaydi } from './audit.js';
import { denetle, uretimeGecebilir } from './verification.js';
import type { DogrulamaKaydi, IsCiktisi, Karar } from './verification.js';

export type EngelKodu =
  | 'guvenli_mod'
  | 'ajan_karantinada'
  | 'ajan_yazma_kisitli'
  | 'onay_bekliyor'
  | 'butce_yok'
  | 'ajan_bulunamadi';

export interface Engel {
  taskId: string;
  kod: EngelKodu;
  aciklama: string;
}

export interface OnUcusSonucu {
  gecti: boolean;
  engeller: readonly Engel[];
  /** Ek doğrulama isteyen ajanlar (uyarı durumundakiler). */
  ekDogrulama: readonly string[];
}

export interface SupremeSecenekleri {
  killSwitch?: KillSwitch;
  maliyet?: MaliyetYoneticisi;
  onaylar?: OnayKuyrugu;
  denetim?: DenetimDeposu;
  /** Görev başına onay konusu. Yoksa araç riskine bakılır. */
  onayKonulari?: Readonly<Record<string, OnayKonusu>>;
  /** Onay isteği kimliği -- görev kimliğinden türetilir. */
  onayIstegiKimligi?: (taskId: string) => string;
}

/**
 * Ajanları koordine eden üst merci.
 *
 * Uzman ajanların işini YAPMAZ: yalnızca kimin, ne zaman, hangi yetkiyle
 * çalışacağına karar verir ve sonucu denetime hazırlar.
 */
export class SupremeOrchestrator {
  readonly id = 'supreme-orchestrator';
  readonly killSwitch: KillSwitch;
  readonly onaylar: OnayKuyrugu;
  private readonly saglik = new Map<string, AjanSagligi>();
  private readonly maliyet?: MaliyetYoneticisi;
  private readonly denetim?: DenetimDeposu;
  private readonly onayKonulari: Readonly<Record<string, OnayKonusu>>;
  private readonly onayKimlik: (taskId: string) => string;

  constructor(private readonly registry: AgentRegistry, opt: SupremeSecenekleri = {}) {
    this.killSwitch = opt.killSwitch ?? new KillSwitch();
    this.onaylar = opt.onaylar ?? new OnayKuyrugu();
    this.maliyet = opt.maliyet;
    this.denetim = opt.denetim;
    this.onayKonulari = opt.onayKonulari ?? {};
    this.onayKimlik = opt.onayIstegiKimligi ?? ((t) => `onay:${t}`);
  }

  /** Bir ajanın sağlık defteri; yoksa açılır. */
  ajanSagligi(agentId: string): AjanSagligi {
    let s = this.saglik.get(agentId);
    if (!s) { s = new AjanSagligi(agentId); this.saglik.set(agentId, s); }
    return s;
  }

  /**
   * ÖN UÇUŞ KONTROLÜ — çalıştırmadan ÖNCE.
   *
   * Yarısına kadar çalıştırıp sonra durmak, yan etkileri yapılmış ama
   * sonucu kullanılamayacak bir yürütme bırakırdı. Aynı gerekçe mevcut
   * motorun adım bütçesi kontrolünde de yazılı.
   */
  onUcus(tasks: readonly TaskNode[], market: Market, simdi = Date.now()): OnUcusSonucu {
    const engeller: Engel[] = [];
    const ekDogrulama: string[] = [];

    for (const t of tasks) {
      let ajan: AgentDefinition | undefined;
      try {
        ajan = this.registry.resolve(t.capability, market);
      } catch {
        ajan = undefined;
      }
      if (!ajan) {
        engeller.push({
          taskId: t.id, kod: 'ajan_bulunamadi',
          aciklama: `${t.capability} yeteneğini sağlayan tekil ajan yok`,
        });
        continue;
      }

      const risk = enYuksekRisk(ajan.allowedTools);
      const durum = this.ajanSagligi(ajan.id).durum;

      if (this.killSwitch.guvenliMod && risk !== 'okuma') {
        engeller.push({
          taskId: t.id, kod: 'guvenli_mod',
          aciklama: `güvenli mod açık; ${ajan.id} ${risk} sınıfı araç taşıyor`,
        });
      }

      if (!gorevAlabilir(durum)) {
        engeller.push({
          taskId: t.id, kod: 'ajan_karantinada',
          aciklama: `${ajan.id} karantinada`,
        });
      } else if (risk !== 'okuma' && !yazmaIzinli(durum)) {
        engeller.push({
          taskId: t.id, kod: 'ajan_yazma_kisitli',
          aciklama: `${ajan.id} kısıtlı durumda; yazma kapalı`,
        });
      }

      if (ekDogrulamaGerekir(durum)) ekDogrulama.push(ajan.id);

      const konu = this.onayKonulari[t.id] ?? null;
      if (onayGerekiyorMu(konu, ajan.allowedTools)) {
        if (!this.onaylar.uygulanabilir(this.onayKimlik(t.id), simdi)) {
          engeller.push({
            taskId: t.id, kod: 'onay_bekliyor',
            aciklama: `${ajan.id} insan onayı olmadan çalışamaz`,
          });
        }
      }
    }

    if (this.maliyet?.asildi) {
      engeller.push({
        taskId: '*', kod: 'butce_yok',
        aciklama: `bütçe aşıldı: ${this.maliyet.harcananKurus} kuruş`,
      });
    }

    return { gecti: engeller.length === 0, engeller, ekDogrulama };
  }

  /**
   * Planı çalıştırır. Ön uçuş geçmezse MOTOR HİÇ ÇAĞRILMAZ.
   *
   * Dönen `engeller` boş değilse `sonuc` da `null`'dır: kısmen çalışmış
   * bir yürütmeyi başarı gibi göstermemek için.
   */
  async calistir(
    market: Market, tasks: readonly TaskNode[], simdi = Date.now(),
  ): Promise<{ onUcus: OnUcusSonucu; sonuc: OrchestrationResult | null }> {
    const onUcus = this.onUcus(tasks, market, simdi);
    if (!onUcus.gecti) return { onUcus, sonuc: null };
    const sonuc = await orchestrate({ market, tasks, registry: this.registry });
    return { onUcus, sonuc };
  }

  /** Denetim izine kayıt düşer. Depo verilmemişse sessizce atlanır. */
  async izeYaz(kayit: DenetimKaydi): Promise<void> {
    await this.denetim?.yaz(kayit);
  }
}

export type DenetimBulgusu =
  | 'zincir_kirik'
  | 'dogrulama_gecmedi'
  | 'denetci_bagimsiz_degil'
  | 'iz_yok';

export interface SupremeDenetimSonucu {
  onaylandi: boolean;
  bulgular: readonly DenetimBulgusu[];
  karar: Karar;
}

/**
 * SUPREME AUDITOR — Orchestrator'dan bağımsız denetim mercii.
 *
 * Orchestrator'ın kendi kararını kendisinin doğrulaması yeterli değil.
 * Bu sınıf ayrı kurulur, ayrı kimlik taşır ve Orchestrator'a referans
 * TUTMAZ -- yalnızca onun ürettiği izi ve çıktıyı okur.
 */
export class SupremeAuditor {
  constructor(readonly id = 'supreme-auditor') {
    if (!id.trim()) throw new Error('Denetçi kimliği zorunlu');
  }

  /**
   * Bir işin üretime geçip geçemeyeceğine karar verir.
   *
   * FAIL-CLOSED: iz yoksa, doğrulama yoksa ya da zincir kırıksa geçmez.
   * "Bulamadım, o hâlde sorun yok" bir denetim sonucu değildir.
   */
  denetleIs(
    is: IsCiktisi,
    dogrulamalar: readonly DogrulamaKaydi[],
    iz: readonly DenetimKaydi[],
  ): SupremeDenetimSonucu {
    const bulgular: DenetimBulgusu[] = [];

    if (iz.length === 0) bulgular.push('iz_yok');
    if (!zincirTam(iz)) bulgular.push('zincir_kirik');
    if (dogrulamalar.some((d) => !d.karar.gecti)) bulgular.push('dogrulama_gecmedi');
    if (dogrulamalar.some((d) => d.validatorId === this.id)) {
      bulgular.push('denetci_bagimsiz_degil');
    }

    const karar = denetle(is, dogrulamalar, this.id);
    const onaylandi = bulgular.length === 0 && karar.gecti;
    return { onaylandi, bulgular, karar };
  }

  /**
   * Orchestrator'ın kararını da denetler.
   *
   * Ön uçuş "geçti" dediyse ama engeller listesi boş değilse, koordinasyon
   * katmanı kendi kuralını çiğnemiş demektir. Bu tutarsızlığı yakalayacak
   * tek merci Orchestrator'ın kendisi olamaz.
   */
  denetleKoordinasyon(onUcus: OnUcusSonucu): boolean {
    return onUcus.gecti === (onUcus.engeller.length === 0);
  }

  /** İki katman da geçmeden üretime geçilemez. */
  uretimOnayi(validatorKarari: Karar, denetim: SupremeDenetimSonucu): boolean {
    return uretimeGecebilir(validatorKarari, denetim.karar) && denetim.onaylandi;
  }
}
