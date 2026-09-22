import os
import secrets
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import get_settings

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def upload_root() -> Path:
    root = Path(get_settings().upload_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def public_url(rel_path: str | None, version: int | None = None) -> str | None:
    if not rel_path:
        return None
    url = f"/api/uploads/{rel_path}"
    return f"{url}?v={version}" if version else url


async def save_image(file: UploadFile, project_slug: str, folder: str, name_hint: str) -> str:
    """Store an uploaded image, return path relative to the upload root."""
    ext = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "Допустимы только JPG, PNG, WEBP, GIF")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Файл больше 5 МБ")
    rel_dir = Path(project_slug) / folder
    (upload_root() / rel_dir).mkdir(parents=True, exist_ok=True)
    filename = f"{name_hint}-{secrets.token_hex(4)}{ext}"
    (upload_root() / rel_dir / filename).write_bytes(data)
    return str(rel_dir / filename).replace(os.sep, "/")


def save_bytes(data: bytes, project_slug: str, folder: str, filename: str) -> str:
    rel_dir = Path(project_slug) / folder
    (upload_root() / rel_dir).mkdir(parents=True, exist_ok=True)
    (upload_root() / rel_dir / filename).write_bytes(data)
    return str(rel_dir / filename).replace(os.sep, "/")


def delete_file(rel_path: str | None) -> None:
    if not rel_path:
        return
    try:
        (upload_root() / rel_path).unlink(missing_ok=True)
    except OSError:
        pass
