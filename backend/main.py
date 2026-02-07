from __future__ import annotations

from pathlib import Path
import sys

import os
import uvicorn


def _ensure_repo_on_path() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))


if __name__ == "__main__":
    _ensure_repo_on_path()
    # Load .env early so THAIGL_PORT / THAIGL_RELOAD take effect for uvicorn itself.
    # (backend.app also loads .env, but that's too late for reading env in this module.)
    from backend.config import _load_dotenv

    _load_dotenv()
    port = int(os.getenv("THAIGL_PORT", "8963"))
    reload = os.getenv("THAIGL_RELOAD", "0").strip() == "1"
    uvicorn.run("backend.app:app", host="0.0.0.0", port=port, reload=reload)
