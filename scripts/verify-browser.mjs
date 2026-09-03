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

import { launchBrowser } from './lib/browser.mjs';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3137').replace(/\/+$/, '');

const results = [];
function check(ok, label, detail = '') {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail && !ok ? `  — ${detail}` : ''}`);
}

const browser = await launchBrowser();
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
for (const path of [
  '/',
  '/arama',
  '/kategori/elektronik',
  '/firsatlar',
  '/urun/sony-wh-1000xm5',
  '/tasoron',
]) {
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

/*
 * ÜZERİNE GELME DAVRANIŞI DOKUNMATİKTE KAPALI OLMALI.
 *
 * Dokunmatik ekranda `:hover` dokunuşla açılır ve başka bir yere dokunulana
 * kadar üstte kalır. Yukarı kalkmış bir kart ya da "seçiliymiş gibi" duran
 * bir filtre çipi böyle ortaya çıkar; kullanıcı hangi filtrenin açık
 * olduğunu yanlış okur.
 *
 * Tailwind kendi `hover:` yardımcılarını bu kapının arkasına zaten alıyor.
 * Sınanan şey ELLE yazılmış CSS kuralları: `globals.css` içindeki
 * `.card-link`, `.chip`, `.page-btn` kuralları bir zamanlar kapısızdı.
 *
 * Ölçüm stil sayfası üzerinden yapılır, `:hover` taklit edilerek değil:
 * CDP ile sahte üzerine-gelme durumu, medya sorgusunun hangi tarafta
 * olduğunu göstermez.
 */
const hoverAudit = await page.evaluate(() => {
  const gated = /\(hover\s*:\s*hover\)/;
  const watched = /^\.(card-link|chip|chip-active|page-btn|page-btn-active):hover$/;
  const ungated = [];
  let seen = 0;

  /*
   * Seçici ÖNCE okunur, sonra içeri inilir.
   *
   * İç içe CSS'i destekleyen tarayıcılarda `CSSStyleRule.cssRules` null
   * DEĞİLDİR — iç kural yoksa boş bir listedir, yani her zaman "doğru"
   * sayılır. Sarmalayıcıları `rule.cssRules` varlığına bakarak ayırmak bu
   * yüzden bütün stil kurallarını yutuyordu ve denetim hiçbir şey görmeden
   * "kapısız kural yok" diyordu.
   */
  const walk = (rules, insideGate) => {
    for (const rule of rules) {
      const condition = rule.conditionText ?? rule.media?.mediaText ?? '';
      const nowGated = insideGate || gated.test(condition);

      if (rule.selectorText) {
        for (const selector of rule.selectorText.split(',')) {
          const trimmed = selector.trim();
          if (!watched.test(trimmed)) continue;
          seen += 1;
          if (!nowGated) ungated.push(trimmed);
        }
      }

      // @layer, @media, @supports ve iç içe kurallar
      if (rule.cssRules?.length) walk(rule.cssRules, nowGated);
    }
  };

  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules ?? [], false);
    } catch {
      /* başka kaynaktan gelen stil sayfası okunamaz; bizimkiler aynı kaynakta */
    }
  }
  return { ungated, seen };
});

/*
 * ÖNCE KURALIN VAR OLDUĞU DOĞRULANIR.
 *
 * Bu kontrol ilk yazıldığında yalnızca "kapısız kural bulunamadı" diyordu.
 * Stil sayfası hiç yüklenmediğinde de bulunamıyordu — yani CSS'in tamamen
 * kaybolduğu bir derlemede kontrol YEŞİL yanıyordu. Hiç kontrol olmamasından
 * kötü: kırık olan şeyi sağlam gösteriyordu.
 *
 * Bu yüzden önce sayılır: izlenen seçicilerden en az biri görülmediyse
 * ölçülecek bir şey yok demektir ve bu bir başarısızlıktır.
 */
check(
  hoverAudit.seen > 0,
  'Üzerine gelme kuralları stil sayfasında bulundu',
  `${hoverAudit.seen} kural`,
);
check(
  hoverAudit.seen > 0 && hoverAudit.ungated.length === 0,
  'Üzerine gelme etkileri (hover: hover) kapısının arkasında',
  hoverAudit.ungated.join(', ') || 'kural bulunamadı',
);

// --- Hareket (motion) ------------------------------------------------------
/*
 * Animasyonun "yazılmış olması" çalıştığı anlamına gelmiyor: bu depoda iki
 * sınıf (`animate-[rise_...]`, `animate-[float_...]`) hiç tanımlanmamış
 * keyframe'lere işaret ediyordu, yani sepet paneli bir anda beliriyordu ve
 * kimse fark etmemişti. Bu yüzden hesaplanmış stil doğrulanır.
 */
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/urun/sony-wh-1000xm5`, { waitUntil: 'networkidle' });
await page.locator('button:has-text("Sepete ekle")').first().click();
await page.waitForTimeout(400);

