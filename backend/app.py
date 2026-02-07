from __future__ import annotations

import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import load_settings
from .db import Database
from .tg import TelegramClient, normalize_lang, normalize_tags, parse_caption

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("thaigl")

settings = load_settings()
if not settings.bot_token:
    logger.warning("TG_BOT_TOKEN not set; bot sync will be disabled.")
if not settings.book_chat_id:
    logger.warning("TG_BOOK_CHAT_ID not set; bot sync will be disabled.")
if settings.cleanup_interval > 0 and not settings.maint_chat_id:
    logger.warning("TG_MAINT_CHAT_ID not set; cleanup will be disabled.")

db = Database(settings.db_path)

app = FastAPI(title="ThaiGL Library")

_ASCII_FILENAME_FALLBACK = re.compile(r"[^A-Za-z0-9._ -]+")


def _content_disposition_attachment(filename: str) -> str:
    """
    Build a RFC 6266 / RFC 5987 compatible Content-Disposition header value.

    Starlette encodes headers as latin-1; if we include raw non-ascii characters
    in `filename="..."`, it raises UnicodeEncodeError and returns 500.
    """
    # Ensure we only use the leaf name; avoid path traversal in headers.
    name = Path(filename).name
    name = re.sub(r"[\r\n]+", " ", name).strip() or "download"

    # ASCII fallback for legacy clients. Keep it conservative and header-safe.
    fallback = name.encode("ascii", "ignore").decode("ascii")
    fallback = _ASCII_FILENAME_FALLBACK.sub("_", fallback)
    fallback = fallback.replace("\\", "_").replace('"', "_").strip() or "download"

    # RFC 5987: percent-encoded UTF-8.
    utf8 = quote(name, safe="")
    return f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{utf8}'


@app.on_event("startup")
def on_startup() -> None:
    db.init()
    if settings.bot_token and settings.book_chat_id:
        thread = threading.Thread(target=_poll_updates_loop, daemon=True)
        thread.start()
    if settings.bot_token and settings.cleanup_interval > 0 and settings.maint_chat_id:
        thread = threading.Thread(target=_cleanup_loop, daemon=True)
        thread.start()


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def get_config() -> Dict[str, str]:
    apple_icon = settings.apple_icon or settings.logo or settings.app_icon
    logo = settings.logo or settings.app_icon
    return {
        "site_name": settings.site_name,
        "header_name": settings.header_name,
        "app_icon": settings.app_icon,
        "apple_icon": apple_icon,
        "logo": logo,
        "default_cover": settings.default_cover,
        "footer_text": settings.footer_text,
    }


@app.get("/api/books")
def list_books(
    query: Optional[str] = None,
    lang: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 60,
    offset: int = 0,
) -> Dict[str, Any]:
    query = query.strip() if query else None
    lang = lang.strip() if lang else None
    category = category.strip() if category else None
    rows = db.list_books(query, lang, category, limit, offset)
    total = db.count_books(query, lang, category)
    return {
        "total": total,
        "items": [dict(row) for row in rows],
    }


@app.get("/api/books/{book_id}")
def get_book(book_id: int) -> Dict[str, Any]:
    row = db.get_book(book_id)
    if not row:
        raise HTTPException(status_code=404, detail="Book not found")
    return dict(row)


@app.get("/api/books/{book_id}/download")
def download_book(book_id: int) -> StreamingResponse:
    row = db.get_book(book_id)
    if not row:
        raise HTTPException(status_code=404, detail="Book not found")
    file_id = row["file_id"]
    if not settings.bot_token:
        raise HTTPException(status_code=500, detail="Bot token missing")
    client = TelegramClient(settings.bot_token)
    try:
        info = client.get_file(file_id)
    except Exception as e:
        logger.exception("Telegram getFile failed for book_id=%s", book_id)
        raise HTTPException(status_code=502, detail=f"Telegram getFile failed: {e!s}")
    file_path = (info.get("result") or {}).get("file_path")
    if not file_path:
        raise HTTPException(status_code=502, detail="Telegram getFile returned no file_path")
    filename = row["file_name"] or file_path.split("/")[-1]
    headers = {"Content-Disposition": _content_disposition_attachment(filename)}
    media_type = row["mime_type"] or "application/octet-stream"
    return StreamingResponse(client.stream_file(file_path), headers=headers, media_type=media_type)


