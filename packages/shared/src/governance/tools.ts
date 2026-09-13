/**
 * ARAÇ RİSK SINIFLANDIRMASI.
 *
 * `ToolName` bir ajanın NEYE dokunabildiğini söyler. Burası NE KADAR
 * pahalıya patlayacağını söyler -- ve o iki soru aynı değil.
 *
 * Neden ayrı bir dosya: izin listesi ajan kaydında duruyor ve orada
 * durmalı. Ama "bu araç geri alınabilir mi", "onay ister mi", "kill
 * switch açıkken çalışabilir mi" soruları ajanın değil SİSTEMİN
 * kararıdır. Ajan kendi riskini kendisi beyan edebilseydi, riski
 * düşük göstermek en kolay yol olurdu.
 */

import type { ToolName } from '../orchestrator/types.js';

/**
 * Bir aracın risk sınıfı.
 *
 *   okuma    — yan etkisi yok. Kill switch açıkken bile serbest.
 *   yazma    — geri alınabilir veri değişikliği. Doğrulama ister.
 *   yetki    — para, kişisel veri, kod ya da şema. İnsan onayı ister.
 */
export type AracRiski = 'okuma' | 'yazma' | 'yetki';

const RISK: Record<ToolName, AracRiski> = {
  read_catalog: 'okuma',
  read_price_history: 'okuma',
  read_merchant: 'okuma',
  read_market_config: 'okuma',
  read_orders: 'okuma',
  read_analytics: 'okuma',
  read_ops: 'okuma',
  read_db: 'okuma',
  read_ci: 'okuma',
  read_repo: 'okuma',
  http_fetch: 'okuma',
  browser: 'okuma',
  run_check: 'okuma',

  /*
   * `read_revenue` ve `read_user_scoped` OKUMA ama 'yetki' sınıfında.
   *
   * Sebep: ikisi de sızdırılması geri alınamaz veri döndürüyor -- gelir
   * tabloları ve kullanıcının kendi kaydı. Bir okuma aracının zararsız
   * olduğu varsayımı tam olarak burada kırılır.
   */
  read_revenue: 'yetki',
  read_user_scoped: 'yetki',

  write_catalog: 'yazma',
  write_price: 'yazma',
  write_risk_flag: 'yazma',
  write_moderation: 'yazma',
  write_content: 'yazma',
  write_ops: 'yazma',
  write_agent_decision: 'yazma',

  write_repo: 'yetki',
  propose_ddl: 'yetki',

  /*
   * `call_model` yazma değil ama 'yazma' sınıfında: para harcıyor ve
   * çıktısı doğrulanmadan gerçek sayılamaz. Maliyet yöneticisinin
   * kapıyı tutabilmesi için bu sınıfta olması gerekiyor.
   */
  call_model: 'yazma',
};

/** Bir aracın risk sınıfı. */
export function aracRiski(tool: ToolName): AracRiski {
  return RISK[tool];
}

/** Bir ajanın taşıdığı EN YÜKSEK risk. Boş liste okuma sayılır. */
export function enYuksekRisk(tools: Iterable<ToolName>): AracRiski {
  let en: AracRiski = 'okuma';
  for (const t of tools) {
    const r = RISK[t];
    if (r === 'yetki') return 'yetki';
    if (r === 'yazma') en = 'yazma';
  }
  return en;
}

/** Yetki sınıfı araç taşıyan ajan insan onayı olmadan çalışamaz. */
export function onayGerektirir(tools: Iterable<ToolName>): boolean {
  return enYuksekRisk(tools) === 'yetki';
}

/**
 * Kill switch açıkken bu araç kullanılabilir mi?
 *
 * Güvenli mod gözlemi DURDURMAZ: hata izlemek, plan okumak, sayfa çekmek
 * serbest kalır. Duran şey, dünyayı değiştiren her şey. Bir olay sırasında
 * okumayı da kapatmak, olayı teşhis edecek ajanları da kör ederdi.
 */
export function guvenliModdaIzinli(tool: ToolName): boolean {
  return RISK[tool] === 'okuma';
}
