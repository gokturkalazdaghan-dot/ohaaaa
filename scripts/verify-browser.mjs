#!/usr/bin/env node
/**
 * Tarayıcı doğrulaması — arayüzün GERÇEKTEN çalıştığını sınar.
 *
 * NEDEN AYRI BİR KONTROL
 * Birim testleri ve `curl` ile durum kodu bakmak, bir arayüzün çalıştığını
 * kanıtlamaz. Öneri listesinin açıldığını, ok tuşlarıyla gezilebildiğini,
 * Enter'ın doğru yere gittiğini, mobilde yatay kaydırma olmadığını ve
 * konsolda hata düşmediğini yalnızca gerçek bir tarayıcı gösterir.
 *
 * Kullanım:
 *   1. Uygulamayı derleyip başlatın:
 *        cd apps/web && NEXT_PUBLIC_SITE_URL=https://www.ohaaaa.com npm run build
 *        NEXT_PUBLIC_SITE_URL=https://www.ohaaaa.com npx next start -p 3137
 *   2. node scripts/verify-browser.mjs [adres]
 *
 * Varsayılan adres http://127.0.0.1:3137. Demo modunda (Supabase
 * yapılandırılmamışken) çalışacak şekilde yazıldı; yerleşik veri kümesi
 * kontrollerin hepsini besleyecek kadar dolu.
 */

import { chromium } from 'playwright-core';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3137').replace(/\/+$/, '');

/*
 * Tarayıcı yolu ortamdan gelir. Sabit bir yol yazmak, bu betiği yalnızca tek
 * bir makinede çalışır hâle getirirdi; `PLAYWRIGHT_CHROMIUM` ile ya da
 * playwright'ın kendi indirdiği tarayıcıyla çalışır.
 */
const EXEC = process.env.PLAYWRIGHT_CHROMIUM || undefined;

