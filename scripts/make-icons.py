#!/usr/bin/env python3
"""
OHAAAA - tek master gorselden tum ikon setini uretir.

    python3 scripts/make-icons.py <master.png>

NEDEN BU BETIK VAR
Rozet daha once elle olceklenirken 139x208'e ezilmisti: daire oval olmustu ve
bu, sitenin her sayfasindaki logoda goruluyordu. Elle yeniden boyutlandirmada
bu hata sessizdir - kimse 40x40 bir gorseli olcmez. Betik once en/boy oranini
OLCER ve bozuksa durur, sonra her cikti icin kareligi korur.

URETILENLER
    apps/web/src/app/icon.png            256x256   tarayici sekmesi (Next otomatik bulur)
    apps/web/src/app/apple-icon.png      180x180   iOS ana ekran
    apps/web/public/ohaaaa-badge.png     256x256   basliktaki logo
    apps/web/src/app/opengraph-image.png 1200x630  WhatsApp/X/Facebook onizlemesi

GEREKSINIM
    pip install Pillow
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow gerekli:  pip install Pillow")

# globals.css ile ayni: --bg (kagit zemin)
PAPER = (0xF3, 0xEE, 0xE6)

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "apps" / "web"


def disc_aspect(im: Image.Image) -> float:
    """Rozetin turuncu diskinin en/boy orani. 1.0 = daire."""
    small = im.convert("RGB").resize((256, 256), Image.LANCZOS)
    px = small.load()
    xs, ys = [], []
    for y in range(256):
        for x in range(256):
            r, g, b = px[x, y]
            if r > 140 and (r - b) > 80 and g < 190:
                xs.append(x)
                ys.append(y)
    if not xs:
        return 1.0  # turuncu bulunamadi; kontrolu atla
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    return w / h if h else 1.0


def square(im: Image.Image) -> Image.Image:
    """Kareye getir - GERMEDEN, kenar ekleyerek. Germek diski ovallestirir."""
    if im.width == im.height:
        return im
    side = max(im.width, im.height)
    canvas = Image.new("RGB", (side, side), PAPER)
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)

    src = Path(sys.argv[1])
    if not src.exists():
        sys.exit(f"Bulunamadi: {src}")

    master = Image.open(src).convert("RGB")
    print(f"master: {src.name}  {master.width}x{master.height}")

    if min(master.size) < 512:
        print(f"  UYARI: {min(master.size)} px kucuk. 1024x1024 onerilir;")
        print("         opengraph gorseli buyutuldugunde bulanik cikar.")

    aspect = disc_aspect(master)
    if abs(aspect - 1.0) > 0.08:
        sys.exit(
            f"  DUR: rozetin diski en/boy {aspect:.3f} - oval, daire degil.\n"
            "       Master gorsel bozulmus. Kaynagi duzeltmeden ikon uretmek,\n"
            "       hatayi her boyuta kopyalar."
        )
    print(f"  disk en/boy {aspect:.3f} - daire")

    master = square(master)

    outputs = [
        (WEB / "src/app/icon.png", 256),
        (WEB / "src/app/apple-icon.png", 180),
        (WEB / "public/ohaaaa-badge.png", 256),
    ]
    for path, size in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        master.resize((size, size), Image.LANCZOS).save(path, "PNG", optimize=True)
        print(f"  {path.relative_to(ROOT)}  {size}x{size}")

    # --- Onizleme gorseli ---------------------------------------------------
    # 1200x630 baglanti onizlemesi. Rozet kagit zemine ORANTISI KORUNARAK
    # yerlestirilir; canvasa germek burada da ovallestirirdi.
    og = Image.new("RGB", (1200, 630), PAPER)
    badge = 460
    og.paste(master.resize((badge, badge), Image.LANCZOS),
             ((1200 - badge) // 2, (630 - badge) // 2))
    og_path = WEB / "src/app/opengraph-image.png"
    og.save(og_path, "PNG", optimize=True)
    print(f"  {og_path.relative_to(ROOT)}  1200x630")

    print("\nBitti. Degisiklikleri commit edin.")


if __name__ == "__main__":
    main()
