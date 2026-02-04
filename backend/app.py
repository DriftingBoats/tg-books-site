from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

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


@app.get("/api/books")
def list_books(query: Optional[str] = None, lang: Optional[str] = None, limit: int = 60, offset: int = 0) -> Dict[str, Any]:
    query = query.strip() if query else None
    lang = lang.strip() if lang else None
    rows = db.list_books(query, lang, limit, offset)
    total = db.count_books(query, lang)
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
    info = client.get_file(file_id)
    file_path = info["result"]["file_path"]
    filename = row["file_name"] or file_path.split("/")[-1]
    headers = {"Content-Disposition": f"attachment; filename=\"{filename}\""}
    return StreamingResponse(client.stream_file(file_path), headers=headers)


@app.delete("/api/books/{book_id}")
def delete_book(book_id: int, also_tg: bool = False) -> Dict[str, Any]:
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
            data = {
                "tg_chat_id": chat_id,
                "tg_message_id": int(message.get("message_id")),
                "file_id": document.get("file_id"),
                "file_unique_id": document.get("file_unique_id"),
                "file_name": document.get("file_name"),
                "mime_type": document.get("mime_type"),
                "file_size": document.get("file_size"),
                "title": fields.get("title"),
                "author": fields.get("author"),
                "lang": normalize_lang(fields.get("lang")),
                "tags": normalize_tags(fields.get("tags")),
                "source": fields.get("source") or "tg",
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
