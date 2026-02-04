from __future__ import annotations

import logging
import time
from typing import Any, Dict, Iterable, Optional

import httpx

logger = logging.getLogger(__name__)


class TelegramClient:
    def __init__(self, token: str) -> None:
        self.token = token
        self.base_url = f"https://api.telegram.org/bot{token}"
        self.http = httpx.Client(timeout=30)

    def get_updates(self, offset: Optional[int], timeout: int = 20) -> Dict[str, Any]:
        params = {"timeout": timeout}
        if offset is not None:
            params["offset"] = offset
        return self._get("getUpdates", params=params)

    def get_file(self, file_id: str) -> Dict[str, Any]:
        return self._get("getFile", params={"file_id": file_id})

    def stream_file(self, file_path: str) -> Iterable[bytes]:
        url = f"https://api.telegram.org/file/bot{self.token}/{file_path}"
        with self.http.stream("GET", url) as resp:
            resp.raise_for_status()
            for chunk in resp.iter_bytes():
                yield chunk

    def send_message(self, chat_id: str, text: str) -> Dict[str, Any]:
        return self._post("sendMessage", json={"chat_id": chat_id, "text": text})

    def delete_message(self, chat_id: str, message_id: int) -> Dict[str, Any]:
        return self._post("deleteMessage", json={"chat_id": chat_id, "message_id": message_id})

    def _get(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        resp = self.http.get(f"{self.base_url}/{method}", params=params)
        resp.raise_for_status()
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(data)
        return data

    def _post(self, method: str, json: Dict[str, Any]) -> Dict[str, Any]:
        resp = self.http.post(f"{self.base_url}/{method}", json=json)
        resp.raise_for_status()
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(data)
        return data


def parse_caption(caption: str | None) -> Dict[str, str]:
    if not caption:
        return {}
    result: Dict[str, str] = {}
    for raw_line in caption.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower()
        value = value.strip()
        if not value:
            continue
        result[key] = value
    return result


def normalize_tags(raw: Optional[str]) -> str:
    if not raw:
        return ""
    parts = [part.strip() for part in raw.replace("；", ",").split(",")]
    parts = [part for part in parts if part]
    return ", ".join(dict.fromkeys(parts))


def normalize_lang(raw: Optional[str]) -> str:
    if not raw:
        return ""
    lowered = raw.strip().lower()
    if lowered in {"zh", "zh-cn", "cn", "中文"}:
        return "zh"
    if lowered in {"en", "英文", "english"}:
        return "en"
    return lowered
