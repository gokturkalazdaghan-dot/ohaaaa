#!/usr/bin/env python3
"""
OHAAAA - rozet armasini sifirdan cizer.

    python3 scripts/make-badge.py [cikti.png]

NEDEN CIZILIYOR, DUZENLENMIYOR
Elde bir referans render vardi ama uzerine harf eklemek mumkun degildi:
yazi ic diski 13 piksel (%3) bosluk birakacak kadar dolduruyordu, dorduncu
'a' metal cembere tasardi. Yer acmak icin kelimeyi kucultmek gerekiyordu, o
da eski yazinin altindaki zeminin yeniden boyanmasini gerektiriyordu; disk
temiz bir radyal gradyan olmadigi icin (p95 artik 76/255) tam ortada gorunur
bir yama kalirdi.

Cizmek bu sorunlarin hepsini ortadan kaldirir: harf sayisi, oran ve boyut
parametredir. "Ohaaaa" dort a ile YAZILIR, sonradan eklenmez.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 1024                      # kare tuval
CX = CY = S / 2
FONT = Path('/mnt/skills/examples/canvas-design/canvas-fonts/Outfit-Bold.ttf')

# Marka adinin TEK dogruluk kaynagi. Elle 'Ohaaa' ya da 'Ohaaaaa' yazilamaz;
# harf sayisi burada uretilir. Elle duzenlemede bu hata iki kez yapildi.
BRAND = 'O' + 'h' + 'a' * 4        # Ohaaaa
WORD = BRAND

# --- yaricaplar (S=1024 icin) ---
R_SHADOW = 496
R_RIM_OUT = 486               # firca izli gumus cember disi
R_RIM_IN = 438                # gumus cember ici
R_SEG_OUT = 430               # renkli segment halkasi disi
R_SEG_IN = 372                # segment halkasi ici
R_DISC = 366                  # turuncu ic disk

DISC_HI = (233, 105, 42)      # disk merkezi
DISC_LO = (188, 62, 16)       # disk kenari

SEGMENTS = [                  # halkadaki renk dizisi (saat yonunde)
    (198, 74, 26), (214, 96, 30), (232, 132, 40), (243, 170, 74),
    (248, 202, 130), (247, 226, 186), (243, 238, 220), (236, 226, 202),
    (240, 210, 160), (238, 176, 100), (226, 130, 52), (208, 92, 32),
]


def radial(shape, cx, cy):
    """Her piksel icin merkeze uzaklik."""
    y, x = np.mgrid[0:shape[0], 0:shape[1]]
    return np.hypot(x - cx, y - cy)


def smooth_disc(rad, r, softness=1.4):
    """Kenari yumusatilmis disk maskesi (0..1). Sert kenar merdiven yapar."""
    return np.clip((r - rad) / softness + 0.5, 0.0, 1.0)


def build_shadow():
    """Rozetin altina dusen yumusak golge - RENK ve ALFA olarak ayri ayri.

    Rozet SAYDAM zeminle uretilir. Zemini gomulu birakmak, armanin her
    kullanildigi yerde (baslik, onizleme gorseli, favicon) arkasinda kendi
    renginde bir kare birakir; kagit zeminli sayfada bu kare gorunur.
    """
    sh = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(sh)
    d.ellipse([CX - R_SHADOW, CY - R_SHADOW + 14, CX + R_SHADOW, CY + R_SHADOW + 22], fill=255)
    sh = sh.filter(ImageFilter.GaussianBlur(22))
    return np.asarray(sh).astype(float) / 255.0 * 0.34


def build_rim(rad):
    """Firca izli gumus cember.

    Doku bilerek YUMUSAK tutulur. Ince, sik cizgiler 1024 pikselde guzel
    gorunur ama favicon 32 piksele indiginde moire ve kirli gri bir bulamaca
    donusur - ikon oradaki okunurlugunu kaybeder.
    """
    y, x = np.mgrid[0:S, 0:S]
    ang = np.arctan2(y - CY, x - CX)

    # Ust-soldan gelen ana isik
    light = 0.5 + 0.5 * np.cos(ang + np.pi * 0.75)
    base = 126 + 96 * light

    # Seyrek firca izi
    brush = 5 * np.sin(ang * 64) + 3 * np.sin(ang * 27 + 1.3)

    # Kademeli pah: cemberi tek duz halka degil, isik alan bir profil yapar.
    # t = 0 dis kenar, 1 ic kenar
    t = np.clip((R_RIM_OUT - rad) / (R_RIM_OUT - R_RIM_IN), 0, 1)
    profile = (
        1.34 * np.exp(-((t - 0.10) ** 2) / 0.006)    # dis parlak kenar
        - 0.42 * np.exp(-((t - 0.30) ** 2) / 0.004)  # oluk
        + 0.16 * np.exp(-((t - 0.62) ** 2) / 0.030)  # govde
        + 0.90 * np.exp(-((t - 0.90) ** 2) / 0.005)  # ic parlak kenar
    )
    metal = np.clip(base * (0.72 + 0.34 * profile) + brush, 34, 253)

    # Dis ve ic sinirda koyu cizgi
    edge = np.minimum(np.clip((R_RIM_OUT - rad) / 4.0, 0, 1),
                      np.clip((rad - R_RIM_IN) / 4.0, 0, 1))
    metal = metal * (0.42 + 0.58 * edge)

    return np.dstack([metal, metal, metal * 0.99])


def build_segments(rad):
    """Renkli segment halkasi."""
    y, x = np.mgrid[0:S, 0:S]
    ang = (np.arctan2(y - CY, x - CX) + np.pi) / (2 * np.pi)   # 0..1
    idx = (ang * len(SEGMENTS)).astype(int) % len(SEGMENTS)
    pal = np.array(SEGMENTS, dtype=float)
    ring = pal[idx]

    # Segmentler arasi ince koyu ayrac
    frac = (ang * len(SEGMENTS)) % 1.0
    seam = np.clip(np.minimum(frac, 1 - frac) / 0.012, 0, 1)[..., None]
    return ring * (0.55 + 0.45 * seam)


def build_disc(rad):
    """Turuncu ic disk: radyal gradyan + ince tane.

    Isik kaynagi cemberdekiyle ayni yerde (ust-sol) olmali; gradyani tam
    merkeze koymak diski duz bir daire gibi gosterir.
    """
    off = radial((S, S), CX - R_DISC * 0.20, CY - R_DISC * 0.22)
    t = np.clip(off / (R_DISC * 1.30), 0, 1)[..., None]
    hi = np.array(DISC_HI, dtype=float)
    lo = np.array(DISC_LO, dtype=float)
    disc = hi + (lo - hi) * (t ** 1.35)

    rng = np.random.default_rng(7)
    grain = rng.normal(0, 4.0, (S, S, 1))
    return disc + grain


def render_word(size_px, angle_deg):
    """Kelimeyi 3B kabartma hissiyle ciz; (RGBA gorsel) dondurur."""
    font = ImageFont.truetype(str(FONT), size_px)

    pad = size_px
    tmp = Image.new('L', (int(size_px * len(WORD) * 1.1) + pad * 2, size_px * 3), 0)
    d = ImageDraw.Draw(tmp)
    d.text((pad, pad), WORD, font=font, fill=255)
    bbox = tmp.getbbox()
    glyphs = tmp.crop(bbox)

    w, h = glyphs.size
    depth = max(3, size_px // 22)          # kabartma derinligi
    m = depth * 4
    layer = Image.new('RGBA', (w + m * 2, h + m * 2), (0, 0, 0, 0))

    # 1) Zemine dusen yumusak golge (isik ust-soldan)
    sh = Image.new('L', layer.size, 0)
    sh.paste(glyphs, (m + depth, m + depth + depth // 2))
    sh = sh.filter(ImageFilter.GaussianBlur(depth * 1.6))
    layer.paste(Image.new('RGBA', layer.size, (92, 34, 8, 255)),
                (0, 0), Image.eval(sh, lambda v: int(v * 0.62)))

    # 2) Yan yuz: harfin sag-alta dogru kaydirilmis kopyalari
    for i in range(depth, 0, -1):
        k = i / depth
        side = Image.new('RGBA', layer.size, (int(196 - 70 * k), int(150 - 60 * k), int(128 - 55 * k), 255))
        mask = Image.new('L', layer.size, 0)
        mask.paste(glyphs, (m + i, m + i))
        layer.paste(side, (0, 0), mask)

    # 3) Ust yuz
    top = Image.new('L', layer.size, 0)
    top.paste(glyphs, (m, m))
    layer.paste(Image.new('RGBA', layer.size, (255, 253, 250, 255)), (0, 0), top)

    # 4) Ust-sol kenarda ince parlak pah
    bevel = Image.new('L', layer.size, 0)
    bevel.paste(glyphs, (m - 1, m - 1))
    bevel = Image.fromarray(
        np.clip(np.asarray(bevel).astype(int) - np.asarray(top).astype(int), 0, 255).astype(np.uint8))
    layer.paste(Image.new('RGBA', layer.size, (255, 255, 255, 255)), (0, 0),
                Image.eval(bevel, lambda v: int(v * 0.9)))

    rotated = layer.rotate(angle_deg, resample=Image.BICUBIC, expand=True)
    # Dondurme sonrasi tuval kutusunun merkezi ile MUREKKEBIN merkezi ayrisir;
    # kutuya gore ortalamak yaziyi diskin icinde kaydirir. Alfa sinirina kirp.
    box = rotated.getbbox()
    return rotated.crop(box) if box else rotated


def verify_letters(badge, angle_deg=17):
    """Cizilen goruntuyu OKUYARAK harfleri sayar.

    Dosyanin basindaki assert kaynak dizgeyi dogrular; bu ise CIKTIYI
    dogrular. Yazi tipi bir harfi eksik cizse, olcek bir harfi diskin
    disinda biraksa ya da parametreler kayip harfleri birlestirse assert
    bunu yakalamaz - burasi yakalar.

    Yazi egik oldugu icin once duzeltilir: egik metinde sutun izdusumu
    komsu harfleri birlestirir ve yanlis sayar.
    """
    a = np.asarray(badge.convert('RGB')).astype(int)
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    rad = radial((S, S), CX, CY)
    white = (rad < R_DISC) & (R > 235) & (G > 230) & (B > 220)

    flat = Image.fromarray((white * 255).astype(np.uint8)).rotate(
        -angle_deg, resample=Image.BICUBIC, expand=True, center=(CX, CY))
    col = (np.asarray(flat) > 100).sum(axis=0)

    runs, start = [], None
    for x, v in enumerate(col):
        if v > 1 and start is None:
            start = x
        elif v <= 1 and start is not None:
            if x - start > 8:
                runs.append(x - start)
            start = None
    if start is not None and len(col) - start > 8:
        runs.append(len(col) - start)

    if len(runs) != len(BRAND):
        raise SystemExit(
            f'  DUR: goruntude {len(runs)} harf blogu var, {len(BRAND)} olmali.\n'
            f'       Blok genislikleri: {runs}\n'
            '       Harfler birlesmis ya da bir harf eksik cizilmis olabilir.')

    # Son dort blok 'a' - genislikleri birbirine yakin olmali
    widths = runs[2:]
    if len(widths) != BRAND.count('a'):
        raise SystemExit(f'  DUR: {len(widths)} adet a blogu, {BRAND.count("a")} olmali.')
    if max(widths) - min(widths) > max(widths) * 0.12:
        raise SystemExit(f'  DUR: a harfleri esit genislikte degil: {widths}')

    print(f'  harf blogu: {len(runs)} = {", ".join(BRAND)}  |  a genislikleri {widths}')


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('ohaaaa-master.png')
    if not FONT.exists():
        sys.exit(f'Yazi tipi yok: {FONT}')

    rad = radial((S, S), CX, CY)

    shadow_a = build_shadow()
    img = np.zeros((S, S, 3), dtype=float) + np.array([58.0, 52.0, 46.0])  # golge rengi

    for layer, r in ((build_rim(rad), R_RIM_OUT),
                     (build_segments(rad), R_SEG_OUT),
                     (build_disc(rad), R_DISC)):
        m = smooth_disc(rad, r)[..., None]
        img = layer * m + img * (1 - m)

    body_a = smooth_disc(rad, R_RIM_OUT)
    alpha = np.clip(body_a + shadow_a * (1 - body_a), 0, 1)

    badge = Image.fromarray(
        np.dstack([np.clip(img, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA')

    # --- Yazi: ic diske SIGACAK sekilde olceklenir -------------------------
    # Referansta kelime diski %97 doldurup dorduncu harfe yer birakmamisti.
    # Burada hedef genislik acikca sinirlanir.
    target_w = 2 * R_DISC * 0.90
    size_px = 300
    word = render_word(size_px, 17)
    scale = target_w / word.width
    word = word.resize((max(1, int(word.width * scale)), max(1, int(word.height * scale))),
                       Image.LANCZOS)

    badge.paste(word, (int(CX - word.width / 2), int(CY - word.height / 2)), word)
    badge.save(out, 'PNG')

    verify_letters(badge)

    # Kontrol: yazi ic diskin icinde mi?
    a = np.asarray(badge.convert('RGB')).astype(int)
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    inside = rad < R_DISC * 0.99
    white = inside & (R > 200) & (G > 190) & (B > 175)
    ys, xs = np.nonzero(white)
    dmax = np.hypot(xs - CX, ys - CY).max()
    print(f'{out}  {S}x{S}')
    print(f'  yazinin en dis noktasi {dmax:.0f} / disk {R_DISC}  -> bosluk {R_DISC - dmax:.0f} px')


if __name__ == '__main__':
    main()
