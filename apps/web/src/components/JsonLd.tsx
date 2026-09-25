/**
 * Yapılandırılmış veri (JSON-LD) gömücü.
 *
 * Fiyat karşılaştırma siteleri için bu, listedeki 20 maddeden hiçbirinde
 * geçmeyen ama en yüksek getirili SEO işidir: arama sonuçlarında fiyat
 * aralığı, satıcı sayısı ve puan görünür hâle gelir.
 *
 * GÜVENLİK: JSON.stringify çıktısı doğrudan <script> içine yazılır. Veri
 * içinde `</script>` geçerse etiket erken kapanır ve XSS oluşur; bu yüzden
 * `<` karakteri kaçırılır.
 */
import type { Thing, WithContext } from 'schema-dts';

/**
 * TİP: schema-dts (Google, yalnızca tip -- pakete çalışma zamanı kodu girmez).
 * Yanlış yazılmış bir `@type`, schema.org'da olmayan bir alan ya da yanlış
 * türde bir değer DERLEMEDE yakalanır; sessizce bozuk JSON-LD yayınlanıp
 * arama sonucundaki fiyat/puan görünümünün kaybolması önlenir.
 */
export type JsonLdData = WithContext<Thing> | WithContext<Thing>[];

export function JsonLd({ data }: { data: JsonLdData }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return (
    <script
      type="application/ld+json"
      // Bu içerik bizim ürettiğimiz veridir, kullanıcı girdisi değildir;
      // yine de yukarıdaki kaçış uygulanır.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
