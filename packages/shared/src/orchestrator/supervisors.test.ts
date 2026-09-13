import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AgentRegistry } from './registry.js';
import { SUPERVISORS } from './types.js';
import type { AgentDefinition, AgentResult, SupervisorId, ToolName } from './types.js';

/*
 * ALAN LİSTESİNİ SABİTLEYEN TESTLER.
 *
 * Bu dosya bir uygulama detayını değil, bir KARARI koruyor: süpervizör
 * listesi sistemden türetilir, ileriye dönük yazılmaz. Liste sessizce
 * büyürse -- "bir gün lazım olur" diye eklenen bir alan -- ajanlar sahibi
 * olmayan kutulara dağılır ve kimin neyden sorumlu olduğu kaybolur.
 *
 * Bu yüzden testler adları TEK TEK yazıyor. Listeyi değiştirmek isteyen
 * biri bu dosyayı da değiştirmek zorunda kalsın; değişiklik bilinçli olsun.
 */

test('on alan var ve hepsi tam olarak beklenen adlar', () => {
  assert.deepEqual([...SUPERVISORS], [
    'catalog',
    'pricing',
    'merchant',
    'search',
    'growth',
    'engineering',
    'infra',
    'commerce',
    'risk',
    'intelligence',
  ]);
});

test('sistemle örtüşmeyen eski alanlar KALDIRILDI', () => {
  /* Bu dördü için üretimde tablo, depoda kod yolu yoktu. Geriye dönük
     uyumluluk adına tutulsalardı ajanlar oraya sızmaya devam ederdi. */
  for (const kaldirilan of ['automotive', 'travel_local', 'ads', 'marketing']) {
    assert.equal(
      (SUPERVISORS as readonly string[]).includes(kaldirilan),
      false,
      `${kaldirilan} hâlâ listede`,
    );
  }
});

test('en çok kodun bulunduğu dört alan artık temsil ediliyor', () => {
  /* Alım hattı, arama, mühendislik/QA ve veri altyapısı -- eski listede
     hiçbirinin süpervizörü yoktu. */
  for (const gereken of ['catalog', 'search', 'engineering', 'infra']) {
    assert.equal(
      (SUPERVISORS as readonly string[]).includes(gereken),
      true,
      `${gereken} eksik`,
    );
  }
});

test('alan adları tekrarsız', () => {
  assert.equal(new Set(SUPERVISORS).size, SUPERVISORS.length);
});

// --- Kayıt defterinin alan filtresi ---------------------------------------

function ajan(id: string, supervisor: SupervisorId): AgentDefinition {
  return {
    id,
    supervisor,
    capabilities: [id],
    allowedTools: ['read_catalog'] as ToolName[],
    timeoutMs: 1000,
    maxRetries: 0,
    marketScope: 'all',
    enabled: true,
    async run(): Promise<AgentResult> {
      return { output: id, confidence: 1 };
    },
  };
}

test('bySupervisor yalnızca o alanın ajanlarını döndürür', () => {
  /* `bySupervisor` bugüne kadar hiç test edilmemişti; alan listesi
     değiştiği için davranışı da sabitleniyor. */
  const kayit = new AgentRegistry();
  kayit.register(ajan('katalog-kalite', 'catalog'));
  kayit.register(ajan('urun-eslestirme', 'catalog'));
  kayit.register(ajan('sorgu-performansi', 'infra'));

  const katalog = kayit.bySupervisor('catalog').map((a) => a.id).sort();
  assert.deepEqual(katalog, ['katalog-kalite', 'urun-eslestirme']);

  assert.deepEqual(kayit.bySupervisor('infra').map((a) => a.id), ['sorgu-performansi']);
  /* Ajanı olmayan alan boş döner -- hata değil. */
  assert.deepEqual(kayit.bySupervisor('growth'), []);
});

test('her alan için ajan kaydedilebilir', () => {
  /* Bir alanın yalnızca tip düzeyinde var olup pratikte kullanılamaması
     sessiz bir kırıklık olurdu. */
  const kayit = new AgentRegistry();
  for (const alan of SUPERVISORS) kayit.register(ajan(`ajan-${alan}`, alan));
  assert.equal(kayit.all().length, SUPERVISORS.length);
  for (const alan of SUPERVISORS) {
    assert.equal(kayit.bySupervisor(alan).length, 1, `${alan} için ajan bulunamadı`);
  }
});