const results = [];
function check(ok, label, detail = '') {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail && !ok ? `  — ${detail}` : ''}`);
}

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (error) => consoleErrors.push(String(error)));

// --- Ana sayfa -------------------------------------------------------------
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

check(await page.locator('button[aria-label="Fotoğrafla ara"]').count() > 0, 'Kamera butonu var');
/*
 * Mikrofon butonu tarayıcı desteğine BAĞLI çizilir. Chromium
 * webkitSpeechRecognition tanımlar, yani burada görünmesi beklenir.
 * Asıl doğrulanan şey: buton, desteğin gerçek durumunu yansıtıyor mu.
 */
const speechSupported = await page.evaluate(
  () => 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
);
const micCount = await page.locator('button[aria-label="Sesle ara"]').count();
check(
  speechSupported ? micCount > 0 : micCount === 0,
  `Mikrofon butonu tarayıcı desteğiyle tutarlı (destek=${speechSupported})`,
  `buton sayısı=${micCount}`,
);

// --- Yazarken tamamlama ----------------------------------------------------
const input = page.locator('input[name="q"]').first();
await input.click();
await input.fill('kula');

const listbox = page.locator('[role="listbox"]');
await listbox.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
check(await listbox.count() > 0, 'Öneri listesi açılıyor');

const options = page.locator('[role="option"]');
const optionCount = await options.count();
check(optionCount > 0, `Öneri var (${optionCount})`);

// Klavye gezinmesi
await input.press('ArrowDown');
const activeId = await input.getAttribute('aria-activedescendant');
check(Boolean(activeId), 'ArrowDown ile öneri vurgulanıyor', `aria-activedescendant=${activeId}`);

const selectedCount = await page.locator('[role="option"][aria-selected="true"]').count();
check(selectedCount === 1, 'Tam bir öneri seçili işaretli', `seçili=${selectedCount}`);

// Enter vurgulanan öneriyi seçmeli
/*
 * İstemci tarafı yönlendirme bir AĞ İSTEĞİ DEĞİLDİR; `networkidle` beklemek
 * gezinme başlamadan çözülür ve test yanlış yere "hata" der. Adresin
 * değişmesini beklemek doğru koşul.
 */
await input.press('Enter');
await page.waitForURL(/\/(urun|arama)/, { timeout: 5000 }).catch(() => {});
check(
  page.url().includes('/urun/') || page.url().includes('/arama?q='),
  'Enter vurgulanan öneriye gidiyor',
  page.url(),
);

// --- Son gezilenler --------------------------------------------------------
await page.goto(`${BASE}/urun/sony-wh-1000xm5`, { waitUntil: 'networkidle' });
check(await page.locator('h1').count() > 0, 'Ürün sayfası açılıyor');

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const recent = page.locator('#son-gezilen');
check(await recent.count() > 0, 'Son gezdikleriniz şeridi görünüyor');

// --- Favoriler -------------------------------------------------------------
/*
 * Favori listesinin bir fiyat karşılaştırma sitesindeki asıl değeri
 * "işaretlediğimden beri ne oldu" sorusunun cevabı. Ekleme, sayaç ve liste
 * sayfası uçtan uca sınanır.
 */
await page.goto(`${BASE}/urun/sony-wh-1000xm5`, { waitUntil: 'networkidle' });
const favButton = page.locator('button[aria-label="Favorilere ekle"]').first();
check(await favButton.count() > 0, 'Ürün sayfasında favori düğmesi var');

await favButton.click();
await page.waitForTimeout(200);
check(
  await page.locator('button[aria-label="Favorilerden çıkar"]').count() > 0,
  'Favori düğmesi eklenmiş duruma geçiyor',
);

await page.goto(`${BASE}/favoriler`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check(
  await page.locator('a[href="/urun/sony-wh-1000xm5"]').count() > 0,
  'Favoriler sayfasında ürün listeleniyor',
);
check(
  await page.locator('text=Eklediğinizde').count() > 0,
  'Kaydedildiği andaki fiyat gösteriliyor',
);

// --- Mağaza vitrini --------------------------------------------------------
/*
 * Satıcı başvuru formu adaya `ohaaaa.com/magaza/<slug>` adresini gösteriyor.
 * O sayfanın gerçekten açıldığı ve ürün sayfasından bağlandığı doğrulanır —
 * kayıt anında verilen bir söz karşılıksız kalmasın.
 */
await page.goto(`${BASE}/urun/sony-wh-1000xm5`, { waitUntil: 'networkidle' });
const storeLink = page.locator('a[href^="/magaza/"]').first();
check(await storeLink.count() > 0, 'Ürün sayfasından mağaza vitrinine bağ var');

if ((await storeLink.count()) > 0) {
  const href = await storeLink.getAttribute('href');
  const response = await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  check(response?.status() === 200, 'Mağaza vitrini açılıyor', `${href} → ${response?.status()}`);
  check(await page.locator('h1').count() > 0, 'Mağaza sayfasında başlık var');
}

const missing = await page.goto(`${BASE}/magaza/olmayan-magaza`, { waitUntil: 'networkidle' });
check(missing?.status() === 404, 'Olmayan mağaza 404 dönüyor', String(missing?.status()));

// --- Arama filtreleri ------------------------------------------------------
await page.goto(`${BASE}/arama`, { waitUntil: 'networkidle' });
/*
 * Filtre gövdesi iki kez çizilir (mobil açılır panel + masaüstü ray) ve alan
 * kimlikleri önekle ayrılır. Görüntü genişliğine göre GÖRÜNEN olanı seçmek
 * gerekir; sabit bir kimlik yazmak testi tek düzene bağlardı.
 */
const priceMin = page.locator('input[name="min"]:visible').first();
check(await priceMin.count() > 0, 'Fiyat filtresi çiziliyor');

await priceMin.fill('5000');
await page.locator('button:has-text("Uygula"):visible').first().click();
await page.waitForURL(/min=5000/, { timeout: 5000 }).catch(() => {});
check(page.url().includes('min=5000'), 'Fiyat filtresi URL’e yazılıyor', page.url());

// --- Dokunma hedefleri (WCAG 2.5.5) ---------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/arama`, { waitUntil: 'networkidle' });

/*
 * Üst barda İKİ arama kutusu var: biri masaüstü (md altında gizli), biri
 * mobil satır. Dar ekranda GÖRÜNEN olanı ölçmek gerekir; `.first()` gizli
 * olanı seçip boyutu "yok" gösteriyordu.
 */
