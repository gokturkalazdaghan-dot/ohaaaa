/**
 * Keyset (anahtar tabanlı) sayfalama ile tam liste toplama.
 *
 * NEDEN `offset` DEĞİL
 * `offset` doğrusal olarak yavaşlar: veritabanı atladığı satırları yine de
 * okur. Ohaaaa'da ölçüldü -- 20.000'inci satırdan 1.000 kayıt almak 736 ms,
 * aynı işi `slug > sonSlug` ile yapmak 38 ms ve bu süre konumdan BAĞIMSIZ.
 * Katalog büyüdükçe fark açılır; offset eninde sonunda ifade zaman aşımına
 * çarpar.
 *
 * NEDEN AYRI BİR MODÜL
 * Döngünün kendisi sıkıcı ama hatası sessizdir: bir sayfa sınırında kayıt
 * atlamak ya da iki kez saymak, site haritasında fark edilmez. Burada saf
 * (I/O'yu enjekte eden) hâlde durduğu için test edilebiliyor.
 *
 * ANAHTAR BENZERSİZ OLMALI. Eşit değerler sayfalar arasında kayar; tekil
 * olmayan bir sütunla sayfalamak tam olarak yukarıdaki sessiz hatayı üretir.
 */

export interface KeysetOptions<T> {
  /** En fazla kaç kayıt toplanacak. */
  max: number;
  /** Bir istekte kaç kayıt istenecek. */
  pageSize: number;
  /** Kaydın BENZERSİZ sıralama anahtarı. */
  key: (item: T) => string;
  /**
   * Bir sayfayı getirir.
   *
   * `after` null ise baştan başlar; değilse anahtarı ondan BÜYÜK olanlar
   * istenir. Dönen liste anahtara göre artan sırada olmalıdır.
   */
  fetchPage: (after: string | null, limit: number) => Promise<T[]>;
}

/**
 * `max` kadar kayıt toplanana ya da liste bitene kadar sayfa sayfa okur.
 *
 * Döngü ÜÇ koşuldan biriyle biter: istenen sayıya ulaşıldı, boş sayfa geldi,
 * ya da gelen sayfa istenenden kısa (son sayfa). Üçü de olmadan dönen bir
 * döngü sonsuza kadar sürerdi; son koşul özellikle önemli çünkü bazı
 * kaynaklar son sayfadan sonra boş sayfa vermez.
 */
export async function collectByKeyset<T>(options: KeysetOptions<T>): Promise<T[]> {
  const { max, pageSize, key, fetchPage } = options;
  if (max <= 0 || pageSize <= 0) return [];

  const cikti: T[] = [];
  let after: string | null = null;

  while (cikti.length < max) {
    const istenen = Math.min(pageSize, max - cikti.length);
    const sayfa = await fetchPage(after, istenen);

    if (sayfa.length === 0) break;

    cikti.push(...sayfa);

    const son = sayfa[sayfa.length - 1];
    after = son === undefined ? after : key(son);

    if (sayfa.length < istenen) break;
  }

  return cikti;
}
