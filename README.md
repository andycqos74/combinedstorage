# Combined Storage

An online storage system that presents **several independent storage backends as one unified
drive**. Connect a local disk and a OneDrive account (with more provider types to come) and the
web app shows a single file tree and a single, combined capacity — a 1 GB local quota plus a
1 GB OneDrive appears as 2 GB. Uploads are placed automatically on whichever backend has room,
and every file is reachable at a stable public URL so the system also works as a CDN.

> Proof of concept: single admin user, backends = **local disk + OneDrive**. The architecture is
> built so adding Google Drive, S3, etc. is "one new provider file + one admin form".

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
   ├─ storage/    StorageProvider ── local.ts · onedrive.ts (Microsoft Graph)
   └─ db/         SQLite metadata (tree + backend registry)
```

## Features

- File manager: browse folders, **create folder, upload (drag-and-drop or picker), rename,
  delete**, copy a file's public link.
- Combined storage meter across all connected backends.
- Admin page to **add local-disk backends** and **connect OneDrive**, enable/disable or remove them.
- Automatic upload placement (most-free-space first) with a clear "insufficient space" error.
- Public, cacheable file URLs with HTTP **Range** support (media seeking) and ETag/`304`.

## Tech stack

Node.js + TypeScript · Express · better-sqlite3 · @azure/msal-node (OneDrive OAuth) · React + Vite.

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

## Configuration (`.env`)

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Server port | `4000` |
| `PUBLIC_BASE_URL` | Base URL used to build public CDN links | `http://localhost:4000` |
| `DATA_DIR` | Where the SQLite DB and local blobs live (relative to `server/`) | `./data` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin login | `admin` / `changeme` |
| `SESSION_SECRET` | Signs the session cookie — set a long random value | _dev placeholder_ |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | Azure app credentials (OneDrive) | _empty (OneDrive off)_ |
| `MS_TENANT` | `common` (personal + work/school) or a tenant id | `common` |
| `MS_REDIRECT_URI` | OAuth callback URL | `http://localhost:4000/api/oauth/onedrive/callback` |
| `MS_SCOPES` | Delegated Graph scopes | `Files.ReadWrite offline_access User.Read` |

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

## Using files as a CDN

Every uploaded file gets an unguessable public URL: `GET {PUBLIC_BASE_URL}/f/<token>`. It requires
no login, sends `Cache-Control` and `ETag`, and supports `Range` requests — so it can back
`<img>`, `<video>`, downloads, etc. Use **Copy link** on any file in the UI.

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
| `GET /api/admin/backends` · `POST /api/admin/backends/local` | Manage backends |
| `PATCH /api/admin/backends/:id` · `DELETE /api/admin/backends/:id` | Enable/disable, remove |
| `GET /api/oauth/onedrive/start` → callback | Connect OneDrive |
| `GET /f/:token` | Public file (CDN), supports Range |

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
    storage/   provider.ts (interface) · local.ts · onedrive.ts · registry.ts
    services/  placement.ts · files.ts · quota.ts
    routes/    auth · files · admin · oauth · cdn
    models/    nodes.ts · backends.ts        db/  schema · migrate
  test/      Vitest suites
web/      React + Vite front end (Login / Files / Admin)
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