const dialog = page.locator('dialog.cart-dialog');
check(await dialog.count() > 0, 'Sepet paneli <dialog> olarak çiziliyor');

/*
 * `showModal()` ile açılmış olması şart: yalnızca o odak tuzağını, arka
 * planın etkisizleştirilmesini ve ESC ile kapanmayı verir. `open`
 * özniteliğini elle koymak bunların hiçbirini getirmez — panel
 * `aria-modal="true"` deyip odağı serbest bırakıyordu.
 */
const modalState = await dialog.evaluate((el) => ({
  open: el.open,
  // Üst katmanda mı? Yalnızca showModal() öyle açar.
  topLayer: el.matches(':modal'),
}));
check(modalState.open === true, 'Panel açık');
check(modalState.topLayer === true, 'showModal() ile açılmış (odak tuzağı var)');

// Odak panelin İÇİNDE kalmalı: sekme tuşu arkadaki sayfaya geçmemeli.
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
const focusInside = await page.evaluate(() => {
  const dlg = document.querySelector('dialog.cart-dialog');
  return dlg ? dlg.contains(document.activeElement) : false;
});
check(focusInside, 'Odak panelin içinde kalıyor');

// Giriş ve çıkış AYNI yoldan: geçiş transform üzerinde tanımlı olmalı.
const asideTransition = await dialog.locator('aside').evaluate((el) => getComputedStyle(el).transitionProperty);
check(/transform/.test(asideTransition), 'Panel geçişi transform üzerinde', asideTransition);

// ESC platformun kendi kapatma yolu; React durumu da güncellenmeli.
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check((await page.locator('dialog.cart-dialog[open]').count()) === 0, 'ESC ile kapanıyor');

/*
 * Hareketi azaltılmış mod TÜM siteyi kapsamalı. Önce yalnızca logo harfleri
 * kapatılıyordu; kart kalkması, düğme büyümesi ve panel girişi açık
 * kalıyordu. Tek bileşeni istisna tutmak, kuralı uygulamamakla aynı şey.
 */
const reduced = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
await reduced.goto(`${BASE}/urun/sony-wh-1000xm5`, { waitUntil: 'networkidle' });
await reduced.locator('button:has-text("Sepete ekle")').first().click();
await reduced.waitForTimeout(200);
const reducedTransform = await reduced
  .locator('dialog.cart-dialog aside')
  .evaluate((el) => getComputedStyle(el).transitionDuration)
  .catch(() => null);
check(
  reducedTransform === null || parseFloat(reducedTransform) < 0.05,
  'Azaltılmış modda panel hareketi kapalı',
  String(reducedTransform),
);
await reduced.close();

// --- Kullanıcının yazı boyutu ayarı ----------------------------------------
/*
 * Arayüzdeki en küçük yazılar (rozet, birim, yardımcı metin) sabit pikselle
 * yazılmıştı — 61 yerde. Yani tarayıcısında yazıyı büyüten kullanıcı için
 * TAM DA büyütmeye en çok ihtiyaç duyulan ögeler olduğu gibi kalıyordu.
 * Ölçek `rem`e taşındı; burada gerçekten ölçeklendiği ve düzeni bozmadığı
 * doğrulanır.
 */
const bigText = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await bigText.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.fontSize = '20px';
  });
});
await bigText.goto(`${BASE}/arama`, { waitUntil: 'networkidle' });
await bigText.waitForTimeout(300);

