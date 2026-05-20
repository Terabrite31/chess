# SignalDesk Messaging

A high-level messaging website with account verification, persistent conversations, teammate search, unread counts, and a local JSON database.

## Run locally

```sh
npm run dev
```

Open `http://localhost:3000`.

The app stores development data in `data/signaldesk-db.json`. Registration works without external setup: if `RESEND_API_KEY` is not set, the app shows a dev verification link directly after account creation.

## Optional Resend email setup

Create a `.env` file or set these environment variables before running the server:

```sh
AUTH_SECRET="replace-with-a-long-random-string"
APP_URL="http://localhost:3000"
RESEND_API_KEY="re_..."
EMAIL_FROM="SignalDesk <verify@yourdomain.com>"
DB_PATH="./data/signaldesk-db.json"
```

`EMAIL_FROM` must be a sender/domain verified in Resend. Without `RESEND_API_KEY`, verification links are returned in the browser for local development.

## API

- `POST /api/auth?action=register`
- `POST /api/auth?action=login`
- `POST /api/auth?action=logout`
- `POST /api/auth?action=resend`
- `GET /api/auth?action=me`
- `GET /api/messages`
- `GET /api/messages?action=directory&q=term`
- `GET /api/messages?action=thread&id=convo_id`
- `POST /api/messages?action=create`
- `POST /api/messages?action=send`
