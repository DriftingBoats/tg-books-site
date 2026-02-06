from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class Settings:
    bot_token: str
    book_chat_id: str
    maint_chat_id: str
    admin_key: str
    db_path: Path
    cover_cache_dir: Path
    site_name: str
    header_name: str
    app_icon: str
    apple_icon: str
    logo: str
    poll_interval: float
    cleanup_interval: float
    frontend_dist: Optional[Path]


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
    admin_key = os.getenv("THAIGL_ADMIN_KEY", "").strip()
    db_path = Path(os.getenv("THAIGL_DB_PATH", "./data/thaigl.db")).resolve()
    cover_cache_dir = Path(os.getenv("THAIGL_COVER_DIR", "./data/covers")).resolve()
    site_name = os.getenv("THAIGL_SITE_NAME", "GL Library").strip()
    header_name = os.getenv("THAIGL_HEADER_NAME", site_name).strip() or site_name
    app_icon = os.getenv("THAIGL_APP_ICON", "/icons/favicon.png").strip()
    apple_icon = os.getenv("THAIGL_APPLE_ICON", "").strip()
    logo = os.getenv("THAIGL_LOGO", "").strip()
    poll_interval = float(os.getenv("TG_POLL_INTERVAL", "2.0"))
    cleanup_interval = float(os.getenv("TG_CLEANUP_INTERVAL", "0"))
    frontend_dist_raw = os.getenv("FRONTEND_DIST", "").strip()
    frontend_dist = Path(frontend_dist_raw).resolve() if frontend_dist_raw else None
    return Settings(
        bot_token=bot_token,
        book_chat_id=book_chat_id,
        maint_chat_id=maint_chat_id,
        admin_key=admin_key,
        db_path=db_path,
        cover_cache_dir=cover_cache_dir,
        site_name=site_name,
        header_name=header_name,
        app_icon=app_icon,
        apple_icon=apple_icon,
        logo=logo,
        poll_interval=poll_interval,
        cleanup_interval=cleanup_interval,
        frontend_dist=frontend_dist,
    )
