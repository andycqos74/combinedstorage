# Combined Storage

An online storage system that presents **several independent storage backends as one unified
drive**. Connect a local disk, a OneDrive account, and a Google Drive account (with more provider
types to come) and the web app shows a single file tree and a single, combined capacity — a 1 GB
local quota plus a 1 GB OneDrive appears as 2 GB. Uploads are placed automatically on whichever
backend has room, and every file is reachable at a stable public URL so the system also works as
a CDN.

> Proof of concept: single admin user, backends = **local disk + OneDrive + Google Drive**. The
> architecture is built so adding S3, etc. is "one new provider file + one admin form".

## How it works

The trick is a small **metadata database** (SQLite) that separates the *logical* file tree from
*physical* storage:

- The `nodes` table holds folders and files — names, paths, sizes — as the user sees them.
- Each **file** node points at its bytes with `(backend_id, object_key)`.
- Each backend implements one interface (`StorageProvider`: `put` / `get` / `delete` / `quota`).

Because logical names are decoupled from opaque physical keys:

- **Rename and move are pure database operations** — no data is copied between backends.
- **Unifying many backends into one namespace and summing their quotas is just aggregation.**
- A file's public URL (`/f/<token>`) is stable regardless of where the bytes actually live.

```
Browser (React SPA)
   │  /api/*        management + admin  (admin session required)
   │  /f/:token     public CDN file serving (no auth, supports Range)
   ▼
Express server (TypeScript)
   ├─ routes/     auth · files · admin · oauth · cdn
   ├─ services/   placement (most-free-space) · files · quota (aggregate)
   ├─ storage/    StorageProvider ── local.ts · onedrive.ts (Graph) · googledrive.ts (Drive API)
   └─ db/         SQLite metadata (tree + backend registry)
```

## Features

- File manager: browse folders, **create folder, upload (drag-and-drop or picker), rename,
  delete**, copy a file's public link, and give files **friendly link aliases**.
- Combined storage meter across all connected backends.
- Admin page to **add local-disk backends** and **connect OneDrive / Google Drive**, enable/disable
  or remove them.
- Automatic upload placement (most-free-space first) with a clear "insufficient space" error.
- Public, cacheable file URLs with HTTP **Range** support (media seeking) and ETag/`304`.
- **Mount as a Windows drive** (WebDAV endpoint at `/dav`) via rclone + WinFsp.

## Tech stack

Node.js + TypeScript · Express · better-sqlite3 · @azure/msal-node (OneDrive OAuth) · Google Drive
API v3 (OAuth2 via `fetch`) · React + Vite.

## Prerequisites

- Node.js **20+** (developed on Node 22)

## Quick start

```bash
# 1. Install dependencies (root installs both workspaces)
npm install

# 2. Configure
cp .env.example .env        # then edit .env (at least set ADMIN_PASSWORD / SESSION_SECRET)

# 3a. Development (two processes: API on :4000, Vite UI on :5173)
npm run dev
#     open http://localhost:5173

# 3b. Or a production-style single server (API + built UI on :4000)
npm run build
npm start
#     open http://localhost:4000
```

Sign in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` from your `.env` (defaults `admin` /
`changeme`). Then open **Storage**, add one or two local backends (give each a name and a quota),
switch to **Files**, and start creating folders and uploading.

## Run with Docker

The image bundles the built API and web UI into one service; `docker compose` runs it with a
persistent named volume for your data (the SQLite DB + local-backend blobs).

```bash
cp .env.example .env          # optional — override admin creds, secret, OneDrive, etc.
docker compose up --build
# open http://localhost:4000
```

- **Data persists** in the `combinedstorage-data` volume across restarts. `docker compose down`
  stops it; add `-v` to also delete the volume (wipe all files).
- **Override settings** from your shell or a `.env` file beside `docker-compose.yml`, e.g.
  `ADMIN_PASSWORD=s3cret SESSION_SECRET=$(openssl rand -hex 32) docker compose up --build`.
- **HTTP vs HTTPS**: `COOKIE_SECURE` defaults to `false` so login works over plain HTTP while
  testing. Behind an HTTPS reverse proxy, set `COOKIE_SECURE=true` and point `PUBLIC_BASE_URL`
  (and `MS_REDIRECT_URI`) at your real URL.
- **OneDrive**: set `MS_CLIENT_ID` / `MS_CLIENT_SECRET` (see *Connecting OneDrive*) and make sure
  the Azure app's redirect URI matches `MS_REDIRECT_URI`.

To build/run the image directly without compose:

```bash
docker build -t combinedstorage .
docker run --rm -p 4000:4000 -e COOKIE_SECURE=false -v combinedstorage-data:/data combinedstorage
```

### Behind a reverse proxy / Cloudflare Tunnel (HTTPS)

To serve the app at a public HTTPS hostname (e.g. `https://file.example.com` via `cloudflared`):

1. **Set `PUBLIC_BASE_URL`** to the public URL, e.g. `PUBLIC_BASE_URL=https://file.example.com`.
   The OAuth callback URLs are derived from it automatically
   (`https://file.example.com/api/oauth/onedrive/callback` and `…/google/callback`) — so leave
   `MS_REDIRECT_URI` / `GOOGLE_REDIRECT_URI` unset.
