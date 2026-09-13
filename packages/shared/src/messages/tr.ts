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
  'ortak.sayfaYolu': 'Sayfa yolu',

  // --- Arama kutusu ---
  'arama.yerTutucuHero': 'Ne arıyorsun?',
  'arama.yerTutucuKompakt': 'Ürün, marka veya model',
  'arama.etiket': 'Ürün ara',
  'arama.etiketUstCubuk': 'Üst çubukta ürün ara',
  'arama.dugme': 'Ara',
  'arama.markaSeridi': 'Çok ürünü olan markalar:',
  'arama.cumleIpucu': 'Cümleyle de arayabilirsin',
  'arama.sonuclariBaslik': '“{q}” arama sonuçları',
  'arama.baslikOnek': 'Arama:',
  'arama.metaAciklamaSorgulu': '{q} için tüm mağazalardaki fiyatları karşılaştırın.',
  'arama.metaAciklamaGenel':
    'Ohaaaa’daki tüm ürünleri keşfedin ve mağazalar arası fiyatları karşılaştırın.',
  'arama.barkodYok': '{barkod} barkodlu ürün henüz katalogda yok. Ürün adını yazarak arayabilirsiniz.',

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
  'kategori.fiyatlariSayfa': '{ad} Fiyatları — sayfa {sayfa}',
  'kategori.metaAciklama':
    '{ad} kategorisindeki ürünleri onlarca mağazada karşılaştırın. Kargo dahil en iyi toplam fiyatı görün, en ucuz satıcıyı tek bakışta bulun.',
  'kategori.ogBaslik': '{ad} Fiyatları · Ohaaaa',
  'kategori.ogAciklama': '{ad} kategorisinde mağaza fiyatlarını karşılaştırın.',
  'kategori.ozetSayim': '{ad} kategorisinde {urunSayisi} karşılaştırıyoruz{sayfaBilgisi}.',
  'kategori.urunAdet': '{adet} ürünü',
  'kategori.sayfaBilgisi': ' (sayfa {sayfa}/{toplam})',
  'kategori.buSayfada': 'Bu sayfada {teklifSayisi} var.',
  'kategori.magazaTeklifi': '{adet} mağaza teklifi',
  'kategori.enDusukFiyat': 'Fiyatlar {fiyat} seviyesinden başlıyor.',
  'kategori.siralamaAciklama': 'Sıralama kargo dahil toplam maliyete göre yapılır.',

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
  'urun.metaFiyatEki': ' — {fiyat} seviyesinden başlayan fiyatlarla',
  'urun.metaAciklama':
    '{ad}{fiyatEki}. {adet} mağazadaki fiyatları karşılaştırın, kargo dahil en iyi toplam fiyatı görün.',
  'urun.paylasMetni': '{ad} — {adet} mağazada, kargo dahil en düşük {fiyat}',
  'urun.kacMagazada': 'Bu ürün {adet} mağazada var',
  'urun.dogruMagazaSecerek': 'Doğru mağazayı seçerek',
  'urun.kazanin': '{tutar} kazanın',
  'urun.kargoDahilSiralamaAciklama':
    'Teklifler etiket fiyatına değil, kargoyla birlikte ödeyeceğiniz toplama göre sıralanır.',
  'urun.satisinTarafiDegilizAciklama':
    'Sözleşme sizinle mağaza arasında kurulur; fatura, garanti ve iade süreçleri mağazaya aittir.',

  // --- Mağaza ---
  'magaza.bulunamadi': 'Mağaza bulunamadı',
  'magaza.urunSayisi': '{adet} ürün',
  'magaza.urunYok': 'Bu mağazanın yayında ürünü yok.',
  'magaza.tumUrunlereBak': 'Tüm ürünlere bakın',
  'magaza.fiyatlariVeUrunleri': '{ad} Ürünleri ve Fiyatları',
  'magaza.sayfaBasligi': '{ad} — sayfa {sayfa}',
  'magaza.metaAciklama':
    '{ad} mağazasının Ohaaaa’daki ürünleri. Kargo dahil toplam fiyatı diğer mağazalarla karşılaştırın.',
  'magaza.ogBaslik': '{ad} · Ohaaaa',
  'magaza.ogAciklama': '{ad} ürünlerini kargo dahil fiyatla karşılaştırın.',
  'magaza.puan': '{puan} puan ({adet} değerlendirme)',
  'magaza.uyari':
    'Ohaaaa satışın tarafı değildir. Ürünlerin kargo dahil toplam fiyatını diğer mağazalarla karşılaştırmak için ürün sayfalarına bakın.',

  // --- Arama sonuçları ---
  'sonuc.tumUrunler': 'Tüm ürünler',
  'sonuc.filtreyleSonucYok': 'Bu filtrelerle sonuç yok',
  'sonuc.filtreyiGenislet': 'Fiyat aralığını genişletin ya da kategori seçimini kaldırın.',
  'sonuc.henuzUrunYok': 'Henüz ürün yok',
  'sonuc.calismiyor': 'Arama şu an çalışmıyor',
  'sonuc.ucretsizKargo': 'Ücretsiz kargo',
  'sonuc.enUygun': 'En uygun',
  'sonuc.kanonikUrun': '{adet} kanonik ürün',
  'sonuc.buSayfadaTeklif': '{adet} mağaza teklifi bu sayfada',
  'sonuc.sayfaBilgisi': 'sayfa {sayfa}/{toplam}',
  'sonuc.sorguIcinYok': '“{q}” için sonuç yok',
  'sonuc.yazimIpucu':
    'Yazımı kontrol edin veya daha genel bir terim deneyin. Türkçe karakter şart değil — “kulaklik” de “kulaklık” sonuçlarını getirir.',

  // --- Filtreler ---
  'filtre.filtrele': 'Filtrele',
  'filtre.kategori': 'Kategori',
  'filtre.kategoriFiltresi': 'Kategori filtresi',
  'filtre.kargo': 'Kargo',
  'filtre.kargoFiltresi': 'Kargo filtresi',
  'filtre.marka': 'Marka',
  'filtre.markaFiltresi': 'Marka filtresi',
  'filtre.fiyat': 'Fiyat',
  'filtre.uygula': 'Uygula',
  'filtre.temizle': 'Temizle',
  'filtre.enAzFiyat': 'En az fiyat ({birim})',
  'filtre.enFazlaFiyat': 'En fazla fiyat ({birim})',

  // --- Hata durumları ---
  'hata.veriYok': 'Fiyatları şu an gösteremiyoruz',
} as const;
