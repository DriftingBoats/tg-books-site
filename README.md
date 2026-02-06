# ThaiGL Library (Phase 1)

## Overview
Phase 1 provides a read-only library UI backed by Telegram group metadata. The backend syncs `document` messages from a book group, caches metadata in SQLite, and serves the data for fast search.

## Requirements
- Python 3.10+
- Node 18+
- Telegram bot token and book group chat id

## Env
Create a `.env` or export variables:

```
TG_BOT_TOKEN=...
TG_BOOK_CHAT_ID=...   # group id like -1001234567890
TG_MAINT_CHAT_ID=...  # maintenance group id for cleanup (optional)
THAIGL_DB_PATH=./data/thaigl.db
FRONTEND_DIST=./frontend/dist
TG_CLEANUP_INTERVAL=0  # seconds; set to >0 to enable auto cleanup
THAIGL_ADMIN_KEY=...   # required for delete endpoint if set
```

## Backend
```
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m backend.main
```

## Frontend
```
cd frontend
npm install
npm run dev
```

## Caption format
Each Telegram `document` message should have a caption like:

```
Title: ...
Author: ...
Lang: zh/en
Tags: tag1, tag2
Category: ...
Source: tg
```

Notes:
- `Source:` is optional. If omitted, the backend will use the sender's Telegram username (if available).
- `Tags:` / `Category:` are optional.

## Auto cleanup
Telegram does not notify bots about deletions. Auto cleanup is implemented by
attempting to copy each message to a maintenance group. If the copy fails with
\"message to copy not found\", the record is removed from the database.

Set `TG_MAINT_CHAT_ID` and `TG_CLEANUP_INTERVAL` (seconds) to enable this.

## Admin delete
Enable admin mode with `?admin=1&key=YOUR_KEY`. The backend checks `THAIGL_ADMIN_KEY`
for delete requests.

Admin mode also supports editing book metadata (title/author/lang/tags/source/category/cover URL).

## Notes
- Bot must be admin and privacy mode disabled in the book group.
- Phase 2 will add PDF margin tools and translation flow.
