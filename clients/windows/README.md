# Combined Storage as a Windows drive

Mount your Combined Storage (the same unified tree you see in the web app) as a Windows drive
letter, using **rclone + WinFsp** over the server's WebDAV endpoint. Files download on open and are
cached locally — similar to OneDrive's Files On-Demand.

## Quick start

```powershell
# From this folder, in PowerShell:
powershell -ExecutionPolicy Bypass -File .\mount-combinedstorage.ps1 -Install
```

The script installs WinFsp + rclone (via winget), asks for your Combined Storage password, creates
the rclone remote, and mounts drive `Z:`. Add `-AtLogon` to also auto-mount at every logon.

Options:

```powershell
.\mount-combinedstorage.ps1 -BaseUrl https://file.amcmail.co.uk -User admin -DriveLetter Z -ChunkSize 50M -AtLogon
```

## Large files (and why chunking matters)

Uploads are **chunked**: rclone splits a big file into many small requests rather than one large
one. That matters when the server sits behind a proxy that caps request bodies — **Cloudflare
limits proxied uploads to ~100 MB** (Free/Pro; 200 MB on Business). With chunking, only the *chunk*
has to fit under that limit, so files of any size upload fine through the tunnel.

This is why the remote is configured with `vendor = nextcloud` (rclone only enables chunked uploads
for that vendor) and a `url` ending in `/remote.php/dav/files/<user>` (rclone derives the chunk
endpoint from that shape). The server implements the matching protocol.

- Tune with `-ChunkSize` (default `50M`). Keep it **below** your proxy's limit; larger chunks mean
  fewer requests and better throughput.
- Set `nextcloud_chunk_size = 0` in the remote to disable chunking (then the ~100 MB cap applies).
- The server stages chunks on disk while a large upload is in flight, so the server's `/data`
  volume needs transient free space roughly equal to the file being uploaded.

## Manual setup (equivalent to the script)

1. **Install prerequisites** (once):
   ```powershell
   winget install --id WinFsp.WinFsp -e
   winget install --id Rclone.Rclone -e
   ```
2. **Create the remote** (obscures the password, enables chunked uploads):
   ```powershell
   rclone config create combinedstorage webdav `
     url=https://file.amcmail.co.uk/remote.php/dav/files/admin `
     vendor=nextcloud user=admin pass="YOUR_PASSWORD" nextcloud_chunk_size=50M --obscure
   ```
   (Or copy `rclone.conf.template` into your `rclone.conf` and set an obscured `pass` from
   `rclone obscure "YOUR_PASSWORD"`.)
3. **Mount** as a drive:
   ```powershell
   rclone mount combinedstorage: Z: --vfs-cache-mode full --vfs-cache-max-age 168h --dir-cache-time 30s --network-mode --volname "Combined Storage"
   ```
   `Z:` now appears in File Explorer. Create, edit, and delete files there; changes flow into the
   combined storage (and the web app) and land on whichever backend has room.

## Notes

- **HTTPS is required** — the drive authenticates with HTTP Basic auth, which is only safe (and,
  for the built-in Windows client, only allowed) over TLS. The Cloudflare Tunnel already provides
  this at `https://file.amcmail.co.uk`.
- **Credentials**: the drive uses the Combined Storage login (or the dedicated `DAV_USERNAME` /
  `DAV_PASSWORD` if you set them on the server).
- **Edited files keep their links**: overwriting a file from the drive preserves its `/f/<token>`
  CDN link and any friendly alias.
- **Cloudflare**: make sure the tunnel passes WebDAV methods (PROPFIND, MKCOL, MOVE, COPY, LOCK).
  For the fastest transfers on a local network you can skip Cloudflare entirely and point
  `-BaseUrl` at the server's LAN address.
- The plain `/dav` endpoint still works for other WebDAV clients (including Windows' built-in *Map
  network drive*), but it does **not** chunk — rclone with `vendor=nextcloud` is the recommended path.
