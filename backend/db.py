from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_chat_id TEXT NOT NULL,
    tg_message_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    file_unique_id TEXT,
    file_name TEXT,
    mime_type TEXT,
    file_size INTEGER,
    title TEXT,
    author TEXT,
    lang TEXT,
    tags TEXT,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tg_chat_id, tg_message_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
    title, author, tags, content='books', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
    INSERT INTO books_fts(rowid, title, author, tags) VALUES (new.id, new.title, new.author, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
    INSERT INTO books_fts(books_fts, rowid, title, author, tags) VALUES ('delete', old.id, old.title, old.author, old.tags);
    INSERT INTO books_fts(rowid, title, author, tags) VALUES (new.id, new.title, new.author, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
    INSERT INTO books_fts(books_fts, rowid, title, author, tags) VALUES ('delete', old.id, old.title, old.author, old.tags);
END;
"""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def init(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA_SQL)

    def get_meta(self, key: str) -> Optional[str]:
        with self.connect() as conn:
            cur = conn.execute("SELECT value FROM meta WHERE key=?", (key,))
            row = cur.fetchone()
            return row["value"] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )

    def upsert_book(self, data: Dict[str, Any]) -> None:
        columns = [
            "tg_chat_id",
            "tg_message_id",
            "file_id",
            "file_unique_id",
            "file_name",
            "mime_type",
            "file_size",
            "title",
            "author",
            "lang",
            "tags",
            "source",
        ]
        values = [data.get(col) for col in columns]
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO books (
                    tg_chat_id, tg_message_id, file_id, file_unique_id, file_name, mime_type, file_size,
                    title, author, lang, tags, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tg_chat_id, tg_message_id) DO UPDATE SET
                    file_id=excluded.file_id,
                    file_unique_id=excluded.file_unique_id,
                    file_name=excluded.file_name,
                    mime_type=excluded.mime_type,
                    file_size=excluded.file_size,
                    title=excluded.title,
                    author=excluded.author,
                    lang=excluded.lang,
                    tags=excluded.tags,
                    source=excluded.source,
                    updated_at=datetime('now')
                """,
                values,
            )

    def list_books(self, query: Optional[str], lang: Optional[str], limit: int, offset: int) -> List[sqlite3.Row]:
        with self.connect() as conn:
            clauses = []
            params: List[Any] = []
            if query:
                clauses.append("id IN (SELECT rowid FROM books_fts WHERE books_fts MATCH ?)")
                params.append(query)
            if lang:
                clauses.append("lang = ?")
                params.append(lang)
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            sql = f"SELECT * FROM books {where} ORDER BY updated_at DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            return conn.execute(sql, params).fetchall()

    def count_books(self, query: Optional[str], lang: Optional[str]) -> int:
        with self.connect() as conn:
            clauses = []
            params: List[Any] = []
            if query:
                clauses.append("id IN (SELECT rowid FROM books_fts WHERE books_fts MATCH ?)")
                params.append(query)
            if lang:
                clauses.append("lang = ?")
                params.append(lang)
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            sql = f"SELECT COUNT(1) AS total FROM books {where}"
            row = conn.execute(sql, params).fetchone()
            return int(row["total"]) if row else 0

    def get_book(self, book_id: int) -> Optional[sqlite3.Row]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
            return row

    def delete_book(self, book_id: int) -> bool:
        with self.connect() as conn:
            cur = conn.execute("DELETE FROM books WHERE id=?", (book_id,))
            return cur.rowcount > 0

    def delete_book_by_message(self, chat_id: str, message_id: int) -> bool:
        with self.connect() as conn:
            cur = conn.execute(
                "DELETE FROM books WHERE tg_chat_id=? AND tg_message_id=?",
                (chat_id, message_id),
            )
            return cur.rowcount > 0

    def recent_books(self, limit: int) -> List[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute("SELECT * FROM books ORDER BY updated_at DESC LIMIT ?", (limit,)).fetchall()

    def list_books_basic(self, limit: int, offset: int) -> List[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                "SELECT id, tg_chat_id, tg_message_id FROM books ORDER BY id ASC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
