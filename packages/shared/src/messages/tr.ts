/**
 * Türkçe arayüz metinleri -- ANAHTAR KÜMESİNİN KAYNAĞI.
 *
 * `MessageKey` bu nesneden türetiliyor ve `en.ts` aynı anahtarları taşımak
 * zorunda. Yani buraya bir metin eklemek, İngilizcesini eklemeyi DERLEME
 * ZAMANINDA zorunlu kılıyor -- yarım çeviri mümkün değil.
 *
 * ANAHTAR ADLARI YÜZEYE GÖRE: `urun.*`, `kategori.*`, `arama.*`. Metne göre
 * adlandırmak (`kargoDahilToplam`) metin değişince anahtarı da anlamsız
 * kılardı.
 */
export const TR = {
  // --- Ortak ---
  'ortak.urunler': 'Ürünler',
  'ortak.magaza': 'Mağaza',
  'ortak.magazalar': 'Mağazalar',
  'ortak.sirala': 'Sırala',
  'ortak.siralama': 'Sıralama',
  'ortak.anaSayfa': 'Ana sayfa',
  'ortak.tumu': 'Tümü',
  'ortak.firsatlar': 'Fırsatlar',
  'ortak.giris': 'Giriş',

  // --- Arama kutusu ---
  'arama.yerTutucuHero': 'Ne arıyorsun?',
  'arama.yerTutucuKompakt': 'Ürün, marka veya model',
  'arama.etiket': 'Ürün ara',
  'arama.etiketUstCubuk': 'Üst çubukta ürün ara',
  'arama.dugme': 'Ara',
  'arama.markaSeridi': 'Çok ürünü olan markalar:',
  'arama.cumleIpucu': 'Cümleyle de arayabilirsin',

  // --- Ana sayfa ---
  'ev.basligiVurgu': 'OHA!',
  'ev.basligi': 'Aradığını bulduk',
  'ev.altBaslik':
    'Ne aradığını yaz — mağazaların kargo ve indirimlerini hesaba katıp {vurgu} karşılaştıralım. En düşük toplam üstte durur.',
  'ev.altBaslikVurgu': 'kargo dahil toplam tutarı',
  'ev.cokKarsilastirilanlar': 'Çok karşılaştırılanlar',
  'ev.karsilastirdigimizMagazalar': 'Karşılaştırdığımız mağazalar',
  'ev.katalogBos': 'Katalog satıcılarla birlikte dolacak',
  'ev.listelenemiyor': 'Ürünleri şu an listeleyemiyoruz',
  'ev.kategoriler': 'Kategoriler',

  // --- Vitrin ---
  'vitrin.baslik': 'Vitrin',
  'vitrin.aciklama':
    'En çok teklif veren mağazadan başlayarak, her basamakta o mağazanın öne çıkan beş ürünü.',
  'vitrin.olcutPuan': 'Ohaaaa puanına göre',
  'vitrin.olcutPuanKismi': '{adet} üründe Ohaaaa puanı ölçüldü, onlar önde',
  'vitrin.olcutTeklif': 'Ohaaaa puanı henüz ölçülemedi — en çok teklifle karşılaştırılanlar',
  'vitrin.teklif': '{adet} teklif',

  // --- Kategori ---
  'kategori.bulunamadi': 'Kategori bulunamadı',
  'kategori.fiyatlari': '{ad} Fiyatları',
  'kategori.bosKategori': 'Bu kategoride henüz ürün yok. Yeni satıcılar eklendikçe burası dolacak.',
  'kategori.digerKategoriler': 'Diğer kategoriler',
  'kategori.altindakiDigerleri': '{ust} altındaki diğer kategoriler',
  'kategori.altKategoriler': 'Alt kategoriler',
  'kategori.enCokMagaza': 'En çok mağaza',
  'kategori.artanFiyat': 'Artan fiyat',
  'kategori.azalanFiyat': 'Azalan fiyat',

  // --- Ürün ---
  'urun.bulunamadi': 'Ürün bulunamadı',
  'urun.magazaFiyatlari': 'Mağaza fiyatları',
  'urun.ozellikler': 'Özellikler',
  'urun.bunlaraDaBakin': 'Bunlara da bakın',
  'urun.stokYok': 'Bu ürün şu anda hiçbir mağazada stokta değil.',
  'urun.kargoDahilSiralama': 'Kargo dahil sıralama',
  'urun.kargoDahilAciklama':
    'Kargo dahil toplam maliyete göre sıralanmıştır — gerçekte ödeyeceğiniz tutar.',
  'urun.satisinTarafiDegiliz': 'Satışın tarafı değiliz',

  // --- Mağaza ---
  'magaza.bulunamadi': 'Mağaza bulunamadı',
  'magaza.urunSayisi': '{adet} ürün',
  'magaza.urunYok': 'Bu mağazanın yayında ürünü yok.',
  'magaza.tumUrunlereBak': 'Tüm ürünlere bakın',
  'magaza.fiyatlariVeUrunleri': '{ad} Ürünleri ve Fiyatları',

  // --- Arama sonuçları ---
  'sonuc.tumUrunler': 'Tüm ürünler',
  'sonuc.filtreyleSonucYok': 'Bu filtrelerle sonuç yok',
  'sonuc.filtreyiGenislet': 'Fiyat aralığını genişletin ya da kategori seçimini kaldırın.',
  'sonuc.henuzUrunYok': 'Henüz ürün yok',
  'sonuc.calismiyor': 'Arama şu an çalışmıyor',
  'sonuc.ucretsizKargo': 'Ücretsiz kargo',

  // --- Hata durumları ---
  'hata.veriYok': 'Fiyatları şu an gösteremiyoruz',
} as const;
