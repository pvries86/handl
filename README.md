# TaskFlow

TaskFlow is now a standalone, self-hosted ticketing app. It no longer depends on Firebase for auth, Firestore, or Storage.

## Run With Docker

SQLite is the default database and stores data in the `taskflow-data` Docker volume:

```bash
docker compose up --build
```

Open http://localhost:3000 and sign in with your email address. Set `ADMIN_EMAILS` in `docker-compose.yml` to the comma-separated emails that should receive the `admin` role.

Uploaded files are stored under `/app/data/uploads` in the same Docker volume as the SQLite database.

## Use Postgres

Uncomment `DATABASE_URL` and the `db` service in `docker-compose.yml`, then run:

```bash
docker compose up --build
```

When `DATABASE_URL` is set, TaskFlow creates and uses the same schema in Postgres instead of SQLite.

## Deploy From GitHub To A Docker Host

This repo includes a GitHub Actions workflow that publishes a Docker image to GitHub Container Registry:

```text
ghcr.io/<github-owner>/<repo-name>:latest
```

On your dev box:

```bash
git add .
git commit -m "Make TaskFlow standalone"
git branch -M main
git remote add origin https://github.com/<github-owner>/<repo-name>.git
git push -u origin main
```

After the push, open the repository on GitHub and check **Actions**. The `Publish Docker Image` workflow should build and publish the image.

On your Docker host, create a stack folder with only a compose file:

```bash
mkdir -p /opt/stacks/taskflow
cd /opt/stacks/taskflow
```

Copy `compose.stack.yml` into that folder, rename it to `docker-compose.yml`, and change:

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

The host does not need the source code when using `compose.stack.yml`; it only pulls the published image.

## Run Locally Without Docker

```bash
npm install
python -m pip install extract-msg beautifulsoup4
npm run build
npm start
```

For development, run the API and Vite in separate terminals:

```bash
npm run dev:server
npm run dev
```

Then open http://localhost:5173. Vite proxies `/api` and `/uploads` to the API server on port 3000.

If the frontend runs on Vite and the API runs elsewhere, set `VITE_API_BASE_URL`, for example:

```bash
VITE_API_BASE_URL=http://localhost:3000 npm run dev
```
