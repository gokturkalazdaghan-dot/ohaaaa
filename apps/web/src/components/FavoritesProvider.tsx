'use client';

/**
 * Favorilerin nerede yaşadığını belirleyen katman.
 *
 * İKİ DEPO, TEK LİSTE
 * Misafirken favoriler tarayıcıda (localStorage) tutulur: giriş yapmadan
 * gezen biri de listesini kullanabilmeli. Giriş yapıldığında ise HESAP
 * yetkilidir; telefonda işaretlenen ürün bilgisayarda da görünmeli.
 *
 * İkisini aynı anda "doğru" saymak, ikisinin ayrışacağı anlamına gelirdi:
 * bir cihazda çıkarılan favori diğerinde durmaya devam ederdi. Bu yüzden
 * herhangi bir anda TEK kaynak vardır -- `signedIn` hangisi olduğunu söyler.
 *
 * OTURUM SUNUCUYA SORULARAK ÖĞRENİLİR
 * Düzeni yerleşimden (layout) veri geçirerek kurmadım: layout'ta oturum
 * okumak bütün sayfaları dinamik yapardı ve statik üretimi kaybederdik.
 * Bunun yerine sağlayıcı ilk yüklemede sunucuya bir kez sorar; misafirde
 * `null` döner ve tarayıcı deposunda kalınır.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {
  listServerFavorites,
  mergeLocalFavorites,
  setPriceAlertOnServer,
  toggleFavoriteOnServer,
} from '@/app/favoriler/actions';
import {
  clearLocalFavorites,
  readLocalFavorites,
  removeFavorite as removeLocal,
  toggleFavorite as toggleLocal,
  type FavoriteProduct,
} from '@/lib/favorites';

interface FavoritesContextValue {
  /** Hesap listesi kullanılıyorsa dolu; misafirde null. */
  accountList: FavoriteProduct[] | null;
  toggle: (product: Omit<FavoriteProduct, 'savedAt'>) => void;
  remove: (slug: string) => void;
  /** Fiyat düşüş bildirimini açar/kapatır. Misafirde işlevsizdir. */
  setAlert: (slug: string, enable: boolean) => void;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [accountList, setAccountList] = useState<FavoriteProduct[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    /*
     * OTURUM ÇEREZİ YOKSA SUNUCUYA HİÇ SORULMAZ.
     *
     * Bu sağlayıcı her sayfada var, yani soru da her sayfada sorulurdu --
     * arama motoru botları ve giriş yapmamış ziyaretçiler dahil. Bir ürün
     * sayfasına gelen anonim ziyaretçi için bu, hiçbir şey döndürmeyecek
     * fazladan bir sunucu turu demek.
     *
     * Çerezin varlığı oturumun geçerli olduğunu KANITLAMAZ (süresi dolmuş
     * olabilir) ve zaten kanıtlaması da gerekmiyor: yetkilendirmeyi sunucu
     * yapıyor. Burada yalnızca "kesinlikle giriş yok" durumu eleniyor.
     */
    let cerezVar = false;
    try {
      cerezVar = document.cookie.split('; ').some((c) => c.startsWith('sb-'));
    } catch {
      // Çerezler okunamıyorsa sunucuya sormayı dene; kötü ihtimalde bir tur.
      cerezVar = true;
    }
    if (!cerezVar) return;

    void (async () => {
      const server = await listServerFavorites().catch(() => null);
      if (cancelled || server === null) return;

      /*
       * Girişten sonra cihazdaki liste hesaba taşınır ve tarayıcıdan
       * SİLİNİR. Bırakılsaydı, kullanıcı çıkış yaptığında eski liste geri
       * gelir ve o gün hesapta yaptığı değişiklikler yok sayılmış görünürdü.
       */
      const local = readLocalFavorites();
      if (local.length > 0) {
        await mergeLocalFavorites(
          local.map((item) => ({ slug: item.slug, saved_price_cents: item.savedPriceCents })),
        ).catch(() => ({ merged: 0 }));
        clearLocalFavorites();

        const refreshed = await listServerFavorites().catch(() => server);
        if (!cancelled) setAccountList(refreshed ?? server);
        return;
      }

      setAccountList(server);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    (product: Omit<FavoriteProduct, 'savedAt'>) => {
      if (accountList === null) {
        toggleLocal(product);
        return;
      }

      // İyimser güncelleme: kalp anında dolar. Sunucu reddederse liste bir
      // sonraki okumada zaten düzelir; kullanıcıyı ağ turu kadar bekletmek
      // bir favori düğmesi için ağır bir bedel.
      const exists = accountList.some((item) => item.slug === product.slug);
      setAccountList(
        exists
          ? accountList.filter((item) => item.slug !== product.slug)
          : [{ ...product, savedAt: Date.now() }, ...accountList],
      );

      void toggleFavoriteOnServer({
        slug: product.slug,
        saved_price_cents: product.savedPriceCents ?? undefined,
      }).catch(() => undefined);
    },
    [accountList],
  );

  const remove = useCallback(
    (slug: string) => {
      if (accountList === null) {
        removeLocal(slug);
        return;
      }

      const existing = accountList.find((item) => item.slug === slug);
      setAccountList(accountList.filter((item) => item.slug !== slug));
      if (existing) {
        void toggleFavoriteOnServer({ slug }).catch(() => undefined);
      }
    },
    [accountList],
  );

  /*
   * Bildirim anahtarı da İYİMSER güncellenir.
   *
   * İlk yazışta bu bir `<form action={sunucuEylemi}>` idi ve düğme
   * GÖRÜNÜRDE HİÇBİR ŞEY YAPMIYORDU: sunucu eylemi `revalidatePath` çağırıyor
   * ama liste sunucudan değil bu sağlayıcının istemci durumundan çiziliyor.
   * Yani veri değişiyor, ekran değişmiyordu -- kullanıcı için "bozuk düğme".
   */
  const setAlert = useCallback(
    (slug: string, enable: boolean) => {
      if (accountList === null) return;

      setAccountList(
        accountList.map((item) =>
          item.slug === slug ? { ...item, notifyOnDrop: enable } : item,
        ),
      );

      void setPriceAlertOnServer(slug, enable).catch(() => undefined);
    },
    [accountList],
  );

  return (
    <FavoritesContext.Provider value={{ accountList, toggle, remove, setAlert }}>
      {children}
    </FavoritesContext.Provider>
  );
}

/*
 * Sağlayıcı yoksa null döner ve çağıran taraf tarayıcı deposuna düşer.
 * Hata fırlatmak, sağlayıcının henüz eklenmediği bir ağaçta favori
 * düğmesinin sayfayı komple düşürmesi demek olurdu.
 */
export function useFavoritesContext(): FavoritesContextValue | null {
  return useContext(FavoritesContext);
}