2. **Register those callback URLs** in the Azure app and the Google OAuth client (they must match
   exactly), and add the hostname to Google's *Authorized JavaScript origins* if prompted.
3. **Join the proxy's Docker network** so it can reach the container. The bundled
   `docker-compose.yml` attaches to an external network named `cloudflared-combinedstorage_default`
   and keeps the default network for outbound API calls; point the tunnel's ingress at
   `http://combinedstorage:4000`. Adjust the network name to match yours.
4. The app trusts `X-Forwarded-Proto` (`trust proxy` is on). Login works with `COOKIE_SECURE=false`
   over the tunnel; set `COOKIE_SECURE=true` to mark the cookie Secure (requires the proxy to
   forward `X-Forwarded-Proto: https`, which cloudflared does).

Because the app writes everything to the `/data` volume, connected accounts and files persist
across restarts and redeploys (only removing the `combinedstorage-data` volume wipes them).

## Configuration (`.env`)

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Server port | `4000` |
| `PUBLIC_BASE_URL` | Base URL used to build public CDN links | `http://localhost:4000` |
| `DATA_DIR` | SQLite DB + local blobs (relative to `server/`, or an absolute path) | `./data` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin login | `admin` / `changeme` |
| `SESSION_SECRET` | Signs the session cookie — set a long random value | _dev placeholder_ |
| `COOKIE_SECURE` | Require HTTPS for the session cookie | on when `NODE_ENV=production` |
| `AUTO_ALIAS_ON_UPLOAD` | Auto-generate a friendly alias for every upload | `false` |
| `DAV_ENABLED` | Serve the WebDAV drive at `/dav` | `true` |
| `DAV_USERNAME` / `DAV_PASSWORD` | Drive Basic-auth credentials | admin login |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | Azure app credentials (OneDrive) | _empty (OneDrive off)_ |
| `MS_TENANT` | `common` (personal + work/school) or a tenant id | `common` |
| `MS_REDIRECT_URI` | OAuth callback URL | `http://localhost:4000/api/oauth/onedrive/callback` |
| `MS_SCOPES` | Delegated Graph scopes | `Files.ReadWrite offline_access User.Read` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client (Google Drive) | _empty (off)_ |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | `http://localhost:4000/api/oauth/google/callback` |
| `GOOGLE_SCOPES` | Drive OAuth scopes | `…/auth/drive.file openid email` |

## Connecting OneDrive

OneDrive requires a free Azure app registration (you supply the credentials):

