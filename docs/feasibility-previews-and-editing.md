# Feasibility: previews/thumbnails, Office editing, image editing

An assessment of three proposed features against the current codebase. Nothing here is built yet —
this is the research and recommendation.

**Summary:** all three are feasible. Previews are nearly free because the CDN endpoint already does
the hard parts. Image editing is a day's work with an off-the-shelf React component. Thumbnails need
one native dependency. Office editing is the only genuinely large one, needing a second container
and a protocol implementation.

| Feature | Effort | New dependencies | Verdict |
| --- | --- | --- | --- |
| File previews (lightbox) | ~0.5 day | none | Do first |
| Inline image editing | ~1 day | `react-filerobot-image-editor` | Strong value |
| Thumbnails (grid view) | ~1–2 days | `sharp` | Worth it for photos |
| Inline Office editing | ~2–4 days | Collabora **or** OnlyOffice container | Biggest; do last |

---

## 1. Previews and thumbnails

### Previews — easy, no server work

The existing `/f/<token>` endpoint already provides everything a browser needs to render a file
inline: correct `Content-Type`, `Content-Length`, `ETag`/`Cache-Control`, and — critically —
**HTTP Range support**, which is what makes `<video>` seeking work. So previewing is a pure
front-end change: a modal that switches on the file's MIME type.

| Type | How | Server work |
| --- | --- | --- |
| Images (png/jpg/webp/gif/svg) | `<img src={url}>` | none |
| PDF | `<iframe src={url}>` (browsers have built-in viewers) | none |
| Video (mp4/webm) | `<video controls>` — needs Range, which we have | none |
| Audio | `<audio controls>` | none |
| Text / markdown / code | `fetch` + `<pre>` | none |
| Office, archives, unknown | icon + Download button | none |

**Effort: ~half a day**, entirely in `web/src`. Highest value-per-effort of anything here.

### Thumbnails — moderate, one native dependency

A grid/gallery view needs *small* images; serving full-size originals and scaling with CSS would
waste bandwidth badly (a folder of 5 MB photos would download 5 MB each).

- Add **[`sharp`](https://sharp.pixelplumbing.com/)** for resizing. It ships prebuilt binaries for
  linux-x64/glibc, and our image is `node:22-bookworm-slim`, so it needs no build toolchain (~10 MB).
- New endpoint `GET /f/:token/thumb?w=256`: on first request, stream the original from its backend
  via the existing `openFile()`, resize to WebP, **cache to `DATA_DIR/thumbs/`**, and serve from
  cache thereafter. Caching matters a lot when the file lives on OneDrive/Google Drive — otherwise
  every grid render re-downloads from the cloud.
- Front end: a list/grid toggle on `FilePane`.

**One gotcha to handle:** a WebDAV/drive overwrite deliberately *keeps* the file's `public_token`
(so links survive edits), which means the token alone is **not** a safe cache key. Key the thumbnail
on `token + updated_at`, or delete cached thumbs in `updateFileBlob()`.

Video thumbnails would need `ffmpeg` and PDF thumbnails `poppler`/`pdfium` — both meaningfully fatten
the image. I'd skip those initially and fall back to a type icon.

---

## 2. Inline Office editing (Word / Excel / PowerPoint)

This is the big one. Rendering and editing OOXML in a browser is not something to hand-roll; the
realistic options are two self-hostable document servers that run as a **second container** next to
the app.

### Option A — Collabora Online (CODE)

- **Licence:** MPL 2.0, fully open source, **no user/connection cap** on the community edition.
- **Integration:** the **WOPI** protocol (an open standard). We implement a *WOPI host*:
  - `CheckFileInfo` — return name, size, version, permissions
  - `GetFile` — return the bytes (wraps existing `openFile()`)
  - `PutFile` — save the edited bytes back
  - plus signed, expiring access tokens scoped to one file
- Then embed Collabora's editor in an iframe pointed at our WOPI endpoints.

### Option B — OnlyOffice Docs Community

- **Licence:** AGPL v3, **capped at 20 concurrent connections** — irrelevant for a single-user
  deployment, but a wall if this ever becomes multi-user.
- **Integration:** their `DocsAPI` JS component plus one **callback URL** on our server that receives
  the saved document. Slightly less surface area than WOPI.
- **Fidelity:** uses OOXML natively, so `.docx`/`.xlsx` round-trip more faithfully than Collabora's
  LibreOffice core — the usual reason people pick it.

### Option C — Microsoft Office for the web

Not available: hosting your own storage behind Office on the web requires being a **Microsoft Cloud
Storage Partner**. However, there is a cheap partial win — for files that physically live on a
connected **OneDrive** backend, the Graph item exposes a `webUrl` that opens the real Office web
editor. That's roughly a one-field change, but it only works for OneDrive-backed files, and edits
would happen outside our metadata (size/mtime would go stale until refreshed).

### What we already have

The storage side is genuinely ready: `openFile()` streams bytes for `GetFile`, and
`writeFileAtPath()` already does an in-place overwrite that **preserves the node id, `public_token`
and alias** — so saving from an Office editor would not break a document's CDN or friendly link.
That was built for the WebDAV drive and applies here unchanged.

### Costs to weigh

- **Resources:** both document servers want roughly 1–2 GB RAM. On a small VPS that is the dominant
  cost of this feature.
- **Effort:** ~2–4 days for Collabora/WOPI, ~2–3 for OnlyOffice, including the compose changes and
  reverse-proxy/tunnel routing for the editor container.

**Recommendation:** OnlyOffice if `.docx` fidelity matters most and it stays single-user; Collabora
if licence cleanliness and no user cap matter more. Either way, do it **after** the cheaper wins.

---

## 3. Inline image editing

Very feasible, and the best effort-to-value ratio after previews.

- **[`react-filerobot-image-editor`](https://github.com/scaleflex/filerobot-image-editor)** (Scaleflex,
  open source) is a drop-in React component covering crop, resize, rotate, flip, filters, annotate
  and watermark — comfortably more than "basic editing".
- Flow: open the modal with `src={/f/<token>}` → user edits → the component returns a canvas
  `Blob` → upload it through the **existing chunked upload API**, either overwriting the original
  (which preserves its links) or saving as a new file.
- **No CORS/canvas-tainting problem**, because the image is served from the same origin as the app.

**Effort: ~1 day**, almost entirely front-end.

---

## Recommended order

1. **Previews** — half a day, no dependencies, immediately useful.
2. **Image editing** — one day, one dependency, self-contained.
3. **Thumbnails** — adds `sharp` and a thumbnail cache; do alongside a grid view.
4. **Office editing** — a separate container and a protocol implementation; schedule deliberately.