const scaled = await bigText.evaluate(() => {
  const el = document.querySelector('.text-2xs');
  return {
    size: el ? parseFloat(getComputedStyle(el).fontSize) : 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

// 16px varsayılanda 11px olan yazı, 20px kökte ~13.75px olmalı.
check(scaled.size > 12, 'Küçük yazılar kullanıcı ayarıyla büyüyor', `${scaled.size}px`);
check(scaled.overflow <= 1, 'Büyütülmüş yazıda yatay taşma yok', `${scaled.overflow}px`);
await bigText.close();

// --- Pazar yeri deseni: arama ana sayfanın birincil eylemi ------------------
/*
 * `size="hero"` arama varyantı yazılmıştı ama HİÇBİR YERDE kullanılmıyordu;
 * arama yalnızca üst çubuktaki küçük kutudan yapılabiliyordu. Bir pazar
 * yerinde ziyaretçi gezmeye değil, aklındaki ürünü bulmaya gelir.
 */
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

const heroSearch = page.locator('main input[name="q"]:visible').first();
check(await heroSearch.count() > 0, 'Ana sayfada hero arama kutusu var');
const heroBox = await heroSearch.boundingBox();
check(
  heroBox !== null && heroBox.y < 700,
  'Hero arama kutusu ilk ekranda',
  `y=${Math.round(heroBox?.y ?? -1)}`,
);

/*
 * Tarayıcılar `<button>` için imleci değiştirmez ve Tailwind'in sıfırlaması
 * da eklemez; sitedeki her düğme tıklanabilir OLMADIĞINI söylüyordu.
 */
const cursor = await page.locator('button').first().evaluate((el) => getComputedStyle(el).cursor);
check(cursor === 'pointer', 'Düğmelerde el imleci', cursor);

// --- Kırılım noktaları -----------------------------------------------------
/*
 * Dört genişlikte de yatay kaydırma olmamalı. Yatay kaydırma, mobilde
 * içeriğin bir kısmının hiç görülmemesi demektir.
 */
for (const width of [375, 768, 1024, 1440]) {
  const bp = await browser.newPage({ viewport: { width, height: 900 } });
  let worst = 0;
  /* `/tasoron/api` listede: sitedeki EN GENİŞ öge (besleme alanları tablosu,
     min 46rem) orada duruyor ve kendi `overflow-x-auto` kabında kaymalı.
     Eklendiğinde hiçbir test o sayfayı ziyaret etmiyordu — yani sitenin
     taşmaya en yatkın parçası, taşma denetiminin dışındaydı. */
  for (const path of ['/', '/arama', '/urun/sony-wh-1000xm5', '/odeme', '/tasoron/api']) {
    await bp.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    const over = await bp.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    worst = Math.max(worst, over);
  }
  check(worst <= 1, `${width}px genişlikte yatay taşma yok`, `${worst}px`);
  await bp.close();
}

/*
 * Taşma olmaması tek başına yeterli değil: geniş bir tablo `overflow: hidden`
 * ile de taşmayı bitirir ama o zaman sütunların bir kısmı ERİŞİLEMEZ olur.
 * Sayfa taşmıyor VE tablo kendi içinde kaydırılabiliyor olmalı.
 */
{
  const tp = await browser.newPage({ viewport: { width: 375, height: 900 } });
  await tp.goto(`${BASE}/tasoron/api`, { waitUntil: 'networkidle' });
  const table = await tp.evaluate(() => {
    const el = document.querySelector('table');
    if (!el) return null;
    const box = el.parentElement;
    if (!box) return null;
    return {
      tasiyorMu: box.scrollWidth > box.clientWidth,
      kaydirilabilir: ['auto', 'scroll'].includes(getComputedStyle(box).overflowX),
    };
  });
  check(table !== null, 'Besleme alanları tablosu çiziliyor');
  check(
    table !== null && (!table.tasiyorMu || table.kaydirilabilir),
    'Geniş tablo kendi kabında kaydırılabiliyor',
    table ? JSON.stringify(table) : 'tablo yok',
  );
  await tp.close();
}

/*
 * SİTE HARİTASINDAKİ HER SAYFA CANONICAL BİLDİRMELİ.
 *
 * Site haritası arama motoruna "bunları indeksle" demektir. Canonical ise
 * "bu içeriğin ASIL adresi budur". İlkini söyleyip ikincisini söylememek,
 * aynı sayfanın kök/eğik çizgili hâli, `www`'li ve `www`'siz alan adı ve
 * `?utm_*` kuyruklu bağlantıları ayrı sayfa sayılabilir hâle getirir;
 * sıralama sinyalleri bölünür.
 *
 * Denetim liste tutmaz, SİTE HARİTASINI OKUR: yeni bir sayfa haritaya
 * eklendiğinde canonical'ı da otomatik olarak zorunlu olur. Elle yazılmış
 * bir liste, tam da yeni eklenen sayfayı kaçırırdı — nitekim /kvkk,
 * /tasoron, /tasoron/api, /tasoron/basvuru, /tasoron/marka ve ana sayfanın
 * canonical'ı böyle eksik kalmıştı.
 */
{
  const sp = await browser.newPage();
  await sp.goto(`${BASE}/sitemap.xml`, { waitUntil: 'domcontentloaded' });
  const xml = await sp.content();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  check(urls.length > 0, 'Site haritası adres içeriyor', `${urls.length} adres`);

  const missing = [];
  const mismatched = [];

  for (const url of urls) {
    const path = new URL(url).pathname;
    await sp.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    const canonical = await sp
      .locator('link[rel="canonical"]')
      .first()
      .getAttribute('href')
      .catch(() => null);

    if (!canonical) {
      missing.push(path);
      continue;
    }
    // Yol eşleşmeli; alan adı ortama göre değişir (yerelde 127.0.0.1).
    if (new URL(canonical, BASE).pathname.replace(/\/$/, '') !== path.replace(/\/$/, '')) {
      mismatched.push(`${path} -> ${canonical}`);
    }
  }

  check(
    missing.length === 0,
    'Site haritasındaki her sayfa canonical bildiriyor',
    missing.join(', '),
  );
  check(
    mismatched.length === 0,
    'Canonical adresi sayfanın kendi adresini gösteriyor',
    mismatched.join(', '),
  );
  await sp.close();
}

/*
 * `aria-describedby` HEDEFİ GERÇEKTEN VAR MI?
 *
 * Kırık bir bağ sessizdir: öznitelik durur, ekran okuyucu hiçbir şey
 * okumaz ve gözle bakan kimse fark etmez. Form alanları paylaşılan tek bir
 * bileşene taşındığı için kimlikler orada üretiliyor; bu kontrol o üretimin
 * doğru çalıştığını sayfa sayfa doğrular.
 */
{
  const fp = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const broken = [];
  for (const path of ['/tasoron/basvuru', '/iletisim', '/giris', '/kayit']) {
    await fp.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    const bad = await fp.evaluate(() =>
      [...document.querySelectorAll('[aria-describedby]')]
        .flatMap((el) =>
          (el.getAttribute('aria-describedby') || '')
            .split(/\s+/)
            .filter((id) => id && !document.getElementById(id))
            .map((id) => `${el.getAttribute('name') || el.tagName}->${id}`),
        ),
    );
    for (const item of bad) broken.push(`${path}: ${item}`);
  }
  check(
    broken.length === 0,
    'aria-describedby bağları var olan bir ögeyi gösteriyor',
    broken.join(', '),
  );
  await fp.close();
}

/*
 * ARAMA FİLTRELERİ — marka ve ücretsiz kargo.
 *
 * Ölçülen dört kural:
 *   1. Marka filtresi sonucu gerçekten daraltıyor mu?
 *   2. İkinci marka EKLİYOR mu, birincinin yerine geçmiyor mu? (Kullanıcı
 *      "Sony" üstüne "Apple" tıkladığında Sony'yi kaybetmemeli.)
 *   3. Bir filtre seçiliyken diğer markalar listede KALIYOR mu? Kalmazsa
 *      kullanıcı seçimini genişletemez, filtreyi kaldırıp baştan denemek
 *      zorunda kalır.
 *   4. Fiyat bir GET FORMUDUR ve gönderildiğinde adresi baştan yazar.
 *      Marka/kargo gizli alanlarla taşınmazsa kullanıcı fiyatı değiştirdiği
 *      anda o filtreleri kaybeder — hiçbir şey tıklamadığı hâlde sonuç
 *      genişler.
 *
 * Panel mobil ve masaüstü için İKİ KEZ çizilir; `:visible` olmadan gizli
 * kopya seçilir ve tıklama hiç gerçekleşmez.
 */
{
  const sp = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const sayi = () => sp.locator('main a[href^="/urun/"]').count();

  await sp.goto(`${BASE}/arama`, { waitUntil: 'networkidle' });
  const hepsi = await sayi();
  const markaRayi = 'nav[aria-label="Marka filtresi"]:visible a';
  const markaSayisi = await sp.locator(markaRayi).count();

  check(markaSayisi > 1, 'Marka filtresi listeleniyor', `${markaSayisi} marka`);

  if (markaSayisi > 1) {
    const ilkHref = await sp.locator(markaRayi).first().getAttribute('href');
    await sp.goto(`${BASE}${ilkHref}`, { waitUntil: 'networkidle' });
    const tekMarka = await sayi();
    check(tekMarka > 0 && tekMarka < hepsi, 'Marka filtresi sonucu daraltıyor', `${tekMarka}/${hepsi}`);
    check(
      (await sp.locator(markaRayi).count()) === markaSayisi,
      'Marka seçiliyken diğer markalar listede kalıyor',
    );

    /* İkinci marka: kendi bağlantısı önceki seçimi TAŞIMALI. */
    const ikinciHref =
      (await sp.locator(markaRayi).nth(1).getAttribute('href')) ?? '';
    check(
      ikinciHref.includes('%2C') || ikinciHref.includes(','),
      'İkinci marka seçimi birinciyi koruyor (ekliyor, değiştirmiyor)',
      ikinciHref,
    );
  }

  /* Fiyat formu diğer filtreleri koruyor mu? */
  await sp.goto(`${BASE}/arama?kargo=bedava`, { waitUntil: 'networkidle' });
  const kargoRayi = await sp.locator('nav[aria-label="Kargo filtresi"]:visible a').count();
  check(kargoRayi > 0, 'Ücretsiz kargo filtresi listeleniyor');

  const fiyatFormu = sp
    .locator('form:visible')
    .filter({ has: sp.locator('input[name="min"]') })
    .first();

  if ((await fiyatFormu.count()) > 0) {
    await fiyatFormu.locator('input[name="min"]').fill('1');
    await fiyatFormu.locator('button[type="submit"]').click();
    await sp.waitForURL(/min=1/, { timeout: 15000 }).catch(() => {});
    const adres = new URL(sp.url()).search;
    check(adres.includes('kargo=bedava'), 'Fiyat formu diğer filtreleri kaybetmiyor', adres);
  }

  await sp.close();
}

// --- Konsol hataları -------------------------------------------------------
const realErrors = consoleErrors.filter(
  (text) => !/favicon|Failed to load resource.*40[34]/i.test(text),
);
check(realErrors.length === 0, 'Konsolda hata yok', realErrors.slice(0, 3).join(' | '));

// --- Fırsat sayfası: iddia ile dayanağı ayrılamaz --------------------------
/*
 * Bu sayfanın tek riski, ölçüm olmadan "indirim" yazmasıdır. Kontrol,
 * sayfanın hangi durumda olduğuna bakmadan geçerli: ya hiç kart yoktur ve
 * dürüst boş durum görünür, ya da her kartın üzerinde düşüşün neye göre
 * ölçüldüğü yazar. İkisi de yoksa sayfa dayanaksız bir iddia gösteriyordur.
 */
await page.goto(`${BASE}/firsatlar`, { waitUntil: 'networkidle' });

const yontemNotu = await page.getByText('bizim kendi ölçtüğümüz').count();
check(yontemNotu > 0, 'Fırsat sayfası düşüşü neye göre ölçtüğünü yazıyor');

const rozetSayisi = await page.locator('text=/% ?\\d+ düştü/').count();
const dayanakSayisi = await page.getByText('gördüğümüz en yüksek fiyat').count();
const bosDurum = await page.getByText('ölçülmüş bir fiyat düşüşü yok').count();

check(
  rozetSayisi === 0 ? bosDurum > 0 : dayanakSayisi >= rozetSayisi,
  'Her düşüş iddiasının yanında ölçüm dayanağı var',
  `rozet=${rozetSayisi} dayanak=${dayanakSayisi} bosDurum=${bosDurum}`,
);

// Kategori şeridi gerçekten gezdiriyor mu?
const firsatKategori = page.locator('nav[aria-label="Fırsat kategorileri"] a[href^="/firsatlar/"]').first();
if ((await firsatKategori.count()) > 0) {
  const hedef = await firsatKategori.getAttribute('href');
  const yanit = await page.goto(`${BASE}${hedef}`, { waitUntil: 'networkidle' });
  check(yanit?.status() === 200, `Fırsat kategorisi açılıyor: ${hedef}`, `durum ${yanit?.status()}`);
  check(
    (await page.getByText('bizim kendi ölçtüğümüz').count()) > 0,
    'Kategori fırsat sayfası da yöntemi yazıyor',
  );
}

// Üst çubuktaki Fırsatlar bağı her sayfadan çalışıyor mu?
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/kategori/elektronik`, { waitUntil: 'networkidle' });
const ustBag = page.locator('nav[aria-label="Kategori menüsü"] a[href="/firsatlar"]');
check((await ustBag.count()) > 0, 'Üst çubukta Fırsatlar bağı var');

// --- Paylaş düğmesi gerçekten paylaşıyor mu? -------------------------------
/*
 * "Çalışıyor gibi görünen buton" yasak. Paylaş düğmesinin ölçülebilir işi
 * şudur: menüyü açar, menüdeki bağlantılar doğru hedefe ve KAYNAK
 * ETİKETİYLE gider. Etiket olmazsa paylaşımdan gelen ziyaret ölçülemez ve
 * özellik sessizce anlamsızlaşır.
 */
await page.goto(`${BASE}/urun/sony-wh-1000xm5`, { waitUntil: 'networkidle' });

const paylasDugmesi = page.getByRole('button', { name: 'Paylaş' });
check((await paylasDugmesi.count()) > 0, 'Ürün sayfasında paylaş düğmesi var');

await paylasDugmesi.first().click();
const paylasMenusu = page.getByRole('menu', { name: 'Paylaşım seçenekleri' });
check(await paylasMenusu.isVisible(), 'Paylaş düğmesi menüyü açıyor');

const whatsapp = await page.getByRole('menuitem', { name: 'WhatsApp' }).getAttribute('href');
check(
  typeof whatsapp === 'string' && whatsapp.includes('wa.me'),
  'WhatsApp bağlantısı WhatsApp\'a gidiyor',
  String(whatsapp),
);
check(
  typeof whatsapp === 'string' &&
    decodeURIComponent(whatsapp).includes('utm_source=whatsapp') &&
    decodeURIComponent(whatsapp).includes('/urun/sony-wh-1000xm5'),
  'Paylaşılan bağlantı ürünü ve kaynağı taşıyor',
  String(whatsapp && decodeURIComponent(whatsapp).slice(0, 160)),
);

// Escape ile kapanmayan menü, altındaki içeriği tıklanamaz bırakır.
await page.keyboard.press('Escape');
check(!(await paylasMenusu.isVisible().catch(() => false)), 'Paylaş menüsü Escape ile kapanıyor');

// Önizleme görseli gerçekten üretiliyor mu?
const onizleme = await page.goto(`${BASE}/urun/sony-wh-1000xm5/opengraph-image`, {
  waitUntil: 'domcontentloaded',
});
check(
  onizleme?.status() === 200 && (onizleme.headers()['content-type'] ?? '').includes('image/png'),
  'Ürün önizleme görseli üretiliyor',
  `${onizleme?.status()} ${onizleme?.headers()['content-type']}`,
);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} geçti`);

if (failed.length > 0) {
  console.error('\nBaşarısız kontroller:');
  for (const item of failed) console.error(`  - ${item.label}${item.detail ? `: ${item.detail}` : ''}`);
}

process.exit(failed.length > 0 ? 1 : 0);
