import { CategoryDrawer } from '@/components/CategoryDrawer';
import { getCategoryTree } from '@/data/catalog';
import { getRequestLocale } from '@/lib/locale';

/**
 * Çekmecenin verisini SUNUCUDA okur.
 *
 * Çekmece bir istemci bileşeni olmak zorunda (parmakla sürükleniyor), ama
 * bu onun veriyi istemciden çekmesini GEREKTİRMEZ. Ağaç zaten üst çubuktaki
 * şerit için okunuyor ve `getCategoryTree()` aynı önbellek girdisini
 * paylaşıyor -- yani çekmece sisteme fazladan tek bir sorgu bile eklemiyor.
 *
 * Veri alınamazsa çekmece HİÇ ÇİZİLMEZ: ekranın kenarında, dokunulduğunda
 * boş bir panel açan bir tutamaç bırakmak, hiç tutamaç olmamasından kötüdür.
 */
export async function CategoryDrawerMount() {
  const [tree, { contentLocale }] = await Promise.all([
    getCategoryTree().catch(() => []),
    getRequestLocale(),
  ]);
  if (tree.length === 0) return null;

  return <CategoryDrawer nodes={tree} locale={contentLocale} />;
}