const camera = page.locator('button[aria-label="Fotoğrafla ara"]:visible').first();
const box = await camera.boundingBox();
check(
  box !== null && box.width >= 36 && box.height >= 36,
  'Mobilde kamera butonu dokunulabilir boyutta',
  box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'görünür buton yok',
);

const mic = page.locator('button[aria-label="Sesle ara"]:visible').first();
const micBox = (await mic.count()) > 0 ? await mic.boundingBox() : null;
check(
  micBox === null || (micBox.width >= 36 && micBox.height >= 36),
  'Mobilde mikrofon butonu dokunulabilir boyutta',
  micBox ? `${Math.round(micBox.width)}x${Math.round(micBox.height)}` : 'buton yok',
);

// --- Mobilde filtreler kapalı başlamalı ------------------------------------
/*
 * Filtreler açık başladığında kategori listesi ve fiyat kutuları ilk ekranın
 * tamamını kaplıyor ve kullanıcı tek bir ürün görmeden kaydırmak zorunda
 * kalıyordu. Arama sonucuna gelen kişinin ilk isteği ürünleri görmek.
 */
await page.goto(`${BASE}/arama`, { waitUntil: 'networkidle' });
const disclosure = page.locator('details:visible').first();
check(await disclosure.count() > 0, 'Mobilde filtreler açılır panelde');
check(
  (await disclosure.getAttribute('open')) === null,
  'Mobilde filtreler KAPALI başlıyor',
);

const firstCard = page.locator('a[href^="/urun/"]').first();
const cardBox = await firstCard.boundingBox();
check(
  cardBox !== null && cardBox.y < 1200,
  'İlk ürün kartı makul bir kaydırma içinde',
  cardBox ? `y=${Math.round(cardBox.y)}px` : 'kart yok',
);

await disclosure.locator('summary').click();
await page.waitForTimeout(200);
check(
  (await disclosure.getAttribute('open')) !== null,
  'Filtre paneli tıklayınca açılıyor',
);

// --- Yatay taşma -----------------------------------------------------------
for (const path of ['/', '/arama', '/kategori/elektronik', '/urun/sony-wh-1000xm5', '/tasoron']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 1, `Mobilde yatay taşma yok: ${path}`, `${overflow}px taşma`);
}

