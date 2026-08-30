# Ürün fotoğrafları — lisans doğrulanmadı

**Bu klasördeki dosyalar yayına çıkmadan önce gözden geçirilmelidir.**

Buradaki altı fotoğraf depoya kaynak, atıf ve lisans kaydı olmadan eklendi:

    apple-iphone-15-128gb.jpg
    dyson-v12-detect-slim.jpg
    lenovo-ideapad-slim-3-16gb.jpg
    nike-air-zoom-pegasus-40.jpg
    philips-airfryer-xxl.jpg
    sony-wh-1000xm5.jpg

İçerikleri stüdyo ürün çekimi değil, kişisel fotoğraf görünümünde (bir
koltukta kulaklık, bir masada açık dizüstü, mağaza rafında ayakkabı). Bu,
üçüncü şahıslara ait olma ihtimalinin yüksek olduğu anlamına gelir.

Site ticari, yayında ve arama motorlarına açık. Telif hakkı olan bir
fotoğrafı izinsiz yayınlamak gerçek bir risktir.

## Yapılması gereken

Her dosya için şunlardan biri:

1. **Kaynağı ve lisansı belgele.** Ticari kullanıma açık bir kaynaktan
   (Unsplash, Pexels, üreticinin basın kiti, mağazanın kendi beslemesi)
   geldiyse, kaynağı ve lisansı bu dosyaya yaz.
2. **Kaldır.** Dosyayı silmek yeterlidir; `ProductCard` o ürün için
   otomatik olarak tasarlanmış yer tutucuya döner. Kırık görsel çıkmaz.

## Uzun vadede bu klasöre gerek yok

Gerçek katalog bağlandığında ürün görselleri mağaza beslemelerinden gelir
ve kullanım hakkı ortaklık sözleşmesinin parçasıdır. Bu klasör yalnızca
demo/vitrin amaçlıdır.

## Yeni fotoğraf eklerken

Dosya adı ürünün slug'ı olmalı: `<slug>.jpg`. Kod değişikliği gerekmez;
`src/data/productPhotos.ts` klasörü derleme anında okur ve yalnızca
gerçekten var olan dosyaları kullanır.
