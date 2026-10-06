"""Media library: upload, organise, replace and serve files used by the bot."""

from __future__ import annotations

import hashlib
import io
import mimetypes
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.api.deps import DB, Auth, Paging, Perm, page_response, paginate
from app.api.serializers import media_out
from app.core.cache import content_cache
from app.core.config import settings
from app.core.database import on_commit
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.utils import utcnow
from app.models import Banner, Category, Media, Page, Product
from app.services.audit import audit

router = APIRouter(prefix="/media", tags=["media"])

ALLOWED = {
    "image/jpeg": "image", "image/png": "image", "image/webp": "image", "image/gif": "animation",
    "video/mp4": "video", "video/webm": "video", "video/quicktime": "video",
    "application/x-tgsticker": "sticker", "application/pdf": "document", "application/zip": "document",
    "text/plain": "document", "text/csv": "document",
}
MAGIC = [(b"\xff\xd8\xff", "image/jpeg"), (b"\x89PNG", "image/png"), (b"GIF8", "image/gif"), (b"%PDF", "application/pdf"),
         (b"PK\x03\x04", "application/zip")]


def _sniff(data: bytes, declared: str | None, filename: str) -> str:
    for sig, mime in MAGIC:
        if data.startswith(sig):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp":
        return "video/mp4" if not filename.lower().endswith(".mov") else "video/quicktime"
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "video/webm"
    if filename.lower().endswith(".tgs"):
        return "application/x-tgsticker"
    guess = declared or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    if guess in ("text/plain", "text/csv"):
        return guess
    return guess


def _inspect(data: bytes, mime: str) -> tuple[int | None, int | None]:
    if not mime.startswith("image/"):
        return None, None
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            return im.width, im.height
    except Exception:
        return None, None


async def _read_upload(file: UploadFile) -> tuple[bytes, str, str]:
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise ValidationFailed(f"File is larger than {settings.max_upload_mb} MB")
    if not data:
        raise ValidationFailed("Empty file")
    name = Path(file.filename or "file").name[:200]
    mime = _sniff(data, file.content_type, name)
    if mime not in ALLOWED:
        raise ValidationFailed(f"Unsupported file type ({mime}). Allowed: JPG, PNG, WebP, GIF, MP4, WebM, TGS, PDF, ZIP, TXT")
    if mime.startswith("image/") and mime != "image/gif":
        w, h = _inspect(data, mime)
        if w is None:
            raise ValidationFailed("The image could not be read — the file may be corrupted")
    return data, mime, name


def _store(data: bytes, name: str) -> str:
    ext = Path(name).suffix.lower()[:8]
    key = f"{utcnow():%Y/%m}/{uuid.uuid4().hex}{ext}"
    path = Path(settings.media_root) / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return key


@router.get("")
async def list_media(session: DB, auth: Perm("media.manage"), paging: Paging, q: str | None = None,
                     folder: str | None = None, kind: str | None = None) -> dict[str, Any]:
    query = select(Media).where(Media.deleted_at.is_(None)).order_by(Media.created_at.desc())
    if q:
        query = query.where(or_(Media.title.ilike(f"%{q}%"), Media.original_name.ilike(f"%{q}%")))
    if folder is not None and folder != "*":
        query = query.where(Media.folder == folder)
    if kind:
        query = query.where(Media.kind.in_(kind.split(",")))
    items, total = await paginate(session, query, paging)
    resp = page_response([media_out(m) for m in items], total, paging)
    folders = (await session.execute(select(Media.folder, func.count()).where(Media.deleted_at.is_(None))
                                     .group_by(Media.folder).order_by(Media.folder))).all()
    resp["folders"] = [{"name": f or "", "count": c} for f, c in folders]
    resp["total_size"] = (await session.execute(select(func.coalesce(func.sum(Media.size), 0))
                                                .where(Media.deleted_at.is_(None)))).scalar_one()
    return resp


