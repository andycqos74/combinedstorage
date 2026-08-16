# Deploying a test stack on a second Docker server

Goal: run a **branch** of this repo on a separate Docker host, reachable on the LAN by IP, while
the existing server keeps running production. No Cloudflare, no DNS, no TLS.

Use **`docker-compose.test.yml`** for this. It pulls a prebuilt image from GHCR — nothing is
compiled on the test server — and unlike the production compose files it does not require the
Cloudflare Tunnel network to exist. See [Why the stack was failing](#why-the-stack-was-failing) if
you want the reasoning before the steps.

---

## Step 1 — Pick the branch, and its image tag

Every branch publishes its own image tag: the branch name with `/` replaced by `-`.

| Branch | `IMAGE_TAG` |
| --- | --- |
| `claude/ui-redesign-luggage` — the new "Luggage" interface | `claude-ui-redesign-luggage` |
| `claude/multi-storage-file-system-j1pfg2` — default branch, same build as `:latest` | `claude-multi-storage-file-system-j1pfg2` |

The package is **public**, so the test server does not need to log in to GHCR.

`IMAGE_TAG` has no default: leaving it unset stops the deploy with an explicit error rather than
quietly starting production's image on your test box.

## Step 2 — Find the test server's LAN IP

On the test server:

```bash
hostname -I | awk '{print $1}'      # e.g. 192.168.1.50
```

Write it down. It goes into `PUBLIC_BASE_URL`, and getting it wrong is the single most common
cause of "the app loads but every image is broken" — file links, thumbnails and previews are all
built from that value.

## Step 3 — Deploy

### Option A — Portainer, Web editor (recommended)

Because this stack only *pulls* an image, Portainer never needs to read the repository. Using the
Web editor avoids Git refs, private-repo tokens and their failure modes entirely — the branch you
run is decided by `IMAGE_TAG`, not by which branch Portainer cloned.

1. **Stacks → Add stack**, name it `combinedstorage-test`.
2. Build method: **Web editor**.
3. Paste the contents of [`docker-compose.test.yml`](../docker-compose.test.yml).
4. Under **Environment variables**, add (see [Step 4](#step-4--the-variables-that-matter)):

   | Name | Value |
   | --- | --- |
   | `IMAGE_TAG` | `claude-ui-redesign-luggage` |
   | `PUBLIC_BASE_URL` | `http://192.168.1.50:4000` — your IP, with the port |
   | `ADMIN_PASSWORD` | something other than `changeme` |
   | `SESSION_SECRET` | a long random string |
   | `COOKIE_SECURE` | `false` |

5. **Deploy the stack.** It pulls roughly 110 MB and starts in well under a minute.

To update later: **Pull and redeploy**, ticking *Re-pull image*. CI rewrites the branch tag on every
push to that branch, so re-pulling gets the newest build. To test a different branch, change
`IMAGE_TAG` and redeploy.

### Option A2 — Portainer, Repository method

Only needed if you want Portainer to track the compose file itself in Git. The **Repository
reference** field wants a *full ref*, not a bare branch name:

```
refs/heads/claude/ui-redesign-luggage
```

Entering `claude/ui-redesign-luggage` fails with:

```
Unable to fetch git repository id: could not find ref "claude/ui-redesign-luggage" in the repository
```

Set Repository URL to `https://github.com/andycqos74/combinedstorage`, compose path to
`docker-compose.test.yml`, and — if the repo is private — turn on **Authentication** with a GitHub
personal access token (classic: `repo` scope; fine-grained: *Contents: Read*) as the password. Then
add the same environment variables as Option A.

### Option B — Shell

```bash
mkdir -p ~/combinedstorage-test && cd ~/combinedstorage-test
curl -O https://raw.githubusercontent.com/andycqos74/combinedstorage/claude/ui-redesign-luggage/docker-compose.test.yml

cat > .env <<'EOF'
IMAGE_TAG=claude-ui-redesign-luggage
PUBLIC_BASE_URL=http://192.168.1.50:4000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=pick-something-better
SESSION_SECRET=paste-a-long-random-string-here
COOKIE_SECURE=false
EOF

docker compose -f docker-compose.test.yml up -d
```

Generate a secret with `openssl rand -hex 32`.

To update: `docker compose -f docker-compose.test.yml pull && docker compose -f docker-compose.test.yml up -d`.

To switch which branch the test server runs, change `IMAGE_TAG` and redeploy — no re-clone needed.

### Option C — Build from source instead

Only needed if the host is **ARM** (Raspberry Pi, ARM NAS): CI publishes `linux/amd64` only, so a
pull there fails with `no matching manifest for linux/arm64`. Either add `linux/arm64` to the
`platforms:` list in `.github/workflows/publish-image.yml`, or build locally:

```bash
git clone -b claude/ui-redesign-luggage https://github.com/andycqos74/combinedstorage.git
cd combinedstorage
PUBLIC_BASE_URL=http://192.168.1.50:4000 docker compose up --build -d
```

Note that `docker-compose.yml` attaches to the Cloudflare Tunnel network — remove both `networks:`
blocks from it first, or it will fail with the external-network error described below.

## Step 4 — The variables that matter

Defaults for everything else are in `docker-compose.test.yml`; these five decide whether it works.

| Variable | Set it to | What breaks otherwise |
| --- | --- | --- |
| `IMAGE_TAG` | the branch tag from [Step 1](#step-1--pick-the-branch-and-its-image-tag) | Deploy stops with `required variable IMAGE_TAG is missing a value` |
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
   `combinedstorage:latest`, which exists only on the machine that built it — a pull-based deploy
   looks for it on Docker Hub and fails. Only the two files with a full `ghcr.io/...` image
   reference (`docker-compose.ghcr.yml`, `docker-compose.test.yml`) can be deployed by pulling.

One thing to know regardless of which option you pick: **the repository has no `main` branch.** Its
default is `claude/multi-storage-file-system-j1pfg2`, which is what `:latest` and therefore
production tracks. If you want a frozen production line, create `main` from the current production
commit and deploy prod from `IMAGE_TAG=main`; otherwise every push to the default branch becomes
production's next `:latest`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `network ... declared as external, but could not be found` | Used a production compose file | Use `docker-compose.test.yml` |
| `could not find ref "claude/..." in the repository` | Portainer's *Repository reference* needs a full ref | Use `refs/heads/claude/...`, or switch to the Web editor (Option A) |
| `authentication required` / `repository not found` cloning in Portainer | Private repo, no credentials | Enable **Authentication** with a PAT, or use the Web editor |
| `required variable IMAGE_TAG is missing a value` | `IMAGE_TAG` not set | Set it to the branch tag — this guard is deliberate |
| `manifest unknown` | Tag does not exist | Check the tag spelling; CI must have run on that branch at least once |
| `pull access denied for combinedstorage` | Pull-based deploy of a build-only compose file | Use `docker-compose.test.yml`, not `docker-compose.yml` |
| `denied` / `unauthorized` pulling from ghcr.io | Package turned private | Make it public again, or `docker login ghcr.io` with a `read:packages` token |
| `no matching manifest for linux/arm64` | ARM host, amd64-only image | Option C, or add `linux/arm64` to `platforms:` in the workflow |
| Sign-in does nothing, no error | `COOKIE_SECURE=true` over plain HTTP | Set `COOKIE_SECURE=false` |
| UI loads, images and thumbnails broken | `PUBLIC_BASE_URL` wrong or still `localhost` | Set it to `http://<LAN-IP>:<PORT>` and redeploy |
| Redeploy runs the old build | Image not re-pulled | Tick *Re-pull image*, or `docker compose -f docker-compose.test.yml pull` first |
| Container restarts repeatedly | Read the reason first | `docker logs combinedstorage-test --tail 50` |
| Port already in use | 4000 taken | Set `PORT=4100` **and** match `PUBLIC_BASE_URL` |
