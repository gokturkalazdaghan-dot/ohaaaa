import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aramaAiAcik, cozumleAiAyari, gorselAiAcik } from './aiProvider.js';

/**
 * Bu testlerin ortak sorusu: yanlış ya da eksik bir ayar SESSİZCE çalışan
 * bir şeye dönüşüyor mu?
 *
 * Sağlayıcı seçimi bir maliyet kararı ama aynı zamanda bir VERİ AKIŞI
 * kararı: kullanıcının arama metni hangi şirkete gidiyor. Sessizce
 * varsayılana düşen bir ayar, işletmecinin bilmediği bir yere veri
 * gönderir. Bu yüzden buradaki iddiaların çoğu "null döner" biçiminde.
 */

// ---------------------------------------------------------------------------
// Geriye dönük uyumluluk
// ---------------------------------------------------------------------------

test('yalnizca ANTHROPIC anahtari verildiginde bugunku kurulum AYNEN calisir', () => {
  /*
   * EN ÖNEMLİ İDDİA. Bugün çalışan her ortamda tek bir anahtar tanımlı ve
   * başka hiçbir şey yok. Bu satır düşerse production'daki arama AI'ı
   * sessizce kapanır.
   */
  const ayar = cozumleAiAyari({ anthropicApiKey: 'sk-ant-ornek' });

  assert.notEqual(ayar, null);
  assert.equal(ayar!.saglayici, 'anthropic');
  assert.equal(ayar!.apiKey, 'sk-ant-ornek');
  assert.equal(ayar!.baseUrl, 'https://api.anthropic.com');
  assert.equal(ayar!.aramaModeli, 'claude-opus-5');
  assert.equal(ayar!.gorselModeli, 'claude-haiku-4-5-20251001');
  assert.equal(ayar!.jsonModu, 'json_schema');
  assert.equal(aramaAiAcik(ayar), true);
  assert.equal(gorselAiAcik(ayar), true);
});

test('yeni anahtar eski anahtarin ONUNE gecer', () => {
  const ayar = cozumleAiAyari({ apiKey: 'yeni', anthropicApiKey: 'eski' });
  assert.equal(ayar!.apiKey, 'yeni');
});

test('model secimi ustune yazilabilir -- maliyet karari isletmecinin', () => {
  const ayar = cozumleAiAyari({
    anthropicApiKey: 'k',
    aramaModeli: 'claude-haiku-4-5-20251001',
  });
  assert.equal(ayar!.aramaModeli, 'claude-haiku-4-5-20251001');
});

// ---------------------------------------------------------------------------
// Anahtar yoksa AI kapalı
// ---------------------------------------------------------------------------

test('anahtar yoksa null -- ve bu gecerli bir durum', () => {
  /*
   * Uygulama AI olmadan da çalışıyor: arama düz metne düşüyor, kamera
   * düğmesi barkod yolunu kullanıyor. Bu yüzden hata FIRLATILMIYOR.
   */
  assert.equal(cozumleAiAyari({}), null);
  assert.equal(cozumleAiAyari({ apiKey: '   ' }), null, 'bosluk anahtar sayilmaz');
  assert.equal(aramaAiAcik(null), false);
  assert.equal(gorselAiAcik(null), false);
});

// ---------------------------------------------------------------------------
// FAIL CLOSED — yanlış ayar varsayılana düşmez
// ---------------------------------------------------------------------------

test('taninmayan saglayici VARSAYILANA DUSMEZ, null doner', () => {
  /*
   * Yazım hatası sessizce Anthropic'e düşseydi, işletmeci Groq'a geçtiğini
   * sanırken faturası Anthropic'ten gelirdi ve kullanıcı verisi düşündüğü
   * yerden başka bir şirkete giderdi.
   */
  assert.equal(cozumleAiAyari({ saglayici: 'openai', apiKey: 'k' }), null);
  assert.equal(cozumleAiAyari({ saglayici: 'anthropik', apiKey: 'k' }), null);
});

test('taninmayan json modu da null doner', () => {
  assert.equal(
    cozumleAiAyari({ anthropicApiKey: 'k', jsonModu: 'strict' }),
    null,
    'sessizce yok sayilan bir ayar, isletmecinin niyetini yutardi',
  );
});

// ---------------------------------------------------------------------------
// OpenAI-uyumlu: uydurulmuş varsayılan YOK
// ---------------------------------------------------------------------------

test('openai-uyumlu icin adres ZORUNLU -- uydurulacak bir varsayilan yok', () => {
  assert.equal(cozumleAiAyari({ saglayici: 'openai-uyumlu', apiKey: 'k' }), null);
});

test('openai-uyumlu tam ayarla calisir ve adres sonundaki egik cizgi temizlenir', () => {
  const ayar = cozumleAiAyari({
    saglayici: 'openai-uyumlu',
    apiKey: 'gsk_ornek',
    baseUrl: 'https://api.ornek.test/v1/',
    aramaModeli: 'ornek-70b',
    gorselModeli: 'ornek-vision',
  });

  assert.equal(ayar!.baseUrl, 'https://api.ornek.test/v1', 'cift egik cizgi olusmamali');
  assert.equal(ayar!.saglayici, 'openai-uyumlu');
  assert.equal(aramaAiAcik(ayar), true);
  assert.equal(gorselAiAcik(ayar), true);
});

test('openai-uyumlu MODEL ADI UYDURMAZ -- model yoksa o yetenek kapali', () => {
  /*
   * Her sağlayıcının kendi model adları var; "gpt-4o" ya da "llama-3"
   * varsaymak, çalışma anında 404 almak demektir. Kapalı kalmak yeğdir:
   * kapalıyken düğme hiç çizilmiyor, kullanıcı boşa emek harcamıyor.
   */
  const ayar = cozumleAiAyari({
    saglayici: 'openai-uyumlu',
    apiKey: 'k',
    baseUrl: 'https://api.ornek.test/v1',
    aramaModeli: 'ornek-70b',
    // gorselModeli verilmedi
  });

  assert.notEqual(ayar, null, 'saglayici yapilandirilabilir');
  assert.equal(aramaAiAcik(ayar), true, 'metin aramasi acik');
  assert.equal(gorselAiAcik(ayar), false, 'gorsel arama KAPALI');
  assert.equal(ayar!.gorselModeli, null);
});

test('iki yetenek AYRI AYRI acilip kapanabilir', () => {
  const yalnizGorsel = cozumleAiAyari({
    saglayici: 'openai-uyumlu',
    apiKey: 'k',
    baseUrl: 'https://api.ornek.test/v1',
    gorselModeli: 'ornek-vision',
  });

  assert.equal(aramaAiAcik(yalnizGorsel), false);
  assert.equal(gorselAiAcik(yalnizGorsel), true);
});

test('json modu asagi cekilebilir -- saglayici destegi degisiyor', () => {
  for (const mod of ['json_schema', 'json_object', 'yok'] as const) {
    const ayar = cozumleAiAyari({ anthropicApiKey: 'k', jsonModu: mod });
    assert.equal(ayar!.jsonModu, mod);
  }
});
