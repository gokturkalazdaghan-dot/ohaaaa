import Link from 'next/link';

/**
 * Sayfalama.
 *
 * Bağlantı olarak render edilir; arama motoru ve JavaScript'siz tarayıcı da
 * izleyebilir. Çok sayfalı sonuçlarda tüm sayfa numaralarını basmak yerine
 * geçerli sayfanın etrafında bir pencere gösterilir — 400 sayfalık bir
 * katalogda 400 bağlantı basmak sayfayı kullanılamaz hale getirir ve
 * tarama bütçesini boşa harcar.
 *
 * `rel="prev"/"next"` bilinçli: dizi halindeki sayfaların birbirinin devamı
 * olduğunu tarayıcıya ve tarayıcılara bildirir.
 */
export function Pagination({
  page,
  totalPages,
  buildHref,
  windowSize = 2,
}: {
  page: number;
  totalPages: number;
  buildHref: (changes: Record<string, string | undefined>) => string;
  windowSize?: number;
}) {
  if (totalPages <= 1) return null;

  const first = Math.max(1, page - windowSize);
  const last = Math.min(totalPages, page + windowSize);

  const numbers: number[] = [];
  for (let i = first; i <= last; i += 1) numbers.push(i);

  return (
    <nav aria-label="Sayfalar" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 && (
        <Link href={buildHref({ sayfa: String(page - 1) })} className="page-btn" rel="prev">
          ← Önceki
        </Link>
      )}

      {first > 1 && (
        <>
          <Link href={buildHref({ sayfa: '1' })} className="page-btn">
            1
          </Link>
          {first > 2 && (
            <span aria-hidden="true" className="px-1 text-subtle">
              …
            </span>
          )}
        </>
      )}

      {numbers.map((n) => (
        <Link
          key={n}
          href={buildHref({ sayfa: String(n) })}
          aria-current={n === page ? 'page' : undefined}
          aria-label={`Sayfa ${n}`}
          className={n === page ? 'page-btn page-btn-active' : 'page-btn'}
        >
          {n}
        </Link>
      ))}

      {last < totalPages && (
        <>
          {last < totalPages - 1 && (
            <span aria-hidden="true" className="px-1 text-subtle">
              …
            </span>
          )}
          <Link href={buildHref({ sayfa: String(totalPages) })} className="page-btn">
            {totalPages}
          </Link>
        </>
      )}

      {page < totalPages && (
        <Link href={buildHref({ sayfa: String(page + 1) })} className="page-btn" rel="next">
          Sonraki →
        </Link>
      )}
    </nav>
  );
}
