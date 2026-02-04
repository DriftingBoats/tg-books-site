from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    bot_token: str
    book_chat_id: str
    maint_chat_id: str
    db_path: Path
    poll_interval: float
    cleanup_interval: float
    frontend_dist: Path | None


def _load_dotenv() -> None:
    env_path = Path(".env")
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"").strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def load_settings() -> Settings:
    _load_dotenv()
    bot_token = os.getenv("TG_BOT_TOKEN", "").strip()
    book_chat_id = os.getenv("TG_BOOK_CHAT_ID", "").strip()
    maint_chat_id = os.getenv("TG_MAINT_CHAT_ID", "").strip()
    db_path = Path(os.getenv("THAIGL_DB_PATH", "./data/thaigl.db")).resolve()
    poll_interval = float(os.getenv("TG_POLL_INTERVAL", "2.0"))
    cleanup_interval = float(os.getenv("TG_CLEANUP_INTERVAL", "0"))
    frontend_dist_raw = os.getenv("FRONTEND_DIST", "").strip()
    frontend_dist = Path(frontend_dist_raw).resolve() if frontend_dist_raw else None
    return Settings(
        bot_token=bot_token,
        book_chat_id=book_chat_id,
        maint_chat_id=maint_chat_id,
        db_path=db_path,
        poll_interval=poll_interval,
        cleanup_interval=cleanup_interval,
        frontend_dist=frontend_dist,
    )