@router.post("", status_code=201)
async def upload(session: DB, auth: Perm("media.manage"), file: UploadFile = File(...), folder: str = Form(""),
                 title: str | None = Form(None)) -> dict[str, Any]:
    data, mime, name = await _read_upload(file)
    checksum = hashlib.sha256(data).hexdigest()
    existing = (await session.execute(select(Media).where(Media.checksum == checksum, Media.deleted_at.is_(None)))).scalars().first()
    if existing:
        return {**media_out(existing), "duplicate": True}
    w, h = _inspect(data, mime)
    m = Media(storage_key=_store(data, name), original_name=name, title=(title or Path(name).stem)[:255],
              folder=folder.strip("/")[:96], mime_type=mime, kind=ALLOWED[mime], size=len(data), width=w, height=h,
              checksum=checksum, uploaded_by=auth.admin.id)
    session.add(m)
    await session.flush()
    await audit(session, auth.admin, "media.upload", f"Uploaded {name}", entity_type="media", entity_id=m.id)
    return media_out(m)


class MediaUpdateIn(BaseModel):
    title: str | None = Field(None, max_length=255)
    folder: str | None = Field(None, max_length=96)


async def _get(session: Any, media_id: uuid.UUID) -> Media:
    m = await session.get(Media, media_id)
    if m is None or m.deleted_at is not None:
        raise NotFound("File not found")
    return m


@router.patch("/{media_id}")
async def update_media(media_id: uuid.UUID, body: MediaUpdateIn, session: DB, auth: Perm("media.manage")) -> dict[str, Any]:
    m = await _get(session, media_id)
    if body.title is not None:
        m.title = body.title
    if body.folder is not None:
        m.folder = body.folder.strip("/")
    return media_out(m)


@router.post("/{media_id}/replace")
async def replace(media_id: uuid.UUID, session: DB, auth: Perm("media.manage"), file: UploadFile = File(...)) -> dict[str, Any]:
    m = await _get(session, media_id)
    data, mime, name = await _read_upload(file)
    w, h = _inspect(data, mime)
    old_key = m.storage_key
    m.storage_key = _store(data, name)
    m.original_name, m.mime_type, m.kind, m.size, m.width, m.height = name, mime, ALLOWED[mime], len(data), w, h
    m.checksum = hashlib.sha256(data).hexdigest()
    m.telegram_file_id = None  # force re-upload to Telegram
    m.version += 1
    on_commit(session, content_cache.invalidate)

    async def _cleanup() -> None:
        try:
            (Path(settings.media_root) / old_key).unlink(missing_ok=True)
        except Exception:
            pass

    on_commit(session, _cleanup)
    await audit(session, auth.admin, "media.replace", f"Replaced file {m.title}", entity_type="media", entity_id=m.id)
    return media_out(m)


async def _usage(session: Any, media_id: uuid.UUID) -> list[str]:
    used = []
    for model, label in ((Product, "product"), (Category, "category"), (Page, "page"), (Banner, "banner")):
        n = (await session.execute(select(func.count()).select_from(model).where(model.media_id == media_id))).scalar_one()
        if n:
            used.append(f"{n} {label}{'s' if n > 1 else ''}")
    return used


@router.get("/{media_id}/usage")
async def usage(media_id: uuid.UUID, session: DB, auth: Perm("media.manage")) -> dict[str, Any]:
    return {"used_by": await _usage(session, media_id)}


@router.delete("/{media_id}")
async def delete_media(media_id: uuid.UUID, session: DB, auth: Perm("media.manage"), force: bool = False) -> dict[str, str]:
    m = await _get(session, media_id)
    used = await _usage(session, media_id)
    if used and not force:
        raise Conflict("File is in use by " + ", ".join(used))
    if used:
        for model in (Product, Category, Page):
            for obj in (await session.execute(select(model).where(model.media_id == media_id))).scalars():
                obj.media_id = None
        for b in (await session.execute(select(Banner).where(Banner.media_id == media_id))).scalars():
            await session.delete(b)
    m.deleted_at = utcnow()
    on_commit(session, content_cache.invalidate)
    await audit(session, auth.admin, "media.delete", f"Deleted file {m.title}", entity_type="media", entity_id=m.id)
    return {"status": "ok"}


@router.get("/{media_id}/file")
async def serve(media_id: uuid.UUID, session: DB, auth: Auth) -> FileResponse:
    m = await session.get(Media, media_id)
    if m is None:
        raise NotFound("File not found")
    path = Path(settings.media_root) / m.storage_key
    if not path.is_file():
        raise NotFound("File missing on disk")
    return FileResponse(path, media_type=m.mime_type, filename=m.original_name,
                        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
                                 "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox"},
                        content_disposition_type="inline" if m.kind in ("image", "animation", "video") else "attachment")
