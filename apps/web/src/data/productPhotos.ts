import fs from 'node:fs';
import path from 'node:path';

/**
 * public/products altinda fotografi OLAN urun slug'lari.
 *
 * NEDEN LISTE TUTULUYOR?
 * "Her urun icin /products/<slug>.jpg dene" yaklasimi, fotografi olmayan
 * her uruende kirik gorsel ikonu birakir - bos bir yer tutucudan cok daha
 * kotu gorunur, siteyi bozuk gosterir. Dosya sistemi derleme aninda bir kez
 * okunur; klasore yeni bir fotograf birakmak yeterlidir, kod degismez.
 *
 * Bu modul yalnizca sunucuda calisir (node:fs). Bir istemci bileseninden
 * import edilirse derleme kirilir - sessizce yanlis calismaz.
 */
const PHOTO_DIR = path.join(process.cwd(), 'public', 'products');

function readPhotoSlugs(): Set<string> {
  try {
    return new Set(
      fs
        .readdirSync(PHOTO_DIR)
        .filter((name) => /\.(jpg|jpeg|png|webp|avif)$/i.test(name))
        .map((name) => name.replace(/\.[^.]+$/, '')),
    );
  } catch {
    // Klasor yoksa fotograf da yok; yer tutucuya duselim.
    return new Set();
  }
}

const slugs = readPhotoSlugs();

export function localPhotoFor(slug: string | null | undefined): string | null {
  if (!slug || !slugs.has(slug)) return null;
  return `/products/${slug}.jpg`;
}
