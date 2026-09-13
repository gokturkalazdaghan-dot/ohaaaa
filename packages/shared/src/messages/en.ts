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

  // --- Search box ---
  'arama.yerTutucuHero': 'What are you looking for?',
  'arama.yerTutucuKompakt': 'Product, brand or model',
  'arama.etiket': 'Search products',
  'arama.etiketUstCubuk': 'Search products in the top bar',
  'arama.dugme': 'Search',
  'arama.markaSeridi': 'Brands with the most products:',
  'arama.cumleIpucu': 'You can also search in plain language',

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

  // --- Shop ---
  'magaza.bulunamadi': 'Shop not found',
  'magaza.urunSayisi': '{adet} products',
  'magaza.urunYok': 'This shop has no products listed.',
  'magaza.tumUrunlereBak': 'Browse all products',
  'magaza.fiyatlariVeUrunleri': '{ad} Products and Prices',

  // --- Search results ---
  'sonuc.tumUrunler': 'All products',
  'sonuc.filtreyleSonucYok': 'No results with these filters',
  'sonuc.filtreyiGenislet': 'Widen the price range or clear the category filter.',
  'sonuc.henuzUrunYok': 'No products yet',
  'sonuc.calismiyor': 'Search is not working right now',
  'sonuc.ucretsizKargo': 'Free delivery',

  // --- Error states ---
  'hata.veriYok': 'We can’t show prices right now',
};
