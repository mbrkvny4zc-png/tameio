"""Turn the generated photo files into the web-ready images the landing page uses.

Put the downloaded originals in frontend/photos-src/:
  hero.png    — the single bakery photo (16:9)
  sheet-a.png — 2x2 grid: kafeneio | carpenter / accountant | florist
  sheet-b.png — 2x2 grid: taverna | mechanic / phone-receipt | grocery
then run:  python3 scripts/prepare_photos.py
Output goes to frontend/public/photos/*.jpg (progressive JPEG, max 2000px wide).
Any other image named like a target (e.g. photos-src/taverna.jpg) is used as-is, so you can swap in real photos later.
"""
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "photos-src", ROOT / "public" / "photos"
SHEETS = {"sheet-a": ["kafeneio", "carpenter", "accountant", "florist"],
          "sheet-b": ["taverna", "mechanic", "phone-receipt", "grocery"]}


def trim_border(im: Image.Image) -> Image.Image:
    """Remove the thin white frame a grid cell may carry."""
    bg = Image.new(im.mode, im.size, (255, 255, 255))
    box = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > 18 else 0).getbbox()
    return im.crop(box) if box else im


def save(im: Image.Image, name: str):
    im = im.convert("RGB")
    if im.width > 2000:
        im = im.resize((2000, round(im.height * 2000 / im.width)), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    im.save(OUT / f"{name}.jpg", "JPEG", quality=84, optimize=True, progressive=True)
    print(f"  {name}.jpg  {im.width}x{im.height}")


def find(stem: str):
    return next((p for ext in (".png", ".jpg", ".jpeg", ".webp") if (p := SRC / f"{stem}{ext}").exists()), None)


def main():
    if (p := find("hero")):
        save(Image.open(p), "hero")
    for sheet, names in SHEETS.items():
        p = find(sheet)
        if not p:
            continue
        im = Image.open(p).convert("RGB")
        w, h = im.size
        cells = [(0, 0, w // 2, h // 2), (w // 2, 0, w, h // 2), (0, h // 2, w // 2, h), (w // 2, h // 2, w, h)]
        for name, box in zip(names, cells):
            if not find(name):  # a real photo with this name wins over the sheet crop
                save(trim_border(im.crop(box)), name)
    for names in SHEETS.values():
        for name in names:
            if (p := find(name)):
                save(Image.open(p), name)


if __name__ == "__main__":
    main()