def _guess_media_type(file_path: str) -> str:
    lowered = file_path.lower()
    if lowered.endswith(".jpg") or lowered.endswith(".jpeg"):
        return "image/jpeg"
    if lowered.endswith(".png"):
        return "image/png"
    if lowered.endswith(".webp"):
        return "image/webp"
    return "application/octet-stream"


@app.get("/api/books/{book_id}/cover")
def cover_image(book_id: int) -> StreamingResponse:
    row = db.get_book(book_id)
    if not row:
        raise HTTPException(status_code=404, detail="Book not found")
    cover_file_id = row["cover_file_id"]
    if not cover_file_id:
        raise HTTPException(status_code=404, detail="Cover not found")
    if not settings.bot_token:
        raise HTTPException(status_code=500, detail="Bot token missing")
    cache_dir = settings.cover_cache_dir
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached_candidates = [
        path for path in cache_dir.glob(f"{cover_file_id}.*") if path.is_file() and not path.name.endswith(".tmp")
    ]
    for cached in cached_candidates:
        if cached.stat().st_size > 0:
            return FileResponse(
                cached,
                media_type=_guess_media_type(cached.name),
                headers={"Cache-Control": "public, max-age=86400"},
            )
    client = TelegramClient(settings.bot_token)
    info = client.get_file(cover_file_id)
    file_path = info["result"]["file_path"]
    suffix = Path(file_path).suffix or ".bin"
    cached_file = cache_dir / f"{cover_file_id}{suffix}"
    media_type = _guess_media_type(file_path)
    tmp_path = cache_dir / f"{cover_file_id}{suffix}.tmp"
    with open(tmp_path, "wb") as f:
        for chunk in client.stream_file(file_path):
            f.write(chunk)
    os.replace(tmp_path, cached_file)
    return FileResponse(
        cached_file,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


class BookPatch(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    lang: Optional[str] = None
    tags: Optional[str] = None
    source: Optional[str] = None
    category: Optional[str] = None
    cover: Optional[str] = None  # external URL override


@app.patch("/api/books/{book_id}")
def patch_book(book_id: int, payload: BookPatch, admin_key: str = Query("", alias="key")) -> Dict[str, Any]:
    if settings.admin_key and admin_key != settings.admin_key:
        raise HTTPException(status_code=403, detail="Forbidden")
    row = db.get_book(book_id)
    if not row:
        raise HTTPException(status_code=404, detail="Book not found")

    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "lang" in data:
        raw = data.get("lang")
        if raw is None:
            data["lang"] = None
        else:
            raw = raw.strip()
            data["lang"] = normalize_lang(raw) if raw else ""

    if "tags" in data:
        raw = data.get("tags")
        if raw is None:
            data["tags"] = None
        else:
            raw = raw.strip()
            data["tags"] = normalize_tags(raw) if raw else ""

    if "category" in data:
        raw = data.get("category")
        if raw is None:
            data["category"] = None
        else:
            raw = raw.strip()
            data["category"] = raw if raw else None

    if "cover" in data:
        raw = data.get("cover")
        if raw is None:
            data["cover"] = None
        else:
            raw = raw.strip()
            data["cover"] = raw if raw else None

    # Trim simple string fields.
    for key in ("title", "author", "source"):
        if key in data and isinstance(data[key], str):
            data[key] = data[key].strip()

    updated = db.update_book(book_id, data)
    if not updated:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    row2 = db.get_book(book_id)
    return dict(row2) if row2 else dict(row)


@app.delete("/api/books/{book_id}")
def delete_book(
    book_id: int,
    also_tg: bool = False,
    admin_key: str = Query("", alias="key"),
) -> Dict[str, Any]:
    if settings.admin_key and admin_key != settings.admin_key:
        raise HTTPException(status_code=403, detail="Forbidden")
    row = db.get_book(book_id)
    if not row:
        raise HTTPException(status_code=404, detail="Book not found")
    if also_tg and settings.bot_token:
        client = TelegramClient(settings.bot_token)
        try:
            client.delete_message(row["tg_chat_id"], int(row["tg_message_id"]))
        except Exception as exc:
            logger.warning("delete_message_failed: %s", exc)
    removed = db.delete_book(book_id)
    return {"removed": removed}

@app.post("/api/sync")
def sync_now() -> Dict[str, str]:
    if not settings.bot_token or not settings.book_chat_id:
        raise HTTPException(status_code=400, detail="Bot not configured")
    _poll_updates_once()
    return {"status": "ok"}


if settings.frontend_dist and settings.frontend_dist.exists():
    app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="frontend")


_last_poll_lock = threading.Lock()


def _poll_updates_loop() -> None:
    while True:
        try:
            _poll_updates_once()
        except Exception as exc:
            logger.exception("poll_updates_failed: %s", exc)
        time.sleep(settings.poll_interval)


def _poll_updates_once() -> None:
    if not settings.bot_token or not settings.book_chat_id:
        return
    with _last_poll_lock:
        client = TelegramClient(settings.bot_token)
        offset_raw = db.get_meta("tg_offset")
        offset = int(offset_raw) if offset_raw else None
        data = client.get_updates(offset=offset, timeout=10)
        updates = data.get("result", [])
        if not updates:
            return
        for update in updates:
            update_id = update.get("update_id")
            message = update.get("message") or update.get("edited_message")
            if not message:
                _advance_offset(update_id)
                continue
            chat_id = str(message.get("chat", {}).get("id", ""))
            if chat_id != settings.book_chat_id:
                _advance_offset(update_id)
                continue
            text = message.get("text") or ""
            if text.startswith("/remove"):
                removed_message_id = None
                parts = text.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    removed_message_id = int(parts[1])
                reply = message.get("reply_to_message")
                if reply and reply.get("message_id"):
                    removed_message_id = int(reply["message_id"])
                if removed_message_id:
                    deleted = db.delete_book_by_message(chat_id, removed_message_id)
                    try:
                        client.delete_message(chat_id, removed_message_id)
                    except Exception:
                        pass
                    if deleted:
                        client.send_message(chat_id, f"Removed book {removed_message_id}.")
                _advance_offset(update_id)
                continue
            document = message.get("document")
            if not document:
                _advance_offset(update_id)
                continue
            caption = message.get("caption")
            fields = parse_caption(caption)
            sender = message.get("from") or {}
            sender_username = sender.get("username")
            source_default = sender_username or ""
            thumb = document.get("thumbnail") or document.get("thumb") or None
            cover_file_id = thumb.get("file_id") if isinstance(thumb, dict) else None

            raw_lang = fields.get("lang")
            lang = normalize_lang(raw_lang) if raw_lang is not None else ""
            raw_tags = fields.get("tags")
            tags = normalize_tags(raw_tags) if raw_tags is not None else ""
            raw_category = fields.get("category")
            category = raw_category.strip() if isinstance(raw_category, str) and raw_category.strip() else None
            default_title = document.get("file_name") or "Untitled"
            default_author = "Unknown"
            data = {
                "tg_chat_id": chat_id,
                "tg_message_id": int(message.get("message_id")),
                "file_id": document.get("file_id"),
                "file_unique_id": document.get("file_unique_id"),
                "file_name": document.get("file_name"),
                "mime_type": document.get("mime_type"),
                "file_size": document.get("file_size"),
                "title": fields.get("title") or default_title,
                "author": fields.get("author") or default_author,
                "lang": lang,
                "tags": tags,
                "category": category,
                "cover_file_id": cover_file_id,
                # If caption doesn't provide Source:, use sender username (if available).
                "source": fields.get("source") or source_default,
            }
            db.upsert_book(data)
            _advance_offset(update_id)


def _advance_offset(update_id: Optional[int]) -> None:
    if update_id is None:
        return
    db.set_meta("tg_offset", str(update_id + 1))


def _cleanup_loop() -> None:
    while True:
        try:
            _cleanup_deleted_messages()
        except Exception as exc:
            logger.exception("cleanup_failed: %s", exc)
        time.sleep(settings.cleanup_interval)


def _cleanup_deleted_messages() -> None:
    if not settings.bot_token or not settings.maint_chat_id:
        return
    client = TelegramClient(settings.bot_token)
    batch = 200
    offset = 0
    while True:
        rows = db.list_books_basic(batch, offset)
        if not rows:
            break
        for row in rows:
            book_id = int(row["id"])
            chat_id = row["tg_chat_id"]
            message_id = int(row["tg_message_id"])
            try:
                result = client.copy_message(settings.maint_chat_id, chat_id, message_id)
                copied_id = result.get("result", {}).get("message_id")
                if copied_id:
                    try:
                        client.delete_message(settings.maint_chat_id, int(copied_id))
                    except Exception:
                        pass
            except Exception as exc:
                reason = str(exc)
                if "message to copy not found" in reason or "MESSAGE_ID_INVALID" in reason:
                    db.delete_book(book_id)
                    logger.info("Removed deleted TG message %s", message_id)
                else:
                    logger.warning("copy_message_failed: %s", exc)
            time.sleep(0.2)
        offset += batch
