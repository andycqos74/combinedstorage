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
  delete**, copy a file's public link, and give files **friendly link aliases**. Large uploads are
  chunked, so they are not limited by proxy request-body caps (e.g. Cloudflare's ~100 MB).
- **Multi-select** with bulk delete / move / copy / generate-links, **drag-and-drop** between
  folders and panes (Ctrl to copy), and an optional **two-pane** view.
- **Previews** for images, PDF, video, audio and text, **thumbnail grid view**, plus **inline
  image editing**.
- Optional **image conversion on upload** (resize + WebP) and **on-demand sizes** from the file
  URL (`?w=800`, `?w=400&h=400`) for CDN use.
- Combined storage meter across all connected backends.
- Admin page to **add local-disk backends** and **connect OneDrive / Google Drive**, enable/disable
  or remove them.
- Automatic upload placement (most-free-space first) with a clear "insufficient space" error.
- Public, cacheable file URLs with HTTP **Range** support (media seeking) and ETag/`304`.
- **Mount as a Windows drive** (WebDAV endpoint at `/dav`) via rclone + WinFsp.
- Collapsible sidebar with quick-access folders and per-backend usage, and a "stored on" column
  showing which backend physically holds each file.

## Interface

The UI follows the "Luggage" design: dark navy chrome (header and sidebar) around a light content
column. Everything visual is driven by CSS custom properties defined at the top of
`web/src/styles.css` — colours, radii, shadows and the two type families — so a retheme means
editing tokens rather than hunting through components. Two conventions worth knowing:

- **No inline styles for static values.** Inline `style` is used only where a value is genuinely
  dynamic (a meter's width, a backend's colour); everything else is a class.
- **File rows adapt to their pane, not the window.** `.pane` is a CSS container, so the row's
  "stored on" and size columns drop out and the action buttons wrap when the pane is narrow — which
  is what keeps two-pane mode usable at any window width.

Manrope is loaded from Google Fonts and Caslon Antique is self-hosted from `web/public/brand/`.
If the browser cannot reach Google Fonts the UI falls back to the system sans-serif stack.

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

### Deploying from a prebuilt image (Portainer, or any pull-based deploy)

`docker-compose.yml` **builds** the image from source, so a deploy tool that only knows how to
*pull* (e.g. Portainer's "Re-pull image") will fail with `pull access denied for combinedstorage` —
there is no such image in a registry.

For those, use **`docker-compose.ghcr.yml`**, which pulls a prebuilt image instead.
[`.github/workflows/publish-image.yml`](.github/workflows/publish-image.yml) builds and pushes to
GitHub Container Registry on every push, so the server never has to compile anything.

Each branch publishes **its own tag**, with slashes replaced by dashes, and `:latest` moves only on
the repository's default branch — so a push to a feature branch can never change what production
pulls. Select one with `IMAGE_TAG`:

```bash
IMAGE_TAG=latest docker compose -f docker-compose.ghcr.yml pull      # default branch
IMAGE_TAG=latest docker compose -f docker-compose.ghcr.yml up -d
```

In **Portainer**: point the stack at `docker-compose.ghcr.yml`, keep your environment variables as
they are, and use **Pull and redeploy** for every future update.

Two setup notes:

- **Package visibility.** New GHCR packages are private. Either make it public (GitHub → your
  profile → Packages → the package → Package settings → Change visibility), or add a GHCR
  credential under Portainer → Registries using a Personal Access Token with `read:packages`.
- **CPU architecture.** The workflow builds `linux/amd64`. If your Docker host is ARM (Raspberry
  Pi, ARM NAS), add `linux/arm64` to the `platforms:` list in the workflow.

### A second server for testing a branch (LAN, no Cloudflare)

Both compose files above attach to an **external** Cloudflare Tunnel network, which only exists on
the production host — on any other machine the deploy stops with `network
cloudflared-combinedstorage_default declared as external, but could not be found`.

Use **`docker-compose.test.yml`** there instead: no external network, its own container name and
volume, and it pulls the branch's prebuilt image rather than compiling anything. `IMAGE_TAG` is
required — with no default, a test box cannot silently end up running production's `:latest`.

```bash
curl -O https://raw.githubusercontent.com/andycqos74/combinedstorage/<branch>/docker-compose.test.yml
IMAGE_TAG=claude-ui-redesign-luggage PUBLIC_BASE_URL=http://192.168.1.50:4000 \
  docker compose -f docker-compose.test.yml up -d
```

Full walkthrough, including the Portainer *Repository* method and a troubleshooting table:
**[docs/deploy-test-server.md](docs/deploy-test-server.md)**.

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

The compose files read every setting via `${VAR:-default}` substitution, so values can come from a
`.env` file next to the compose file, from the shell, or from your deployment tool's environment
settings.

**Where to put real values in a deployment:**

- **Portainer:** set them on the **stack** (Stacks → your stack → *Environment variables*). They are
  stored with the stack definition and re-applied on every deploy, including *Pull and redeploy*.
  Values typed onto a *container* instead are lost as soon as the container is recreated, and
  deleting the stack discards them — use *Update the stack* rather than recreating it.
- **Plain Docker host:** keep a `.env` beside the compose file (`chmod 600`), which Compose picks up
  automatically. This keeps secrets out of any UI database.
- **Never** put real credentials in `.env.example` — it is committed to the repository. It is a
  template of variable *names* only.

Back up whatever you set: OAuth client secrets live only where you configured them, and losing them
means regenerating the credentials in Azure / Google Cloud.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Server port | `4000` |
| `PUBLIC_BASE_URL` | Base URL used to build public CDN links | `http://localhost:4000` |
| `DATA_DIR` | SQLite DB + local blobs (relative to `server/`, or an absolute path) | `./data` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin login | `admin` / `changeme` |
| `SESSION_SECRET` | Signs the session cookie — set a long random value | _dev placeholder_ |
| `COOKIE_SECURE` | Require HTTPS for the session cookie | on when `NODE_ENV=production` |
| `AUTO_ALIAS_ON_UPLOAD` | Auto-generate a friendly alias for every upload | `false` |
| `UPLOAD_CHUNK_MB` | Chunk size (MB) the web UI uses for large uploads | `32` |
| `IMAGE_CONVERT_ON_UPLOAD` | Resize/re-encode uploaded images (**replaces the file**) | `false` |
| `IMAGE_MAX_DIMENSION` / `IMAGE_FORMAT` / `IMAGE_QUALITY` | Conversion rule | `2560` / `webp` / `82` |
| `IMAGE_MAX_CONVERT_MB` | Images above this stream through unconverted | `50` |
| `IMAGE_CONVERT_ON_DRIVE` | Also convert writes from the Windows drive | `true` |
| `IMAGE_VARIANTS_ENABLED` | Serve `?w=…&fmt=…` renditions from the file URL | `true` |
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

**Caching:** because a file's URL stays the same when its content is replaced (editing an image,
or saving over it from the Windows drive), the endpoint sends `Cache-Control: public, no-cache`
with a **version-aware `ETag`**. Caches may store the file but must revalidate, which is cheap —
an unchanged file answers `304` with no body — and an edit changes the `ETag` immediately, so
clients never serve a stale copy from a URL that still looks the same.

### Friendly links (aliases)

Each file can also have a **friendly alias** that resolves at the same prefix, e.g.
`{PUBLIC_BASE_URL}/f/annual-report.pdf`. In the file list, **Friendly link** suggests a unique slug
from the filename (which you can edit) and saves it; **Edit link** changes or clears it afterwards.
The random token URL keeps working as a permanent fallback, so changing an alias never breaks the
token link. Aliases are globally unique; a suffix (`-2`, `-3`, …) is added if one is taken. Set
`AUTO_ALIAS_ON_UPLOAD=true` to give every uploaded file an alias automatically.

## Previews and image editing

Clicking a file name opens a **preview**: images, PDFs, video, audio and text/code render inline.
Video and audio seek correctly because the file endpoint supports HTTP Range. Anything else offers
a download.

Images can be **edited in place** from the preview (or the *Edit* action in the list):

- **Basic** (default) uses [Filerobot](https://github.com/scaleflex/filerobot-image-editor), bundled
  with the app — crop, rotate, flip, resize, filters and annotations. It runs entirely in your
  browser from your own server, so it works offline and involves no third party. The editor is
  code-split, so it is only downloaded the first time you edit an image.
- **Advanced** switches to [Photopea](https://www.photopea.com), a Photoshop-class editor with
  layers, masks and PSD support. It is a **third-party iframe** loaded from photopea.com, and the
  free version shows ads. Your image is processed in your browser and the bytes are handed to the
  frame via `postMessage` — the app never gives out your file URLs. It needs internet access.

Saving **replaces the file in place, keeping its id, CDN token and friendly alias**, so links you
have already shared keep working and now serve the edited image. Photopea also offers *Save as
copy*.

## Image conversion and on-demand sizes

Two independent features, both powered by [sharp](https://sharp.pixelplumbing.com/).

### Convert on upload (optional, saves disk)

With `IMAGE_CONVERT_ON_UPLOAD=true`, uploaded images are auto-oriented from EXIF, scaled so the
longest edge is at most `IMAGE_MAX_DIMENSION` (default 2560), re-encoded to `IMAGE_FORMAT`
(default WebP), and stripped of metadata. A 4000×3000 JPEG typically drops by **90%+**.

- **This replaces the stored file and the original is not kept**, so it is **off by default** —
  enabling it is a deliberate choice, and an upgrade never silently rewrites your data.
- The extension changes with the format (`photo.jpg` → `photo.webp`), and the name is
  de-duplicated if that collides.
- Skipped automatically for: non-images, **SVG** (vector) and **GIF** (animation), files above
  `IMAGE_MAX_CONVERT_MB`, and any image where re-encoding would come out *larger*.
- Conversion runs before backend placement, so quota and placement see the real stored size.
- It applies to the Windows drive too. Because that renames the file after a write, which sync
  clients do not expect, set `IMAGE_CONVERT_ON_DRIVE=false` to keep the drive byte-exact while
  still converting web uploads.

### On-demand sizes (non-destructive, great for CDN use)

Any stored image can be requested at a different size or format by adding query parameters to its
public URL — the original is untouched and renditions are rendered once then cached on disk:

```
/f/<handle>?w=800                 # 800px wide
/f/<handle>?w=400&h=400           # 400×400, cropped to fill
/f/<handle>?w=300&h=300&fit=inside  # fits inside 300×300, aspect preserved
/f/<handle>?w=800&fmt=jpeg&q=70   # different format/quality
```

`fit=cover` (the default) crops to fill, which is what fixed-ratio uses need — a 16:9 slider is
`?w=1920&h=1080`, a square thumbnail is `?w=400&h=400`. Variants never upscale. The cache key
includes the file's content version, so editing an image invalidates its renditions automatically,
and unused ones are swept after 30 days. Disable with `IMAGE_VARIANTS_ENABLED=false`.

> Named presets (`?preset=slider`) are a natural next step on top of this — the query form above is
> already the underlying mechanism.

The file browser uses this too: switch a folder to **grid view** (the list/grid toggle in the pane
header) to see image thumbnails instead of a list. Thumbnails are 320px square crops served from the
same variant endpoint, so they are rendered once and cached rather than downloading full-size
images. The choice of list or grid is remembered.

## Mount as a Windows drive (WebDAV)

The server exposes a **WebDAV endpoint at `/dav`** so the same unified storage can be mounted as a
Windows drive letter — browse and edit files in File Explorer, backed by the combined backends.

Recommended client is **rclone + WinFsp** (a real drive with on-demand caching, like OneDrive's Files
On-Demand). See [`clients/windows/`](clients/windows/README.md):

```powershell
powershell -ExecutionPolicy Bypass -File .\clients\windows\mount-combinedstorage.ps1 -Install -AtLogon
```

Details:

- The endpoint uses **HTTP Basic auth** (separate from the web session). Credentials default to the
  admin login, or set `DAV_USERNAME` / `DAV_PASSWORD` for dedicated drive credentials; disable it
  with `DAV_ENABLED=false`.
- Editing a file from the drive **preserves its `/f/<token>` CDN link and friendly alias** (a PUT
  overwrite keeps the same file identity).
- **Large files are chunked.** The server also implements the Nextcloud chunked-upload protocol at
  `/remote.php/dav/{files,uploads}/<user>`, which rclone uses when the remote is configured with
  `vendor = nextcloud`. Each chunk is a separate small request, so uploads are not limited by
  proxy request-body caps — notably **Cloudflare's ~100 MB limit** (Free/Pro; 200 MB Business).
  Chunks are staged under `DATA_DIR/chunks` and assembled on completion, so the data volume needs
  transient free space roughly equal to the file being uploaded.
- Windows' built-in *Map network drive* to `https://…/dav` also works, but rclone+WinFsp is faster,
  avoids the built-in client's 50 MB limit, and is the only path that chunks large uploads.
- **Behind Cloudflare:** ensure the tunnel passes WebDAV methods (PROPFIND, MKCOL, MOVE, COPY, LOCK).

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
| `… /remote.php/dav/files/:user/*` · `/remote.php/dav/uploads/:user/*` | Same drive, Nextcloud-shaped, with chunked uploads |

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
web/      React + Vite front end
  src/       pages/ (Login · Files · Admin) · components/ · styles.css (design tokens)
  public/brand/   wordmark logo and typeface
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
