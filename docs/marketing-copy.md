# Marketing copy

Sales-page copy and homepage summary for Combined Storage. Claims are limited to features the app
ships today (no multi-user, S3 or encryption claims).

## Homepage summary

> **Combined Storage turns your local disks, OneDrive and Google Drive into a single drive with one
> file tree and one combined capacity, and puts each upload wherever there's room.** Every file
> gets a permanent shareable link with on-the-fly image resizing, and it all runs self-hosted on
> your own server.

Shorter alternative:

> **All your storage, one drive.** Combined Storage pools your local disks, OneDrive and Google
> Drive into a single self-hosted drive, with instant sharing links for every file.

---

## Sales page

# Combined Storage — Every drive you own, as one drive

### Stop juggling storage accounts

You've got space spread all over the place: a disk on your server, a OneDrive account, a Google
Drive with some room left. Each has its own app, its own limit and its own folder structure, and
none of them talk to each other.

**Combined Storage puts them together.** Connect your storage and you get one file tree and one
total capacity. A 1 GB local disk plus a 1 GB OneDrive shows up as 2 GB. You don't have to decide
where a file goes; it just goes somewhere with room.

### How it works

**Connect your storage.** You can add local disks and sign in to OneDrive and Google Drive from the
admin page. You can turn each one on or off, or remove it, whenever you like.

**Upload like it's one drive.** Drag and drop files in, and each upload goes to whichever connected
storage has the most free space. If everything is full, it tells you plainly instead of failing
quietly.

**Organise freely.** Renaming and moving files is instant, even with huge files. Your folder
structure is kept separately from where the files are actually stored, so nothing gets copied
between services when you tidy up.

### A file manager that feels like a desktop app

- **Bulk actions:** select many files at once, then delete, move, copy or generate links in one go.
- **Drag and drop** between folders, or between two side-by-side panes. Hold Ctrl to copy.
- **Built-in previews** for images, PDFs, video, audio and text, plus a thumbnail grid view.
- **Edit images inline** without downloading them.
- **Large uploads just work.** Big files are sent in chunks, so you won't hit upload size limits
  like Cloudflare's 100 MB cap.

### Your files, served like a CDN

Every file gets a permanent public link that keeps working even if the file ends up stored
somewhere else.

- **Friendly link names:** `/f/team-logo` reads better than a random string.
- **Images resized on the fly:** add `?w=800` or `?w=400&h=400` to a link to get exactly the size
  you need.
- **Optional WebP conversion** shrinks images as they're uploaded.
- **Fast, cache-friendly delivery** that lets people skip around in videos and audio without
  downloading the whole file.

### Use it as a Windows drive

Combined Storage can be mounted as a normal drive letter on Windows, so you can open, save and drag
files in File Explorer as if your pooled storage were plugged into your PC.

### You host it, you control it

Combined Storage runs on your own server from a single Docker container. Your file list stays in a
database you control, and your files stay in storage you already own. There's no extra
subscription or middleman, and no one else holding your data.

**One drive. All your space. Your server.**

**[Get started]**
