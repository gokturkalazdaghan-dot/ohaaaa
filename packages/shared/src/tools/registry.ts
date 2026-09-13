/**
 * ARAÇ KAYIT DEFTERİ.
 *
 * Yirmi beş araç adı tanımlı. Bugün GERÇEKTEN uygulanmış olan: bir tane.
 *
 * Kalan yirmi dördü burada `uygulanmamis` olarak, her biri kendi
 * gerekçesiyle duruyor. Bu bilinçli bir tercih: eksik araçları listeden
 * çıkarmak, "yirmi beş araç var" izlenimini korurken hangilerinin
 * çalıştığını görünmez kılardı. Bir ajan uygulanmamış bir aracı
 * çağırdığında `uygulanmamis` hatası alır -- sessizce boş sonuç değil.
 */

import type { ToolName } from '../orchestrator/types.js';
import type { ToolKaydi } from './contract.js';
import { readRepoAraci } from './readRepo.js';

/** Uygulaması olmayan araçlar ve neden olmadığı. */
const UYGULANMAMIS: Record<string, string> = {
  read_catalog: 'Supabase okuma istemcisi araç katmanına bağlanmadı',
  read_price_history: 'Supabase okuma istemcisi araç katmanına bağlanmadı',
  read_merchant: 'Supabase okuma istemcisi araç katmanına bağlanmadı',
  read_market_config: 'Supabase okuma istemcisi araç katmanına bağlanmadı',
  read_revenue: 'yetki sınıfı; onay kapısı üretim akışına bağlanmadan açılmayacak',
  read_orders: 'Supabase okuma istemcisi araç katmanına bağlanmadı',
  read_user_scoped: 'yetki sınıfı; oturum bağlamı araç katmanına taşınmadı',
  read_analytics: 'analitik kaynağı henüz tanımlı değil',
  read_ops: 'Supabase okuma istemcisi araç katmanına bağlanmadı',
  read_db: 'şema/plan okuma yüzeyi araç katmanına bağlanmadı',
  write_catalog: 'yazma araçları doğrulama zinciri üretimde çalışmadan açılmayacak',
  write_price: 'yazma araçları doğrulama zinciri üretimde çalışmadan açılmayacak',
  write_risk_flag: 'yazma araçları doğrulama zinciri üretimde çalışmadan açılmayacak',
  write_moderation: 'yazma araçları doğrulama zinciri üretimde çalışmadan açılmayacak',
  write_content: 'yazma araçları doğrulama zinciri üretimde çalışmadan açılmayacak',
  write_ops: 'yazma araçları doğrulama zinciri üretimde çalışmadan açılmayacak',
  write_agent_decision: 'agent_decisions yazımı için enum genişletmesi gerekiyor (göç)',
  propose_ddl: 'yetki sınıfı; onay kuyruğu üretim akışına bağlanmadan açılmayacak',
  call_model: 'model sağlayıcı anahtarı yok; maliyet yöneticisi bağlanmadan açılmayacak',
  http_fetch: 'ağ erişimi için oran sınırı ve alan adı listesi tanımlanmadı',
  browser: 'tarayıcı sürücüsü araç katmanına bağlanmadı',
  write_repo: 'yetki sınıfı; diff denetimi ve onay kapısı olmadan açılmayacak',
  run_check: 'süreç çalıştırma yüzeyi araç katmanına bağlanmadı',
  read_ci: 'CI istemcisi araç katmanına bağlanmadı',
};

export class ToolKayitDefteri {
  private readonly araclar = new Map<ToolName, ToolKaydi>();

  constructor(kokDizin?: string) {
    /* Uygulananlar. */
    if (kokDizin) {
      this.araclar.set('read_repo', readRepoAraci(kokDizin) as unknown as ToolKaydi);
    }
    /* Kalanlar açıkça uygulanmamış olarak kaydediliyor. */
    for (const [ad, neden] of Object.entries(UYGULANMAMIS)) {
      const t = ad as ToolName;
      if (!this.araclar.has(t)) {
        this.araclar.set(t, { ad: t, uygulanmamis: true, neden });
      }
    }
    if (!kokDizin) {
      this.araclar.set('read_repo', {
        ad: 'read_repo', uygulanmamis: true, neden: 'kök dizin verilmedi',
      });
    }
  }

  get(ad: ToolName): ToolKaydi | undefined {
    return this.araclar.get(ad);
  }

  /** Gerçekten çalışan araçlar. */
  uygulananlar(): ToolName[] {
    return [...this.araclar.entries()]
      .filter(([, t]) => !('uygulanmamis' in t))
      .map(([ad]) => ad);
  }

  /** Adı tanımlı ama gövdesi olmayanlar. */
  uygulanmayanlar(): ToolName[] {
    return [...this.araclar.entries()]
      .filter(([, t]) => 'uygulanmamis' in t)
      .map(([ad]) => ad);
  }
}
