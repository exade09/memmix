from __future__ import annotations

import hashlib
from io import BytesIO

from axiom_scanner.security.query import QueryError


MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MIN_SIDE = 128
MAX_SIDE = 4096
MAX_PIXELS = MAX_SIDE * MAX_SIDE
LAUNCH_SIDE = 1024
ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp"}


class ImageError(QueryError):
    pass


def sniff_image_mime(data: bytes) -> str:
    if not data:
        raise ImageError("Image is empty.", "INVALID_IMAGE")
    head = data[:256]
    stripped = head.lstrip().lower()
    if stripped.startswith(b"<svg") or stripped.startswith(b"<?xml") or b"<svg" in stripped:
        raise ImageError("SVG images are not accepted.", "UNSUPPORTED_IMAGE")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise ImageError("Only PNG, JPEG, or WebP images are accepted.", "UNSUPPORTED_IMAGE")


def normalize_reference_image(data: bytes, field_name: str, *, claimed_type: str = "") -> tuple[bytes, str, int, int]:
    del claimed_type
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageError(f"{field_name} is too large.", "IMAGE_TOO_LARGE")
    mime = sniff_image_mime(data)
    if mime not in ALLOWED_MIME:
        raise ImageError(f"{field_name} must be PNG, JPEG, or WebP.", "UNSUPPORTED_IMAGE")
    try:
        from PIL import Image, ImageFile, ImageOps, UnidentifiedImageError
    except ImportError as exc:
        raise ImageError("Pillow is required to inspect images.", "MISSING_PILLOW") from exc

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    try:
        with Image.open(BytesIO(data)) as opened:
            width, height = opened.size
            if width < MIN_SIDE or height < MIN_SIDE:
                raise ImageError(f"{field_name} is too small. Use at least 128×128.", "INVALID_IMAGE")
            if width > MAX_SIDE or height > MAX_SIDE:
                raise ImageError(f"{field_name} is too large. Maximum is 4096×4096.", "INVALID_IMAGE")
            if width * height > MAX_PIXELS:
                raise ImageError(f"{field_name} has too many pixels.", "INVALID_IMAGE")
            raster = ImageOps.exif_transpose(opened)
            raster.load()
            if raster.mode in {"RGBA", "LA"} or (raster.mode == "P" and "transparency" in raster.info):
                rgba = raster.convert("RGBA")
                background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                background.alpha_composite(rgba)
                raster = background.convert("RGB")
            else:
                raster = raster.convert("RGB")
            output = BytesIO()
            raster.save(output, format="PNG", optimize=True)
            return output.getvalue(), "image/png", raster.size[0], raster.size[1]
    except ImageError:
        raise
    except Image.DecompressionBombError as exc:
        raise ImageError(f"{field_name} looks like a decompression bomb.", "INVALID_IMAGE") from exc
    except UnidentifiedImageError as exc:
        raise ImageError(f"{field_name} is not a readable raster image.", "INVALID_IMAGE") from exc
    except OSError as exc:
        raise ImageError(f"{field_name} could not be decoded.", "INVALID_IMAGE") from exc


def encode_launch_avatar(data: bytes, field_name: str = "avatar") -> tuple[bytes, str]:
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageError(f"{field_name} is too large.", "IMAGE_TOO_LARGE")
    mime = sniff_image_mime(data)
    if mime not in ALLOWED_MIME:
        raise ImageError(f"{field_name} must be PNG, JPEG, or WebP.", "UNSUPPORTED_IMAGE")
    try:
        from PIL import Image, ImageFile, ImageOps, UnidentifiedImageError
    except ImportError as exc:
        raise ImageError("Pillow is required to inspect images.", "MISSING_PILLOW") from exc

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    try:
        resample = Image.Resampling.LANCZOS
    except AttributeError:
        resample = Image.LANCZOS
    try:
        with Image.open(BytesIO(data)) as opened:
            width, height = opened.size
            if width < MIN_SIDE or height < MIN_SIDE:
                raise ImageError(f"{field_name} is too small. Use at least 128×128.", "INVALID_IMAGE")
            if width > MAX_SIDE or height > MAX_SIDE:
                raise ImageError(f"{field_name} is too large. Maximum is 4096×4096.", "INVALID_IMAGE")
            if width * height > MAX_PIXELS:
                raise ImageError(f"{field_name} has too many pixels.", "INVALID_IMAGE")
            raster = ImageOps.exif_transpose(opened)
            raster.load()
            if raster.mode in {"RGBA", "LA"} or (raster.mode == "P" and "transparency" in raster.info):
                rgba = raster.convert("RGBA")
                background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                background.alpha_composite(rgba)
                raster = background.convert("RGB")
            else:
                raster = raster.convert("RGB")
            fitted = ImageOps.fit(raster, (LAUNCH_SIDE, LAUNCH_SIDE), method=resample, centering=(0.5, 0.5))
            output = BytesIO()
            fitted.save(output, format="PNG", optimize=True)
            png = output.getvalue()
            return png, hashlib.sha256(png).hexdigest()
    except ImageError:
        raise
    except Image.DecompressionBombError as exc:
        raise ImageError(f"{field_name} looks like a decompression bomb.", "INVALID_IMAGE") from exc
    except UnidentifiedImageError as exc:
        raise ImageError(f"{field_name} is not a readable raster image.", "INVALID_IMAGE") from exc
    except OSError as exc:
        raise ImageError(f"{field_name} could not be decoded.", "INVALID_IMAGE") from exc