1. Go to the [Azure Portal](https://portal.azure.com) → **App registrations** → **New registration**.
2. **Redirect URI**: platform **Web**, value exactly your `MS_REDIRECT_URI`
   (`http://localhost:4000/api/oauth/onedrive/callback` for local dev).
3. Under **Certificates & secrets**, create a **client secret**.
4. Under **API permissions**, add **Microsoft Graph → Delegated**: `Files.ReadWrite`,
   `offline_access`, `User.Read`.
5. Put the **Application (client) ID** and the secret into `.env` as `MS_CLIENT_ID` /
   `MS_CLIENT_SECRET`, then restart the server.
6. In the app, open **Storage → Connect OneDrive**, sign in and consent. The account appears as a
   backend and its real quota is added to the combined pool.

Uploads that land on OneDrive are stored under a `CombinedStorage/` app folder; the app streams
them back out through the stable `/f/<token>` URL.

## Connecting Google Drive

Google Drive requires a free Google Cloud OAuth client (you supply the credentials):

1. In the [Google Cloud Console](https://console.cloud.google.com) create/select a project and
   **enable the "Google Drive API"** (APIs & Services → Library).
2. Configure the **OAuth consent screen** (External is fine for testing; add your Google account
   as a test user).
3. Create an **OAuth client ID** → application type **Web application**, with **Authorized redirect
   URI** exactly your `GOOGLE_REDIRECT_URI` (`http://localhost:4000/api/oauth/google/callback` for
   local dev).
4. Put the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, then
   restart the server.
5. In the app, open **Storage → Connect Google Drive**, sign in and consent. The account appears
   as a backend and its real quota joins the combined pool.

The default `drive.file` scope limits the app to files it creates in your Drive (least privilege);
uploads are streamed back out through the stable `/f/<token>` URL.

## Connecting multiple accounts

You can connect several accounts of the same type — every account's capacity adds to the combined
pool. Each **Connect** click shows an account picker, so pick **Use another account** to add a
different one. Reconnecting an account you've already added just refreshes its tokens (it is matched
by a stable account id, so it never creates a duplicate).

**"Need admin approval" (OneDrive work/school accounts).** Signing in with an organisation account
(e.g. `you@company.com`) can show a Microsoft *"Need admin approval"* screen. That is your
organisation's Azure AD consent policy blocking unverified third-party apps — the app cannot
override it. Options: use a **personal** Microsoft account instead; ask your Azure AD admin to grant
consent (the *"Have an admin account? Sign in"* link on that screen, or an admin-consent request);
or have the admin allow user consent for the app. Personal Microsoft accounts and Google accounts
do not hit this.

## Using files as a CDN

Every uploaded file gets an unguessable public URL: `GET {PUBLIC_BASE_URL}/f/<token>`. It requires
no login, sends `Cache-Control` and `ETag`, and supports `Range` requests — so it can back
`<img>`, `<video>`, downloads, etc. Use **Copy link** on any file in the UI.

### Friendly links (aliases)

Each file can also have a **friendly alias** that resolves at the same prefix, e.g.
`{PUBLIC_BASE_URL}/f/annual-report.pdf`. In the file list, **Friendly link** suggests a unique slug
from the filename (which you can edit) and saves it; **Edit link** changes or clears it afterwards.
The random token URL keeps working as a permanent fallback, so changing an alias never breaks the
token link. Aliases are globally unique; a suffix (`-2`, `-3`, …) is added if one is taken. Set
`AUTO_ALIAS_ON_UPLOAD=true` to give every uploaded file an alias automatically.

## Mount as a Windows drive (WebDAV)

The server exposes a **WebDAV endpoint at `/dav`** so the same unified storage can be mounted as a
Windows drive letter — browse and edit files in File Explorer, backed by the combined backends.

Recommended client is **rclone + WinFsp** (a real drive with on-demand caching, like OneDrive's Files
On-Demand). See [`clients/windows/`](clients/windows/README.md):

```powershell
powershell -ExecutionPolicy Bypass -File .\clients\windows\mount-combinedstorage.ps1 -Install -AtLogon
```

Details:

- The `/dav` endpoint uses **HTTP Basic auth** (separate from the web session). Credentials default to
  the admin login, or set `DAV_USERNAME` / `DAV_PASSWORD` for dedicated drive credentials; disable the
  endpoint with `DAV_ENABLED=false`.
- Editing a file from the drive **preserves its `/f/<token>` CDN link and friendly alias** (a PUT
  overwrite keeps the same file identity).
- Windows' built-in *Map network drive* to `https://…/dav` also works, but rclone+WinFsp is faster and
  avoids the built-in client's 50 MB limit.
- **Behind Cloudflare:** ensure the tunnel passes WebDAV methods (PROPFIND, MKCOL, MOVE, COPY, LOCK);
  and note Cloudflare's proxied request-body cap (~100 MB Free/Pro) limits large-file uploads through
  the tunnel.

## API overview

Management endpoints require the admin session cookie; `/f/:token` is public.

| Method & path | Description |
| --- | --- |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | Admin session |
| `GET /api/storage` | Combined + per-backend usage |
| `GET /api/files/:folderId` | List a folder (children + breadcrumb) |
| `POST /api/files/:parentId/folders` | Create a folder |
| `POST /api/files/:parentId/upload?name=…` | Upload (raw body = file bytes) |
| `PATCH /api/files/:id/rename` · `PATCH /api/files/:id/move` · `DELETE /api/files/:id` | Modify |
| `GET /api/files/:id/alias/suggest` · `PUT /api/files/:id/alias` · `DELETE /api/files/:id/alias` | Friendly link |
| `GET /api/admin/backends` · `POST /api/admin/backends/local` | Manage backends |
| `PATCH /api/admin/backends/:id` · `DELETE /api/admin/backends/:id` | Enable/disable, remove |
| `GET /api/oauth/onedrive/start` · `GET /api/oauth/google/start` → callbacks | Connect a cloud backend |
| `GET /f/:token` | Public file (CDN), supports Range |
| `PROPFIND/GET/PUT/MKCOL/DELETE/MOVE/COPY … /dav/*` | WebDAV drive (own Basic auth) |

## Testing

```bash
npm test        # Vitest: LocalProvider, placement engine, and files service
```

The suite runs entirely on local storage against a temporary SQLite database — no cloud
credentials needed.

## Project structure

```
server/   Express API, storage engine, SQLite metadata
  src/
    app.ts     builds the Express app     index.ts  starts it
    storage/   provider.ts (interface) · local.ts · onedrive.ts · googledrive.ts · registry.ts
    services/  placement.ts · files.ts · quota.ts · webdav.ts
    routes/    auth · files · admin · oauth · cdn · webdav
    models/    nodes.ts · backends.ts        db/  schema · migrate
  test/      Vitest suites
web/      React + Vite front end (Login / Files / Admin)
clients/windows/   rclone + WinFsp mount script for the Windows drive
```

## Adding another storage backend

1. Create `server/src/storage/<name>.ts` implementing `StorageProvider`.
2. Add a `case` for its `type` in `server/src/storage/registry.ts`.
3. Add a way to register it (an admin form and/or an OAuth flow, like `local` / `onedrive`).

That's the whole contract — placement, quota aggregation, the file tree, and CDN serving all work
through `StorageProvider` and need no changes.

## Scope & limitations (proof of concept)

- One file lives entirely on one backend (no striping a single file across backends).
- Single admin user; no multi-tenant accounts.
- No versioning/trash; files are public via an unguessable token (no per-file share controls).
- Uploads stream through the server (no direct browser-to-backend transfer).
