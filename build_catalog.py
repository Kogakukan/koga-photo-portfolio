"""Build the portfolio: read EXIF, create thumbnails, publish photos untouched.

Usage: python build_catalog.py
Input : photos/<année>/<lieu>/<photo>.jpg
Output: dist/ (site ready for GitHub Pages)
"""
from __future__ import annotations

import base64
import hashlib
import html
import io
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import ExifTags, Image, ImageOps

ROOT = Path(__file__).parent
PHOTO_ROOT = ROOT / "photos"
WEB_ROOT = ROOT / "web"
DIST = ROOT / "dist"
CONFIG_PATH = ROOT / "config.json"

FULL_MAX = 5000            # Above this, the photo is downsized (rare). Below: copied as-is.
FULL_RESIZE_QUALITY = 85   # Only used when a photo must be downsized.
THUMB_SIZES = (640, 1280)  # Gallery thumbnails (long side), the browser picks the right one.
THUMB_QUALITY = 80
PLACEHOLDER_SIZE = 20      # Tiny blurred preview shown while the thumbnail loads.

# ---------------------------------------------------------------- formatting

SONY_BODIES = {
    "ILCE-7": "α7", "ILCE-7M2": "α7 II", "ILCE-7M3": "α7 III", "ILCE-7M4": "α7 IV",
    "ILCE-7RM2": "α7R II", "ILCE-7RM3": "α7R III", "ILCE-7RM4": "α7R IV", "ILCE-7RM5": "α7R V",
    "ILCE-7SM3": "α7S III", "ILCE-7C": "α7C", "ILCE-7CM2": "α7C II", "ILCE-7CR": "α7CR",
    "ILCE-1": "α1", "ILCE-9": "α9", "ILCE-6400": "α6400", "ILCE-6600": "α6600", "ILCE-6700": "α6700",
}
TAMRON_CODES = {
    "A036": "28-75mm F/2.8 Di III RXD", "A063": "28-75mm F/2.8 Di III VXD G2",
    "A046": "17-28mm F/2.8 Di III RXD", "A056": "70-180mm F/2.8 Di III VXD",
    "A058": "35-150mm F/2-2.8 Di III VXD", "A062": "20-40mm F/2.8 Di III VXD",
    "A071": "28-200mm F/2.8-5.6 Di III RXD",
}


def to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        try:
            return float(value[0]) / float(value[1])
        except Exception:
            return None


def fmt_focal(value: Any) -> str | None:
    n = to_float(value)
    if not n:
        return None
    return f"{n:.0f} mm" if float(n).is_integer() else f"{n:.1f} mm"


def fmt_aperture(value: Any) -> str | None:
    n = to_float(value)
    if not n:
        return None
    return f"f/{n:.1f}".replace(".0", "")


def fmt_shutter(value: Any) -> str | None:
    n = to_float(value)
    if not n:
        return None
    if n >= 1:
        return f"{n:g} s"
    return f"1/{round(1 / n)} s"


def pretty_camera(make: str, model: str) -> str | None:
    make, model = (make or "").strip(), (model or "").strip()
    if not model:
        return None
    if make.upper() == "SONY":
        return f"Sony {SONY_BODIES.get(model, model)}"
    brand = make.title()
    if brand and model.lower().startswith(brand.lower()):
        return model
    return f"{brand} {model}".strip()


def pretty_lens(lens: str | None, lens_make: str | None) -> str | None:
    lens, lens_make = (lens or "").strip(), (lens_make or "").strip()
    if not lens:
        return None
    code = re.search(r"\b([ABF]\d{3})\b", lens)
    if code and (not lens_make or lens_make.lower() == "tamron"):
        name = TAMRON_CODES.get(code.group(1))
        return f"Tamron {name}" if name else f"Tamron {lens}"
    if lens_make:
        return lens if lens.lower().startswith(lens_make.lower()) else f"{lens_make.title()} {lens}"
    if re.search(r"\b(DG|DC) DN\b", lens):
        return f"Sigma {lens}"
    if re.match(r"^(FE|E)\s", lens):
        return f"Sony {lens}"
    return lens


def parse_date(value: Any) -> str | None:
    if isinstance(value, bytes):
        value = value.decode("ascii", errors="ignore")
    if not isinstance(value, str):
        return None
    value = value.strip().strip("\x00")
    for pattern in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value[:19], pattern).date().isoformat()
        except ValueError:
            continue
    return None


def embedded_xmp_lens(path: Path) -> str | None:
    """Fallback: some exports only keep the lens inside the embedded XMP block."""
    text = path.read_bytes()[:400_000].decode("utf-8", errors="ignore")
    match = re.search(r"<(?:exifEX:LensModel|aux:Lens)[^>]*>([^<]+)</", text) or \
        re.search(r"(?:exifEX:LensModel|aux:Lens)\s*=\s*\"([^\"]+)\"", text)
    return match.group(1).strip() if match else None


# ---------------------------------------------------------------- reading

