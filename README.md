# TG Books Site

A self-hosted “Telegram as storage” library site.

- Upload `document` files (PDF/EPUB/...) into a Telegram group/channel
- FastAPI backend syncs metadata into SQLite and proxies downloads/covers
- React (Vite) frontend supports fuzzy search, language/category filters, admin edit/remove

This repo is designed for the common scenario: your server can access Telegram, but end users cannot. Users browse/search on the website; downloads are proxied by the backend.

## Features
- Telegram sync:
  - Reads `document` messages
  - Parses caption into metadata (title/author/lang/tags/category/source)
  - Stores in SQLite + FTS search
  - Proxies file download via `/api/books/{id}/download`
  - Proxies Telegram thumbnail as cover via `/api/books/{id}/cover` with local caching
- UI:
  - Search (title/author/tags)
  - Language tabs (ALL / EN / 中文)
  - Category filter (desktop chips; mobile dropdown)
  - Metadata editing modal (admin mode)
  - Remove (admin mode) with optional Telegram delete
  - “Back to top” button
- Optional auto-cleanup:
  - Telegram doesn’t push “message deleted” events to bots
  - This project periodically verifies message existence and deletes stale DB entries

## Requirements
- Python 3.10+
- Node 18+ (Node 20+ recommended)
- A Telegram bot token
- A Telegram group/channel `chat_id`

## Quick Start (Local)
1. Backend:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m backend.main
```

2. Frontend dev server:
```bash
cd frontend
npm install
npm run dev
```

Notes:
- The dev proxy target is configured in `/Users/wangmingming/Documents/GitHub/thaigl-site/frontend/vite.config.ts`. If your backend runs on a different port, update it.
- For production, build the frontend and let the backend serve it via `FRONTEND_DIST`.

## Env Vars
Create `.env` (do NOT commit secrets) or export variables.

Required:
```bash
TG_BOT_TOKEN=...          # bot token from BotFather
TG_BOOK_CHAT_ID=...       # group/channel id like -1001234567890
THAIGL_DB_PATH=./data/thaigl.db
FRONTEND_DIST=./frontend/dist
```

Recommended:
```bash
THAIGL_PORT=8963          # backend port
THAIGL_RELOAD=0           # set to 1 for dev auto-reload
THAIGL_COVER_DIR=./data/covers
THAIGL_ADMIN_KEY=...      # enable admin APIs + UI with ?admin=1&key=...
```

Branding (served by `/api/config` at runtime; no rebuild required):
```bash
THAIGL_SITE_NAME=GL Library
THAIGL_HEADER_NAME=GL Library
THAIGL_APP_ICON=/img/favicon.png
THAIGL_APPLE_ICON=/img/logo.png
THAIGL_LOGO=/img/logo.png
THAIGL_DEFAULT_COVER=/img/cover.png
```

Auto cleanup (optional):
```bash
TG_MAINT_CHAT_ID=...       # a private bot-only “maintenance” chat/group/channel
TG_CLEANUP_INTERVAL=3600   # seconds; set >0 to enable cleanup
```

## How To Get `TG_BOOK_CHAT_ID`
You can only “see” a chat id after the bot has received at least one update from that chat.

1. Add the bot to the target group/channel.
2. In the target chat, send a command such as `/start` (commands work even when bot privacy mode is enabled).
3. On the server:
```bash
curl -s "https://api.telegram.org/bot$TG_BOT_TOKEN/getUpdates" | python3 -m json.tool
```
Find:
- Group: `result[].message.chat.id`
- Channel: `result[].channel_post.chat.id` (bot must be channel admin)

If you always see `{"ok":true,"result":[]}`:
- You are not sending messages to the same bot token (`getMe` can confirm bot username)
- Or the bot is not in that chat
- Or for channels: the bot is not an admin

## Caption Format
Send a `document` with caption:
```text
Title: One Shot_ Rubik
Author: Zezeho
Lang: en
Tags: gl, romance, short
Category: OneShot
Source: DriftingBoats
```

Supported `Lang` examples (case-insensitive):
- `en`
- `zh`
- `th`

Notes:
- If caption is empty:
  - Title defaults to Telegram `file_name`
  - Author defaults to `Unknown`
  - Source defaults to sender username (if available)
- You can also write everything on one line:
```text
Title: ... | Author: ... | Lang: en | Tags: ... | Category: ... | Source: ...
```

## Admin Mode
Frontend admin mode is enabled by adding query params:
`?admin=1&key=YOUR_KEY`

Backend authorization:
- If `THAIGL_ADMIN_KEY` is set, admin endpoints require `?key=...`
- If `THAIGL_ADMIN_KEY` is empty, admin endpoints are effectively open (not recommended)

Admin capabilities:
- Edit metadata (title/author/lang/tags/category/source/cover URL)
- Remove a book (delete from DB, optionally delete the Telegram message)

Telegram command remove:
- In the book group, send `/remove <message_id>`, or reply to the target message with `/remove`

## Auto Cleanup (Stale DB Entries)
Telegram bots do not receive deletion events. Cleanup is implemented by periodically trying to `copyMessage` each stored message into `TG_MAINT_CHAT_ID`.

If `copyMessage` fails with “message not found” / “MESSAGE_ID_INVALID”, the DB record is removed.

Tradeoffs:
- This is a best-effort heuristic
- Requires a maintenance chat id that the bot can write to

## Production Build
Build frontend:
```bash
cd frontend
npm ci
npm run build
```

Run backend (serves `FRONTEND_DIST` as `/` when configured):
```bash
source .venv/bin/activate
python -m backend.main
```

## Deployment (systemd example)
This is a minimal example; adjust paths/ports.

Create env file (use `sudo tee` so redirection works):
```bash
sudo mkdir -p /etc/thaigl
cat <<'EOF' | sudo tee /etc/thaigl/thaigl.env >/dev/null
TG_BOT_TOKEN=...
TG_BOOK_CHAT_ID=...
THAIGL_DB_PATH=/opt/tg-books-site/data/thaigl.db
THAIGL_COVER_DIR=/opt/tg-books-site/data/covers
FRONTEND_DIST=/opt/tg-books-site/frontend/dist
THAIGL_PORT=8963
THAIGL_ADMIN_KEY=...
TG_CLEANUP_INTERVAL=3600
TG_MAINT_CHAT_ID=...
EOF
```

`/etc/systemd/system/thaigl.service`:
```ini
[Unit]
Description=TG Books Site
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/tg-books-site
EnvironmentFile=/etc/thaigl/thaigl.env
ExecStart=/opt/tg-books-site/.venv/bin/python -m backend.main
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Enable:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now thaigl
sudo systemctl status thaigl --no-pager
```

## Security Notes
- Treat `TG_BOT_TOKEN` like a password. If it leaks, regenerate it in BotFather.
- Never commit `.env` into git.
- Admin mode is protected only by `THAIGL_ADMIN_KEY` (a shared secret in URL). Use a long random key and serve the site behind HTTPS.

## License
Choose a license (MIT/Apache-2.0/etc) before publishing broadly.
