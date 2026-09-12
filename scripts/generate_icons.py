#!/usr/bin/env python3
"""Regenerate all CodeDock icons from the canonical vector source.

Source of truth: ``src-tauri/icons/icon.svg`` (copy of the repo-root
``ic_launcher.svg``: blue gradient rounded square + white terminal glyph).

What this script (re)generates, and with what tool:

- ``src-tauri/icons/app-icon.png`` (1024 master, also shown in the README):
  rasterised from the SVG with macOS ``sips``.
- ``icon.png`` (512), ``128x128@2x.png`` (256), ``128x128.png``,
  ``32x32.png``: Lanczos downscales of the master with Pillow. These four
  plus the two files below are exactly the set ``tauri.conf.json``
  ``bundle.icon`` lists (see Tauri v2 docs, "App Icons").
- ``icon.icns`` / ``icon.ico``: built by the official ``tauri icon`` command
  (correct layer sets: icns layers per Tauri repo spec, ico with
  16/24/32/48/64/256px layers and 32px first for dev). The script shells out
  to it and copies back only those two files; the iOS/Android/Store extras
  ``tauri icon`` also emits are discarded (desktop-only app).
- ``tray.png`` (32x32 monochrome template icon for the macOS menu bar):
  the full-colour icon cannot be used directly because
  ``icon_as_template(true)`` keeps only the alpha channel (it would render
  as a solid rounded square). Instead the white glyph strokes are extracted
  by min-channel keying (glyph is pure white, ``min(r,g,b) = 255``; the blue
  gradient background stays below 64), slightly thickened with MaxFilter for
  small-size legibility, cropped to the glyph bbox and centred on a 32x32
  canvas. Consumed in ``src-tauri/src/lib.rs`` via
  ``include_bytes!("../icons/tray.png")``.
- ``public/icon.svg``, ``public/favicon-32x32.png``,
  ``public/apple-touch-icon.png`` (180): web icons referenced from
  ``index.html`` (Vite copies ``public/`` into ``dist/``).

Requires: macOS ``sips``, Pillow, and ``npx`` (for ``@tauri-apps/cli``).

Usage:
    python3 scripts/generate_icons.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICONS = os.path.join(ROOT, "src-tauri", "icons")
PUBLIC = os.path.join(ROOT, "public")
SRC_SVG = os.path.join(ICONS, "icon.svg")

try:
    from PIL import Image, ImageFilter
    import PIL.ImageChops as ImageChops
except ImportError:
    sys.exit("error: Pillow is required (pip install Pillow)")

# Background blues stay dark in min(r,g,b); the white glyph is 255.
TRAY_MASK_FLOOR = 64
TRAY_CANVAS = 32
TRAY_GLYPH = 28  # glyph box inside the canvas


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main() -> None:
    if not os.path.isfile(SRC_SVG):
        sys.exit(f"error: missing source {SRC_SVG}")
    if shutil.which("sips") is None:
        sys.exit("error: macOS `sips` is required to rasterise the SVG")
    os.makedirs(ICONS, exist_ok=True)
    os.makedirs(PUBLIC, exist_ok=True)

    # 1. Master 1024x1024 from the SVG (README + downscale source).
    master_path = os.path.join(ICONS, "app-icon.png")
    run(["sips", "-s", "format", "png", "-z", "1024", "1024",
         SRC_SVG, "--out", master_path])
    master = Image.open(master_path).convert("RGBA")

    # 2. Bundle PNGs (tauri.conf.json `bundle.icon` set).
    for name, size in (("icon.png", 512), ("128x128@2x.png", 256),
                       ("128x128.png", 128), ("32x32.png", 32)):
        out = os.path.join(ICONS, name)
        master.resize((size, size), Image.Resampling.LANCZOS).save(out)
        print(f"wrote {name} ({size}x{size})")

    # 3. icon.icns / icon.ico via the official Tauri CLI (correct layers).
    with tempfile.TemporaryDirectory(prefix="codedock-icons-") as tmp:
        run(["npx", "--yes", "@tauri-apps/cli@2.11.4", "icon",
             SRC_SVG, "-o", tmp])
        for name in ("icon.icns", "icon.ico"):
            shutil.copy(os.path.join(tmp, name), os.path.join(ICONS, name))
            print(f"wrote {name}")

    # 4. Monochrome menu-bar template icon from the white glyph strokes.
    glyph_src = master.resize((512, 512), Image.Resampling.LANCZOS)
    r, g, b, a = glyph_src.split()
    min_channel = ImageChops.darker(ImageChops.darker(r, g), b)
    lut = [0 if i <= TRAY_MASK_FLOOR
           else round((i - TRAY_MASK_FLOOR) * 255 / (255 - TRAY_MASK_FLOOR))
           for i in range(256)]
    mask = ImageChops.multiply(min_channel.point(lut), a)
    mask = mask.filter(ImageFilter.MaxFilter(5))
    box = mask.getbbox()
    if box is None:
        sys.exit("error: no glyph found in rendered icon")
    pad = 28
    left = max(0, box[0] - pad)
    top = max(0, box[1] - pad)
    right = min(512, box[2] + pad)
    bottom = min(512, box[3] + pad)
    side = max(right - left, bottom - top)
    cx, cy = (left + right) // 2, (top + bottom) // 2
    square = (max(0, cx - side // 2), max(0, cy - side // 2),
              min(512, cx - side // 2 + side),
              min(512, cy - side // 2 + side))
    white = Image.new("RGBA", glyph_src.size, (255, 255, 255, 255))
    white.putalpha(mask)
    glyph = white.crop(square).resize((TRAY_GLYPH, TRAY_GLYPH),
                                      Image.Resampling.LANCZOS)
    tray = Image.new("RGBA", (TRAY_CANVAS, TRAY_CANVAS), (0, 0, 0, 0))
    off = (TRAY_CANVAS - TRAY_GLYPH) // 2
    tray.alpha_composite(glyph, (off, off))
    tray.save(os.path.join(ICONS, "tray.png"))
    print(f"wrote tray.png ({TRAY_CANVAS}x{TRAY_CANVAS})")

    # 5. Web icons (Vite serves public/ at dist root).
    shutil.copy(SRC_SVG, os.path.join(PUBLIC, "icon.svg"))
    for name, size in (("favicon-32x32.png", 32),
                       ("apple-touch-icon.png", 180)):
        run(["sips", "-s", "format", "png", "-z", str(size), str(size),
             SRC_SVG, "--out", os.path.join(PUBLIC, name)])


if __name__ == "__main__":
    main()