def read_photo(path: Path, relative: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        exif = image.getexif()
        data = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}
        try:  # Capture date, lens and exposure live in the nested EXIF block.
            data.update({ExifTags.TAGS.get(k, k): v for k, v in exif.get_ifd(ExifTags.IFD.Exif).items()})
        except Exception:
            pass
        upright = ImageOps.exif_transpose(image)
        width, height = upright.size

    parts = relative.parts
    folder_year = parts[0] if parts and re.fullmatch(r"(19|20)\d{2}", parts[0]) else None
    location = parts[1] if len(parts) >= 3 else None

    # Only the original capture date: never the file/modification/export date.
    date = parse_date(data.get("DateTimeOriginal")) or parse_date(data.get("DateTimeDigitized"))
    year = date[:4] if date else (folder_year or "Autres")

    lens_raw = str(data.get("LensModel") or "").strip() or embedded_xmp_lens(path)
    iso = data.get("ISOSpeedRatings") or data.get("PhotographicSensitivity")
    if isinstance(iso, (tuple, list)):
        iso = iso[0] if iso else None

    stable = hashlib.md5(relative.as_posix().encode("utf-8")).hexdigest()[:8]
    return {
        "id": f"{re.sub(r'[^a-z0-9]+', '-', path.stem.lower()).strip('-')}-{stable}",
        "year": year,
        "location": location,
        "date": date,
        "camera": pretty_camera(str(data.get("Make") or ""), str(data.get("Model") or "")),
        "lens": pretty_lens(lens_raw, str(data.get("LensMake") or "")),
        "focalLength": fmt_focal(data.get("FocalLength")),
        "aperture": fmt_aperture(data.get("FNumber")),
        "shutter": fmt_shutter(data.get("ExposureTime")),
        "iso": str(int(iso)) if isinstance(iso, (int, float)) and iso else None,
        "width": width,
        "height": height,
        "source": relative.as_posix(),
    }


# ---------------------------------------------------------------- writing

def publish_full(source: Path, destination: Path, width: int, height: int) -> None:
    """Copy the photo untouched (no recompression). Downsize only if huge."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    if max(width, height) <= FULL_MAX:
        shutil.copyfile(source, destination)
        return
    with Image.open(source) as image:
        exif = image.info.get("exif")
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((FULL_MAX, FULL_MAX), Image.Resampling.LANCZOS)
        kwargs = {"quality": FULL_RESIZE_QUALITY, "optimize": True, "progressive": True}
        if exif:
            kwargs["exif"] = exif
        image.save(destination, "JPEG", **kwargs)


def make_thumbs(source: Path, out_dir: Path, photo_id: str) -> tuple[dict[int, str], str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[int, str] = {}
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        for size in THUMB_SIZES:
            copy = image.copy()
            copy.thumbnail((size, size), Image.Resampling.LANCZOS)
            name = f"{photo_id}-{size}.jpg"
            copy.save(out_dir / name, "JPEG", quality=THUMB_QUALITY, optimize=True, progressive=True)
            paths[size] = f"assets/thumbs/{name}"
        tiny = image.copy()
        tiny.thumbnail((PLACEHOLDER_SIZE, PLACEHOLDER_SIZE), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        tiny.save(buffer, "JPEG", quality=50)
        placeholder = "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    return paths, placeholder


def inject_share_tags(index_path: Path, config: dict, cover: dict | None) -> None:
    site_url = (config.get("siteUrl") or "").rstrip("/") + "/"
    title = html.escape(config.get("siteTitle") or "Antoine Photographie — Portfolio")
    description = html.escape(config.get("description") or "")
    tags = [
        f'<meta name="description" content="{description}" />',
        f'<meta property="og:title" content="{title}" />',
        f'<meta property="og:description" content="{description}" />',
        '<meta property="og:type" content="website" />',
        f'<meta property="og:url" content="{html.escape(site_url)}" />',
        '<meta name="twitter:card" content="summary_large_image" />',
    ]
    if cover and config.get("siteUrl"):
        tags.append(f'<meta property="og:image" content="{html.escape(site_url + cover["thumb"])}" />')
    page = index_path.read_text(encoding="utf-8")
    index_path.write_text(page.replace("<!--SHARE_TAGS-->", "\n  ".join(tags)), encoding="utf-8")


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if CONFIG_PATH.exists() else {}
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(WEB_ROOT, DIST)

    files = sorted(p for p in PHOTO_ROOT.rglob("*") if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg"})
    photos = []
    for path in files:
        relative = path.relative_to(PHOTO_ROOT)
        photo = read_photo(path, relative)
        full_rel = f"assets/full/{photo['id']}.jpg"
        publish_full(path, DIST / full_rel, photo["width"], photo["height"])
        thumbs, placeholder = make_thumbs(path, DIST / "assets" / "thumbs", photo["id"])
        photo.update({
            "full": full_rel,
            "thumb": thumbs[max(THUMB_SIZES)],
            "thumbSmall": thumbs[min(THUMB_SIZES)],
            "placeholder": placeholder,
        })
        photos.append(photo)
        print(f"  ✓ {relative}  ({photo['date'] or 'sans date'} · {photo['lens'] or 'objectif inconnu'})")

    # Newest first.
    photos.sort(key=lambda p: (p["date"] or "0000", p["source"]), reverse=True)

    facets = {
        "years": sorted({p["year"] for p in photos}, reverse=True),
        "locations": sorted({p["location"] for p in photos if p["location"]}),
        "lenses": sorted({p["lens"] for p in photos if p["lens"]}),
    }
    catalog = {"generatedAt": datetime.now(timezone.utc).isoformat(), "photos": photos, "facets": facets}
    (DIST / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
    inject_share_tags(DIST / "index.html", config, photos[0] if photos else None)

    size_mb = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file()) / 1_000_000
    print(f"\n{len(photos)} photos · site publié : {size_mb:.0f} Mo / 1000 Mo")


if __name__ == "__main__":
    main()