// --- Üst çubuk: yüzen malzeme katmanı ---------------------------------------
/*
 * Üst çubuk sayfayla birlikte kayıp gidiyordu; arama ve sepet ürün
 * listesinin ortasında erişilemez oluyordu. Yapışkan olması, yarı saydam
 * olması ve kenarlığın ancak içeriğin üstüne bindiğinde belirmesi
 * (Apple'ın "kaydırma kenar etkisi" kuralı) doğrulanır.
 */
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/arama`, { waitUntil: 'networkidle' });

const header = page.locator('header.site-header');
const headerStyle = await header.evaluate((el) => {
  const s = getComputedStyle(el);
  return {
    position: s.position,
    backdrop: s.backdropFilter === 'none' ? s.webkitBackdropFilter : s.backdropFilter,
    border: s.borderBottomColor,
  };
});

check(headerStyle.position === 'sticky', 'Üst çubuk yapışkan', headerStyle.position);
/*
 * Bulanıklık iki kez kırıldı: önce `.glass` kuralı `backdrop-filter: none`
 * bırakılmıştı, sonra elle yazılan `-webkit-` öneki yüzünden derleyici
 * STANDART özelliği çıktıdan düşürdü (Firefox'ta hiç uygulanmıyordu).
 * Bu yüzden hesaplanmış değer sınanıyor, kaynaktaki yazı değil.
 */
check(/blur/.test(headerStyle.backdrop ?? ''), 'Üst çubuk yarı saydam malzeme', headerStyle.backdrop);
check(
  headerStyle.border === 'rgba(0, 0, 0, 0)',
  'Sayfanın tepesinde ayırıcı çizgi yok',
  headerStyle.border,
);

await page.evaluate(() => window.scrollTo(0, 600));
await page.waitForTimeout(400);
check((await header.getAttribute('data-stuck')) === 'true', 'Kaydırınca çubuk "stuck" oluyor');
check(
  (await header.evaluate((el) => getComputedStyle(el).borderBottomColor)) !== 'rgba(0, 0, 0, 0)',
  'Kaydırınca ayırıcı çizgi beliriyor',
);
const headerBox = await header.boundingBox();
check(headerBox !== null && headerBox.y < 5, 'Çubuk ekranda kalıyor', `y=${headerBox?.y}`);
await page.evaluate(() => window.scrollTo(0, 0));

// --- Basma geri bildirimi ---------------------------------------------------
/*
 * Apple'ın birinci kuralı: tepki BASINCA verilir, bırakınca değil. Gecikme,
 * doğrudanlık hissini bitiren şeydir.
 */
const pressed = page.locator('.press').first();
check((await page.locator('.press').count()) > 0, 'Birincil düğmelerde basma sınıfı var');
const pressDuration = await pressed.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
check(
  pressDuration > 0 && pressDuration <= 0.12,
  'Basma tepkisi 120ms altında',
  `${pressDuration}s`,
);

// --- Hareket (motion) ------------------------------------------------------
/*
 * Animasyonun "yazılmış olması" çalıştığı anlamına gelmiyor: bu depoda iki
 * sınıf (`animate-[rise_...]`, `animate-[float_...]`) hiç tanımlanmamış
 * keyframe'lere işaret ediyordu, yani sepet çekmecesi bir anda beliriyordu
 * ve kimse fark etmemişti. Bu yüzden hesaplanmış stil doğrulanır.
 */
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/urun/sony-wh-1000xm5`, { waitUntil: 'networkidle' });
await page.locator('button:has-text("Sepete ekle")').first().click();
await page.waitForTimeout(120);

const drawerAnim = await page
  .locator('.drawer-enter')
  .evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, duration: parseFloat(s.animationDuration), ease: s.animationTimingFunction };
  })
  .catch(() => null);

check(drawerAnim?.name === 'cekmece-gir', 'Çekmece girişi gerçekten çalışıyor', String(drawerAnim?.name));
check(
  drawerAnim !== null && drawerAnim.duration > 0 && drawerAnim.duration <= 0.3,
  'Çekmece süresi 300ms altında',
  `${drawerAnim?.duration}s`,
);
// ease-in, kullanıcının en çok baktığı anı (hareketin başını) geciktirir.
check(
  drawerAnim !== null && !/^ease-in$|cubic-bezier\(0\.42/.test(drawerAnim.ease),
  'Çekmece eğrisi ease-in değil',
  drawerAnim?.ease,
);

/*
 * Hareketi azaltılmış mod TÜM siteyi kapsamalı. Önce yalnızca logo harfleri
 * kapatılıyordu; kart kalkması, düğme büyümesi ve çekmece girişi açık
 * kalıyordu. Tek bileşeni istisna tutmak, kuralı uygulamamakla aynı şey.
 */
const reduced = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
await reduced.goto(`${BASE}/urun/sony-wh-1000xm5`, { waitUntil: 'networkidle' });
await reduced.locator('button:has-text("Sepete ekle")').first().click();
await reduced.waitForTimeout(100);
const reducedAnim = await reduced
  .locator('.drawer-enter')
  .evaluate((el) => getComputedStyle(el).animationName)
  .catch(() => null);
check(reducedAnim === 'none', 'Azaltılmış modda çekmece animasyonu kapalı', String(reducedAnim));
await reduced.close();

// --- Konsol hataları -------------------------------------------------------
const realErrors = consoleErrors.filter(
  (text) => !/favicon|Failed to load resource.*40[34]/i.test(text),
);
check(realErrors.length === 0, 'Konsolda hata yok', realErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} geçti`);

if (failed.length > 0) {
  console.error('\nBaşarısız kontroller:');
  for (const item of failed) console.error(`  - ${item.label}${item.detail ? `: ${item.detail}` : ''}`);
}

process.exit(failed.length > 0 ? 1 : 0);
