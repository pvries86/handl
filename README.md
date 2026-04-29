# ![Handl](public/handl-mark.svg) Handl

**Handle support without the overhead**

Handl is a self-hosted ticket and work-log app for managing incoming requests, follow-up updates, attachments, and email-driven work in one place. It is designed for a lightweight helpdesk-style workflow without needing a full external platform.

## What Handl Does

- Create and manage tickets with status, priority, requester, assignee, and due date
- Add manual updates and keep a searchable activity log
- Import Outlook `.msg` emails into tickets
- Create new tickets directly from imported email
- Poll a Gmail mailbox over IMAP and turn incoming email into tickets or updates
- Upload and preview attachments, including images and text-based files
- Run with SQLite by default, or Postgres if you prefer
- Deploy as a standalone Docker container or from a published GitHub Container Registry image

## Requirements

- Docker and Docker Compose for container-based use
- Node.js 20+ and npm if you want to run it locally without Docker

## Quick Start With Docker

SQLite is the default database. In the provided compose setup, application data is persisted in the named Docker volume mounted at `/app/data`.

```bash
docker compose up --build
```

Then open http://localhost:3000

Sign in with a provisioned account. Set `ADMIN_EMAILS` in [docker-compose.yml](docker-compose.yml) to the comma-separated email addresses that should have the `admin` role on startup.

Uploaded files are stored under `/app/data/uploads`.

## Use Postgres Instead Of SQLite

Handl works with Postgres as well. Uncomment `DATABASE_URL` and the `db` service in [docker-compose.yml](docker-compose.yml), then start the stack:

```bash
docker compose up --build
```

When `DATABASE_URL` is set, Handl uses Postgres for application data instead of SQLite.

## Deploy To A Docker Host From GitHub

This repo includes a GitHub Actions workflow that publishes a Docker image to GitHub Container Registry:

```text
ghcr.io/<github-owner>/<repo-name>:latest
```

On your development machine:

```bash
git add .
git commit -m "Deploy Handl"
git branch -M main
git remote add origin https://github.com/<github-owner>/<repo-name>.git
git push -u origin main
```

After the push, open your repository on GitHub and check the **Actions** tab. The `Publish Docker Image` workflow should build and publish the image.

On your Docker host, create a stack folder:

```bash
mkdir -p /opt/stacks/handl
cd /opt/stacks/handl
```

Copy [compose.stack.yml](compose.stack.yml) into that folder, rename it to `docker-compose.yml`, and update at least:

```yaml
image: ghcr.io/YOUR_GITHUB_OWNER/YOUR_REPO_NAME:latest
ADMIN_EMAILS: "you@example.com"
```

Then start the stack:

```bash
docker compose pull
docker compose up -d
```

For future updates:

```bash
docker compose pull
docker compose up -d
```

The Docker host only needs the compose file when you deploy from a published image.

## Run Locally Without Docker

Install dependencies:

```bash
npm install
```

Build and run the production server:

```bash
npm run build
npm start
```

For development, run the API server and Vite separately in two terminals:

```bash
npm run dev:server
npm run dev
```

Then open http://localhost:5173

Vite proxies `/api` and `/uploads` to the API server on port 3000.

If the frontend runs on Vite and the API runs elsewhere, set `VITE_API_BASE_URL`, for example:

```bash
VITE_API_BASE_URL=http://localhost:3000 npm run dev
```

## Configuration

See [.env.example](.env.example) for the available environment variables.

Most important settings:

- `PORT`: HTTP port for the app server
- `DATA_DIR`: data directory for SQLite and uploaded files
- `ADMIN_EMAILS`: comma-separated bootstrap admin accounts
- `DATABASE_URL`: Postgres connection string, optional
- `MAX_UPLOAD_BYTES`: upload size limit in bytes

### Gmail IMAP Mailbox Ingestion

Handl can optionally poll a Gmail mailbox for unread messages and import them into tickets. This is disabled by default. For Gmail, enable IMAP on the mailbox, turn on 2-Step Verification, and create a Gmail app password for Handl.

Example configuration:

```env
MAIL_INGEST_ENABLED=true
MAIL_INGEST_HOST=imap.gmail.com
MAIL_INGEST_PORT=993
MAIL_INGEST_SECURE=true
MAIL_INGEST_USER=support@example.com
MAIL_INGEST_PASSWORD=your-app-password
MAIL_INGEST_FROM=requester@example.com
MAIL_INGEST_TO=support@example.com
MAIL_INGEST_POLL_SECONDS=300
MAIL_INGEST_ARCHIVE_AFTER_PROCESSING=true
MAIL_INGEST_BOT_EMAIL=mail-import@example.com
MAIL_INGEST_BOT_NAME="Handl Mail Import"
```

When enabled, Handl checks unread Inbox messages from `MAIL_INGEST_FROM` to `MAIL_INGEST_TO`. A subject tag like `[HANDL:<ticketId>]` updates that ticket. Replies without the tag are matched through message references or Gmail thread id when possible. Otherwise, Handl creates a new ticket. Successfully imported Gmail messages are archived by removing them from the Inbox, not deleted.

## API Integrations

Handl exposes a JSON API that can be used from Postman, scripts, automation tools, or other integrations. For automation, create an API token and send it as:

```text
Authorization: Bearer hdl_your_token
```

See [docs/api.md](docs/api.md) for endpoints, token management, and integration examples.

## Data Storage

With SQLite:

- database file: `DATA_DIR/handl.sqlite` for new installs
- legacy installs using `DATA_DIR/taskflow.sqlite` are still supported automatically
- uploads: `DATA_DIR/uploads`

With Postgres:

- application data lives in Postgres
- uploads still live in `DATA_DIR/uploads`

## Notes

- Handl is intended to be self-hosted
- Reverse-proxy auth in front of the app is supported well as an outer security layer
- Browsers may cache the favicon aggressively after branding changes; a hard refresh usually fixes that
