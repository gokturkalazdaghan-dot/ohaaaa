'use client';

import { useEffect, useState } from 'react';

import { MoonIcon, SunIcon } from './Icons';

/**
 * Açık/koyu tema anahtarı.
 *
 * Tercih localStorage'a yazılır ve layout'taki senkron betik tarafından
 * sonraki ziyaretlerde render'dan önce uygulanır.
 */
export function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains('light'));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !isLight;
    setIsLight(next);
    document.documentElement.classList.toggle('light', next);
    document.documentElement.classList.toggle('dark', !next);

    try {
      localStorage.setItem('ohaaaa-theme', next ? 'light' : 'dark');
    } catch {
      // Gizli sekmede localStorage yazılamayabilir; tema yine de değişir.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-muted transition-colors hover:bg-surface-hover hover:text-fg"
      aria-label={isLight ? 'Koyu temaya geç' : 'Açık temaya geç'}
    >
      {/* Sunucuda hangi temanın aktif olduğu bilinemez; ikon ancak
          bağlandıktan (mount) sonra kesinleşir. */}
      {mounted && isLight ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
    </button>
  );
}
