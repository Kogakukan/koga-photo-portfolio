from __future__ import annotations

import json
import re
import shutil
from xml.etree import ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ExifTags

ROOT = Path(__file__).parent
PHOTO_ROOT = ROOT / "photos"
WEB_ROOT = ROOT / "web"
DIST = ROOT / "dist"
CONFIG_PATH = ROOT / "config.json"
FULL_MAX = 5000
THUMB_MAX = 1400
FULL_QUALITY = 80
THUMB_QUALITY = 78

TAGS = {value: key for key, value in ExifTags.TAGS.items()}
GPS_TAG = TAGS.get("GPSInfo")


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^\w\-\s.]", "", value, flags=re.UNICODE)
    return re.sub(r"[\s]+", "-", value)


def rational_to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        try:
            return float(value[0]) / float(value[1])
        except Exception:
            return None


def format_focal(value: Any) -> str | None:
    number = rational_to_float(value)
    if number is None:
        return None
    return f"{number:.0f} mm" if number.is_integer() else f"{number:.1f} mm"


def get_font(size: int):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def _decode_xmp_value(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\\", "")).strip()


def read_xmp_fields(path: Path) -> dict[str, str]:
    """Read common embedded or sidecar XMP fields without exposing GPS data."""
    # Read only metadata embedded in the JPEG itself. No sidecar file is required.
    try:
        raw = path.read_bytes()
    except OSError:
        raw = b""
    if not raw:
        return {}
    text = raw.decode("utf-8", errors="ignore")
    fields: dict[str, str] = {}
    patterns = {
        "lens": [
            r"(?:aux:Lens|exifEX:LensModel|exif:LensModel|LensModel)\s*=\s*[\"']([^\"']+)",
            r"<(?:aux:Lens|exifEX:LensModel|exif:LensModel)[^>]*>(.*?)</",
        ],
        "date": [
            r"(?:exif:DateTimeOriginal|photoshop:DateCreated|xmp:CreateDate|CreateDate)\s*=\s*[\"']([^\"']+)",
            r"<(?:exif:DateTimeOriginal|photoshop:DateCreated|xmp:CreateDate)[^>]*>(.*?)</",
        ],
        "camera": [
            r"(?:tiff:Model|Model)\s*=\s*[\"']([^\"']+)",
            r"<(?:tiff:Model|Model)[^>]*>(.*?)</",
        ],
    }
    for key, regexes in patterns.items():
        for pattern in regexes:
            match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
            if match:
                value = _decode_xmp_value(match.group(1))
                if value:
                    fields[key] = value
                    break
    return fields

def parse_date(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    for pattern in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(value, pattern).isoformat()
        except ValueError:
            pass
    return value if re.match(r"^20\d{2}[-:]", value) else None


def read_metadata(path: Path, relative: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        exif = image.getexif()
        data = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}
        # DateTimeOriginal and LensModel live in the nested EXIF IFD on many Sony/Lightroom JPEGs.
        try:
            nested = exif.get_ifd(ExifTags.IFD.Exif)
            data.update({ExifTags.TAGS.get(k, k): v for k, v in nested.items()})
        except Exception:
            pass
        width, height = image.size

    xmp = read_xmp_fields(path)
    # Never use generic DateTime: Lightroom/export software can update it.
    # Prefer the capture date, then the digitized date, then XMP capture fields.
    date_iso = parse_date(data.get("DateTimeOriginal")) or parse_date(data.get("DateTimeDigitized"))

    parts = relative.parts
    year_folder = parts[0] if parts else ""
    location = parts[1] if len(parts) >= 3 else "Unknown"
    # The folder is authoritative for the gallery year; this avoids export-date mistakes.
    year = year_folder if re.fullmatch(r"20\d{2}", year_folder) else (date_iso[:4] if date_iso else "Other")

    make = str(data.get("Make", "")).strip()
    model = str(data.get("Model", "")).strip() or xmp.get("camera", "")
    camera = " ".join(x for x in [make, model] if x).strip() or None
    lens = str(data.get("LensModel", "")).strip() or str(data.get("Lens", "")).strip() or xmp.get("lens") or None

    return {
        "year": year,
        "location": location,
        "session": "/".join(parts[1:-1]) if len(parts) > 2 else location,
        "date": date_iso,
        "camera": camera,
        "lens": lens,
        "width": width,
        "height": height,
        "orientation": "landscape" if width / max(height, 1) > 1.12 else ("portrait" if height / max(width, 1) > 1.12 else "square"),
        "filename": path.name,
        "sourcePath": relative.as_posix(),
    }

def watermark(image: Image.Image, text: str) -> Image.Image:
    image = image.convert("RGB")
    if not text:
        return image
    draw = ImageDraw.Draw(image, "RGBA")
    font_size = max(18, image.width // 190)
    font = get_font(font_size)
    margin = max(24, image.width // 70)
    bbox = draw.textbbox((0, 0), text, font=font)
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    x = image.width - width - margin
    y = image.height - height - margin
    pad_x = max(10, font_size // 2)
    pad_y = max(7, font_size // 4)
    draw.rounded_rectangle(
        (x - pad_x, y - pad_y, x + width + pad_x, y + height + pad_y),
        radius=max(6, font_size // 4),
        fill=(255, 255, 255, 185),
    )
    draw.text((x, y), text, fill=(20, 20, 20, 220), font=font)
    return image


def save_variant(source: Path, destination: Path, max_size: int, quality: int, mark: str):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = image.convert("RGB")
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        image = watermark(image, mark)
        image.save(destination, "JPEG", quality=quality, optimize=True, progressive=True)


def main():
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    shutil.copytree(WEB_ROOT, DIST, dirs_exist_ok=True)

    (DIST / "assets" / "thumbs").mkdir(parents=True, exist_ok=True)
    (DIST / "assets" / "full").mkdir(parents=True, exist_ok=True)

    photos = []
    files = sorted(
        p for p in PHOTO_ROOT.rglob("*")
        if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg"}
    )

    for index, path in enumerate(files):
        relative = path.relative_to(PHOTO_ROOT)
        meta = read_metadata(path, relative)
        photo_id = f"{index:04d}-{slugify(path.stem)}"
        thumb_rel = f"assets/thumbs/{photo_id}.jpg"
        full_rel = f"assets/full/{photo_id}.jpg"
        save_variant(path, DIST / thumb_rel, THUMB_MAX, THUMB_QUALITY, config["watermark"])
        save_variant(path, DIST / full_rel, FULL_MAX, FULL_QUALITY, config["watermark"])
        meta.update({"id": photo_id, "thumb": thumb_rel, "full": full_rel})
        photos.append(meta)

    def unique_values(key):
        return sorted({p[key] for p in photos if p.get(key)}, reverse=(key == "year"))

    catalog = {
        "config": config,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "photos": photos,
        "facets": {
            "years": unique_values("year"),
            "locations": sorted({p["location"] for p in photos if p.get("location")}),
            "lenses": sorted({p["lens"] for p in photos if p.get("lens")}),
        },
    }
    (DIST / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Built {len(photos)} photos into {DIST}")


if __name__ == "__main__":
    main()
