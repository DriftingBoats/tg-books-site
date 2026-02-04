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
THAIGL_DB_PATH=./data/thaigl.db
FRONTEND_DIST=./frontend/dist
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
Source: tg
```

## Remove items
Telegram does not notify bots about deletions. Use one of these:

1. In the group, reply to a book message with:
```
/remove
```
or
```
/remove <message_id>
```
2. In the UI, click "Remove from list" (DB only).

## Notes
- Bot must be admin and privacy mode disabled in the book group.
- Phase 2 will add PDF margin tools and translation flow.
