#!/usr/bin/env python3
"""
OHAAAA - tek master gorselden tum ikon setini uretir.

    python3 scripts/make-icons.py <master.png> [<disk.png> <yazi.png>]

NEDEN BU BETIK VAR
Rozet daha once elle olceklenirken 139x208'e ezilmisti: daire oval olmustu ve
bu, sitenin her sayfasindaki logoda goruluyordu. Elle yeniden boyutlandirmada
bu hata sessizdir - kimse 40x40 bir gorseli olcmez. Betik once en/boy oranini
OLCER ve bozuksa durur, sonra her cikti icin kareligi korur.

URETILENLER
    apps/web/src/app/icon.png            256x256   tarayici sekmesi (Next otomatik bulur)
    apps/web/src/app/apple-icon.png      180x180   iOS ana ekran
    apps/web/public/ohaaaa-disc.png      108x108   baslik: disk katmani
    apps/web/public/ohaaaa-word.png      108x108   baslik: yazi katmani
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

# globals.css ile ayni: --bg. Site koyu zemine gectiginde bu da gecti;
# aksi halde WhatsApp/X onizlemesi acik zeminli cikip siteyle celisirdi.
GROUND = (0x0B, 0x0B, 0x0D)

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "apps" / "web"


def badge_aspect(im: Image.Image) -> float:
    """Rozet siluetinin en/boy orani. 1.0 = daire.

    Olcum, ic turuncu diskten degil DIS SILUETTEN alinir. Ic disk yatayda
    beyaz yazi tarafindan kesilir; oradan olcmek kusursuz dairesel bir armayi
    0.93 gosterip reddedilmesine yol acabilir - kontrolun kendisi hata olur.
    Dis metal cembere yazi dokunmaz.
    """
    small = im.convert("RGB").resize((256, 256), Image.LANCZOS)
    px = small.load()
    # Zemin rengi koselerden okunur
    corners = [px[2, 2], px[253, 2], px[2, 253], px[253, 253]]
    br = sum(c[0] for c in corners) / 4
    bg_ = sum(c[1] for c in corners) / 4
    bb = sum(c[2] for c in corners) / 4

    xs, ys = [], []
    for y in range(256):
        for x in range(256):
            r, g, b = px[x, y]
            # Esik yuksek: yumusak golge silueti sisirmesin
            if abs(r - br) + abs(g - bg_) + abs(b - bb) > 120:
                xs.append(x)
                ys.append(y)
    if not xs:
        return 1.0
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    return w / h if h else 1.0


def square(im: Image.Image) -> Image.Image:
    """Kareye getir - GERMEDEN, saydam kenar ekleyerek. Germek diski ovallestirir."""
    if im.width == im.height:
        return im
    side = max(im.width, im.height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return canvas


def main() -> None:
    if len(sys.argv) not in (2, 4):
        sys.exit(__doc__)

    src = Path(sys.argv[1])
    if not src.exists():
        sys.exit(f"Bulunamadi: {src}")

    master = Image.open(src).convert("RGBA")
    print(f"master: {src.name}  {master.width}x{master.height}")

    if min(master.size) < 512:
        print(f"  UYARI: {min(master.size)} px kucuk. 1024x1024 onerilir;")
        print("         opengraph gorseli buyutuldugunde bulanik cikar.")

    aspect = badge_aspect(master)
    # Tolerans bilerek genis. Bu kontrol bir hassas olcum degil, kaba bozulma
    # alarmi: yumusak golge ve kenar yumusatmasi olcumu birkac puan oynatir,
    # ama gercek hata (139x208 = 0.67) bunun cok otesinde. Dar tolerans,
    # saglam bir armayi reddedip kontrolun kendisini hataya cevirirdi.
    if abs(aspect - 1.0) > 0.15:
        sys.exit(
            f"  DUR: rozet silueti en/boy {aspect:.3f} - oval, daire degil.\n"
            "       Master gorsel bozulmus. Kaynagi duzeltmeden ikon uretmek,\n"
            "       hatayi her boyuta kopyalar."
        )
    print(f"  siluet en/boy {aspect:.3f} - daire")

    master = square(master)

    outputs = [
        (WEB / "src/app/icon.png", 256),
        (WEB / "src/app/apple-icon.png", 180),
    ]
    for path, size in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        master.resize((size, size), Image.LANCZOS).save(path, "PNG", optimize=True)
        print(f"  {path.relative_to(ROOT)}  {size}x{size}")

    # --- Baslik katmanlari ---------------------------------------------------
    # Basliktaki arma iki parcadir: sabit disk + hareket eden yazi. Yazi ancak
    # ayri bir katman oldugunda kendi basina donup ziplayabilir.
    #
    # 108 piksel: baslikta 36 piksel gosteriliyor, 3x yogunluktaki ekranlar
    # icin bu yeter. 256 piksel indirmek bosuna bayt olurdu - disk katmani
    # 78 KB'den 16 KB'ye dustu.
    if len(sys.argv) == 4:
        for arg, name in ((sys.argv[2], "ohaaaa-disc.png"), (sys.argv[3], "ohaaaa-word.png")):
            layer_src = Path(arg)
            if not layer_src.exists():
                sys.exit(f"Bulunamadi: {layer_src}")
            dst = WEB / "public" / name
            (Image.open(layer_src).convert("RGBA")
                .resize((108, 108), Image.LANCZOS)
                .save(dst, "PNG", optimize=True))
            print(f"  {dst.relative_to(ROOT)}  108x108")

    # --- Onizleme gorseli ---------------------------------------------------
    # 1200x630 baglanti onizlemesi. Rozet kagit zemine ORANTISI KORUNARAK
    # yerlestirilir; canvasa germek burada da ovallestirirdi.
    og = Image.new("RGB", (1200, 630), GROUND)
    badge = 460
    small = master.resize((badge, badge), Image.LANCZOS)
    # Alfa maskesi ZORUNLU: maskesiz yapistirmak, rozetin kendi kare tuvalini
    # kagit zeminin uzerine gorunur bir dikdortgen olarak birakir.
    og.paste(small, ((1200 - badge) // 2, (630 - badge) // 2), small)
    og_path = WEB / "src/app/opengraph-image.png"
    og.save(og_path, "PNG", optimize=True)
    print(f"  {og_path.relative_to(ROOT)}  1200x630")

    print("\nBitti. Degisiklikleri commit edin.")


if __name__ == "__main__":
    main()
