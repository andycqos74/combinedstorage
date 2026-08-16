# Deploying a test stack on a second Docker server

Goal: run a **branch** of this repo on a separate Docker host, reachable on the LAN by IP, while
the existing server keeps running production. No Cloudflare, no DNS, no TLS.

Use **`docker-compose.test.yml`** for this. It exists because the production compose files cannot
start on a fresh host — see [Why the stack was failing](#why-the-stack-was-failing) if you want the
reasoning before the steps.

---

## Step 1 — Pick the branch

| Branch | What it is |
| --- | --- |
| `claude/multi-storage-file-system-j1pfg2` | Default branch. This is what `:latest` — and therefore production — is built from. |
| `claude/ui-redesign-luggage` | The new "Luggage" interface. |

Everything below uses `<BRANCH>` for whichever you chose.

## Step 2 — Find the test server's LAN IP

On the test server:

```bash
hostname -I | awk '{print $1}'      # e.g. 192.168.1.50
```

Write it down. It goes into `PUBLIC_BASE_URL`, and getting it wrong is the single most common
cause of "the app loads but every image is broken" — file links, thumbnails and previews are all
built from that value.

## Step 3 — Deploy

### Option A — Portainer (recommended)

1. **Stacks → Add stack**, name it `combinedstorage-test`.
2. Build method: **Repository**.
3. Repository URL: `https://github.com/andycqos74/combinedstorage`
4. Repository reference: `refs/heads/<BRANCH>` ← *this is the part that pins it to the branch*
5. Compose path: `docker-compose.test.yml`
6. If the repo is private, turn on **Authentication** and supply a GitHub personal access token
   with `repo` scope as the password.
7. Under **Environment variables**, add (see [Step 4](#step-4--the-variables-that-matter)):

   | Name | Value |
   | --- | --- |
   | `PUBLIC_BASE_URL` | `http://192.168.1.50:4000` — your IP, with the port |
   | `ADMIN_PASSWORD` | something other than `changeme` |
   | `SESSION_SECRET` | a long random string |
   | `COOKIE_SECURE` | `false` |

8. **Deploy the stack.** The first deploy compiles the app, so expect roughly 3–6 minutes with no
   output. Subsequent deploys reuse Docker's layer cache and are much faster.

To update later: **Pull and redeploy** (tick *Re-pull image and redeploy*). Portainer re-clones the
branch and rebuilds.

### Option B — Shell

```bash
git clone -b <BRANCH> https://github.com/andycqos74/combinedstorage.git
cd combinedstorage

cat > .env <<'EOF'
PUBLIC_BASE_URL=http://192.168.1.50:4000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=pick-something-better
SESSION_SECRET=paste-a-long-random-string-here
COOKIE_SECURE=false
EOF

docker compose -f docker-compose.test.yml up -d --build
```

Generate a secret with `openssl rand -hex 32`.

To update: `git pull && docker compose -f docker-compose.test.yml up -d --build`.

### Option C — Pull a prebuilt image instead of building

Only worth it if builds on the test box are slow. Every branch publishes its own tag (slashes
become dashes), so `claude/ui-redesign-luggage` → `:claude-ui-redesign-luggage`.

Take `docker-compose.ghcr.yml`, **delete both `networks:` blocks** (the service-level list and the
top-level `tunnel:` definition), then:

```bash
IMAGE_TAG=claude-ui-redesign-luggage docker compose -f docker-compose.ghcr.yml up -d
```

Two prerequisites: the GHCR package must be public or the host must be logged in
(`docker login ghcr.io` with a token carrying `read:packages`), and the host must be x86-64 — the
workflow only builds `linux/amd64`. Building from source (A or B) sidesteps both.

## Step 4 — The variables that matter

Defaults for everything else are in `docker-compose.test.yml`; these four decide whether it works.

| Variable | Set it to | What breaks otherwise |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://<LAN-IP>:4000`, no trailing slash | UI loads, but thumbnails/previews/copied links all point at `localhost` and 404 for everyone else |
| `COOKIE_SECURE` | `false` | Sign-in fails with no error — the browser drops a `Secure` cookie sent over plain HTTP |
| `ADMIN_PASSWORD` | anything but `changeme` | `/dav` and the admin UI are open to your LAN on the default password |
| `SESSION_SECRET` | 32+ random chars | Sessions are signed with a publicly known string |

If port 4000 is taken on that host, add `PORT=4100` and use `http://<LAN-IP>:4100` for
`PUBLIC_BASE_URL` — the two must agree.

## Step 5 — Verify

```bash
curl -s http://192.168.1.50:4000/api/health        # -> {"ok":true}
docker logs combinedstorage-test --tail 20         # -> "server listening on ..."
```

Then in a browser on another machine (not the server itself — that is what catches a wrong
`PUBLIC_BASE_URL`):

1. Open `http://192.168.1.50:4000` and sign in.
2. **Storage → Add local disk storage**, name it, give it a quota, add it.
3. **Files →** upload an image.
4. Switch to grid view. If the thumbnail renders, `PUBLIC_BASE_URL` is right.
5. **Copy link** on the file and open it in a new tab. It should serve the image.

## Step 6 — Keep prod and test apart

They are already isolated: different hosts, and the test stack uses its own container name
(`combinedstorage-test`) and volume (`combinedstorage-test-data`), so even on one host they cannot
collide. Two things to be careful of:

- **Do not point both at the same OneDrive/Google account** — both would write into the same
  provider folder.
- Cloud backends generally **cannot** be connected on the test stack: Microsoft and Google reject
  plain-HTTP LAN addresses as OAuth redirect URIs. Test with local-disk backends.

---

## Why the stack was failing

Three separate problems, all of which bite a fresh second host:

1. **The external network.** `docker-compose.yml` and `docker-compose.ghcr.yml` both end with:

   ```yaml
   networks:
     tunnel:
       name: cloudflared-combinedstorage_default
       external: true
   ```

   `external: true` means *this network already exists, do not create it*. It exists on the
   production host because the cloudflared stack made it. On a new host it does not, so the deploy
   stops before starting a container:

   ```
   network cloudflared-combinedstorage_default declared as external, but could not be found
   ```

   `docker-compose.test.yml` has no external network at all.

2. **Both servers were pulling the same tag.** The publish workflow tagged `:latest` from the
   default branch *and* `main`, so `docker-compose.ghcr.yml` gave prod and test identical images —
   pointing the test server at a branch would have had no effect. Each branch now publishes its own
   tag, and `:latest` only moves on the default branch.

3. **`pull access denied for combinedstorage`.** `docker-compose.yml` builds an image named
   `combinedstorage:latest` that exists only on the machine that built it. A pull-based deploy
   looks for it on Docker Hub and fails. Build from source (Options A/B) or pull a real GHCR tag
   (Option C) — do not mix the two.

One thing to know regardless of which option you pick: **the repository has no `main` branch.** Its
default is `claude/multi-storage-file-system-j1pfg2`, which is what `:latest` and therefore
production tracks. If you want a frozen production line, create `main` from the current production
commit and deploy prod from `IMAGE_TAG=main`; otherwise every push to the default branch becomes
production's next `:latest`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `network ... declared as external, but could not be found` | Used a production compose file | Use `docker-compose.test.yml` |
| `pull access denied for combinedstorage` | Pull-based deploy of a build-only compose file | Use `docker-compose.test.yml` (builds), or Option C |
| `denied` / `unauthorized` pulling from ghcr.io | Package is private | Make it public, or `docker login ghcr.io` with a `read:packages` token |
| `no matching manifest for linux/arm64` | ARM host, amd64-only image | Build from source, or add `linux/arm64` to `platforms:` in the workflow |
| Sign-in does nothing, no error | `COOKIE_SECURE=true` over plain HTTP | Set `COOKIE_SECURE=false` |
| UI loads, images and thumbnails broken | `PUBLIC_BASE_URL` wrong or still `localhost` | Set it to `http://<LAN-IP>:<PORT>` and redeploy |
| Container restarts repeatedly | Read the reason first | `docker logs combinedstorage-test --tail 50` |
| Build fails on `better-sqlite3` | Out of RAM or disk during native compile | Free space, or use Option C |
| Port already in use | 4000 taken | Set `PORT=4100` **and** match `PUBLIC_BASE_URL` |
