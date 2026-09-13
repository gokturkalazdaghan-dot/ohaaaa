/**
 * English interface strings.
 *
 * The key set is defined by `tr.ts`; TypeScript requires this object to carry
 * EXACTLY the same keys. A missing translation is a compile error, not a
 * half-Turkish page.
 *
 * WRITTEN FOR THE UK MARKET, which is where the catalogue actually is today
 * (35.742 offers, all GBP). Wording follows British usage -- "catalogue",
 * "delivery included" -- because that is the reader these pages will meet.
 */
import type { TR } from './tr.js';

export const EN: Record<keyof typeof TR, string> = {
  // --- Shared ---
  'ortak.urunler': 'Products',
  'ortak.magaza': 'Shop',
  'ortak.magazalar': 'Shops',
  'ortak.sirala': 'Sort',
  'ortak.siralama': 'Sorting',
  'ortak.anaSayfa': 'Home',
  'ortak.tumu': 'All',
  'ortak.firsatlar': 'Deals',
  'ortak.giris': 'Sign in',
  'ortak.sayfaYolu': 'Breadcrumb',

  // --- Search box ---
  'arama.yerTutucuHero': 'What are you looking for?',
  'arama.yerTutucuKompakt': 'Product, brand or model',
  'arama.etiket': 'Search products',
  'arama.etiketUstCubuk': 'Search products in the top bar',
  'arama.dugme': 'Search',
  'arama.markaSeridi': 'Brands with the most products:',
  'arama.cumleIpucu': 'You can also search in plain language',
  'arama.sonuclariBaslik': 'Search results for “{q}”',
  'arama.baslikOnek': 'Search:',
  'arama.metaAciklamaSorgulu': 'Compare {q} prices across every shop.',
  'arama.metaAciklamaGenel':
    'Browse everything on Ohaaaa and compare prices across shops.',
  'arama.barkodYok': 'No product with barcode {barkod} in the catalogue yet. Try searching by name.',

  // --- Home ---
  'ev.basligiVurgu': 'OHA!',
  'ev.basligi': 'We found what you need',
  'ev.altBaslik':
    'Tell us what you want — we work in each shop’s delivery cost and discounts, then compare the {vurgu}. The lowest total stays on top.',
  'ev.altBaslikVurgu': 'total including delivery',
  'ev.cokKarsilastirilanlar': 'Most compared',
  'ev.karsilastirdigimizMagazalar': 'Shops we compare',
  'ev.katalogBos': 'The catalogue fills up as shops join',
  'ev.listelenemiyor': 'We can’t list products right now',
  'ev.kategoriler': 'Categories',

  // --- Showcase ---
  'vitrin.baslik': 'Showcase',
  'vitrin.aciklama':
    'Starting with the shop offering the most, each tier shows that shop’s five standout products.',
  'vitrin.olcutPuan': 'ranked by Ohaaaa score',
  'vitrin.olcutPuanKismi': 'Ohaaaa score measured for {adet} of these — those come first',
  'vitrin.olcutTeklif': 'Ohaaaa score not measurable yet — ranked by number of offers',
  'vitrin.teklif': '{adet} offers',

  // --- Category ---
  'kategori.bulunamadi': 'Category not found',
  'kategori.fiyatlari': '{ad} Prices',
  'kategori.bosKategori': 'No products in this category yet. It will fill up as shops join.',
  'kategori.digerKategoriler': 'Other categories',
  'kategori.altindakiDigerleri': 'More under {ust}',
  'kategori.altKategoriler': 'Subcategories',
  'kategori.enCokMagaza': 'Most shops',
  'kategori.artanFiyat': 'Price: low to high',
  'kategori.azalanFiyat': 'Price: high to low',
  'kategori.fiyatlariSayfa': '{ad} Prices — page {sayfa}',
  'kategori.metaAciklama':
    'Compare {ad} across dozens of shops. See the best total price with delivery included and spot the cheapest seller at a glance.',
  'kategori.ogBaslik': '{ad} Prices · Ohaaaa',
  'kategori.ogAciklama': 'Compare shop prices in {ad}.',
  'kategori.ozetSayim': 'We compare {urunSayisi} in {ad}{sayfaBilgisi}.',
  'kategori.urunAdet': '{adet} products',
  'kategori.sayfaBilgisi': ' (page {sayfa} of {toplam})',
  'kategori.buSayfada': 'This page shows {teklifSayisi}.',
  'kategori.magazaTeklifi': '{adet} shop offers',
  'kategori.enDusukFiyat': 'Prices start at {fiyat}.',
  'kategori.siralamaAciklama': 'Ranked by total cost with delivery included.',

  // --- Product ---
  'urun.bulunamadi': 'Product not found',
  'urun.magazaFiyatlari': 'Shop prices',
  'urun.ozellikler': 'Specifications',
  'urun.bunlaraDaBakin': 'You might also like',
  'urun.stokYok': 'This product is out of stock at every shop right now.',
  'urun.kargoDahilSiralama': 'Ranked with delivery included',
  'urun.kargoDahilAciklama':
    'Sorted by total cost including delivery — what you will actually pay.',
  'urun.satisinTarafiDegiliz': 'We are not the seller',
  'urun.metaFiyatEki': ' — from {fiyat}',
  'urun.metaAciklama':
    '{ad}{fiyatEki}. Compare prices across {adet} shops and see the best total with delivery included.',
  'urun.paylasMetni': '{ad} — in {adet} shops, from {fiyat} with delivery included',
  'urun.kacMagazada': 'Available in {adet} shops',
  'urun.dogruMagazaSecerek': 'By picking the right shop',
  'urun.kazanin': 'save {tutar}',
  'urun.kargoDahilSiralamaAciklama':
    'Offers are ranked by what you actually pay with delivery, not by the sticker price.',
  'urun.satisinTarafiDegilizAciklama':
    'The contract is between you and the shop; invoicing, warranty and returns are handled by them.',

  // --- Shop ---
  'magaza.bulunamadi': 'Shop not found',
  'magaza.urunSayisi': '{adet} products',
  'magaza.urunYok': 'This shop has no products listed.',
  'magaza.tumUrunlereBak': 'Browse all products',
  'magaza.fiyatlariVeUrunleri': '{ad} Products and Prices',
  'magaza.sayfaBasligi': '{ad} — page {sayfa}',
  'magaza.metaAciklama':
    'Products from {ad} on Ohaaaa. Compare the total price with delivery against every other shop.',
  'magaza.ogBaslik': '{ad} · Ohaaaa',
  'magaza.ogAciklama': 'Compare {ad} products at their total price with delivery.',
  'magaza.puan': '{puan} out of 5 ({adet} reviews)',
  'magaza.uyari':
    'Ohaaaa is not the seller. Open a product page to compare its total price with delivery across shops.',

  // --- Search results ---
  'sonuc.tumUrunler': 'All products',
  'sonuc.filtreyleSonucYok': 'No results with these filters',
  'sonuc.filtreyiGenislet': 'Widen the price range or clear the category filter.',
  'sonuc.henuzUrunYok': 'No products yet',
  'sonuc.calismiyor': 'Search is not working right now',
  'sonuc.ucretsizKargo': 'Free delivery',
  'sonuc.enUygun': 'Best match',
  'sonuc.kanonikUrun': '{adet} products',
  'sonuc.buSayfadaTeklif': '{adet} shop offers on this page',
  'sonuc.sayfaBilgisi': 'page {sayfa} of {toplam}',
  'sonuc.sorguIcinYok': 'No results for “{q}”',
  /*
   * Türkçe sürüm "Türkçe karakter şart değil" diye devam ediyor -- o ipucu
   * yalnızca Türkçe klavyesi olmayan kullanıcı için anlamlı. İngilizce
   * okuyucuya aynı cümleyi çevirmek anlamsız bir öğüt olurdu; çeviri
   * BİREBİR değil, aynı işi gören metin.
   */
  'sonuc.yazimIpucu': 'Check the spelling or try a more general term.',

  // --- Filters ---
  'filtre.filtrele': 'Filter',
  'filtre.kategori': 'Category',
  'filtre.kategoriFiltresi': 'Category filter',
  'filtre.kargo': 'Delivery',
  'filtre.kargoFiltresi': 'Delivery filter',
  'filtre.marka': 'Brand',
  'filtre.markaFiltresi': 'Brand filter',
  'filtre.fiyat': 'Price',
  'filtre.uygula': 'Apply',
  'filtre.temizle': 'Clear',
  'filtre.enAzFiyat': 'Minimum price ({birim})',
  'filtre.enFazlaFiyat': 'Maximum price ({birim})',

  // --- Deals ---
  'firsat.baslik': 'Products That Got Cheaper',
  'firsat.kategoriBaslik': '{ad} Deals',
  'firsat.kategoriSayfaBasligi': '{ad} Deals — Products That Got Cheaper',
  'firsat.kategoriBulunamadi': 'Deal category not found',
  'firsat.giris':
    'We measure the same product day after day. This page lists the ones our own measurements show genuinely got cheaper over the last {gun} days.',
  'firsat.kategoriGiris':
    'Products in {ad} that our own measurements show got cheaper over the last {gun} days.',
  'firsat.metaAciklama':
    'Products that genuinely got cheaper according to prices we measured ourselves over the last {gun} days. No shop’s struck-through price is used; the drop comes from our own measurements.',
  'firsat.kategoriMetaAciklama':
    'Products in {ad} that genuinely got cheaper according to prices we measured ourselves over the last {gun} days. No shop’s struck-through price is used.',
  'firsat.ogBaslik': 'Products That Got Cheaper · Ohaaaa',
  'firsat.ogAciklama': 'We measure the drop, not the shop. Real price drops from the last {gun} days.',
  'firsat.kategoriOgBaslik': '{ad} Deals · Ohaaaa',
  'firsat.kategoriOgAciklama': 'Measured price drops in {ad}.',
  'firsat.gosteremiyoruz': 'We can’t show deals right now',
  'firsat.yontem':
    'These percentages come from prices {vurgu} over the last {gun} days, not from a shop’s struck-through price. A product only makes this list with at least two separate measurements and a drop above {oran}%.',
  'firsat.yontemVurgu': 'we measured ourselves',
  'firsat.kategoriler': 'Deal categories',
  'firsat.urunAdet': '{adet} products',
  'firsat.dususOlctuk': 'We measured drops on {urunAdet}',
  'firsat.enBuyugu': 'the biggest is {oran}%',
  'firsat.paylasMetni': '{baslik}: we measured drops on {adet} products',
  'firsat.bosKategori': 'No measured drops in {ad} right now',
  'firsat.bosGenel': 'No measured price drops right now',
  'firsat.bosAciklama':
    'We can only report a price drop once we have measured the same product more than once. Listing products before we have enough measurements would mean showing a discount that does not exist.',
  'firsat.urunleriKarsilastir': 'Compare products',
  'firsat.fiyatTakibiNasil': 'How does price tracking work?',
  'firsat.altUyari':
    'Prices are from our latest measurement and shops can change them at any time. The product page shows every price we have seen for it and each shop’s total cost with delivery. The lowest price right now is {fiyat}.',

  // --- Error states ---
  'hata.veriYok': 'We can’t show prices right now',
};
