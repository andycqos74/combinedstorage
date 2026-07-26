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
.\mount-combinedstorage.ps1 -Url https://file.amcmail.co.uk/dav -User admin -DriveLetter Z -AtLogon
```

## Manual setup (equivalent to the script)

1. **Install prerequisites** (once):
   ```powershell
   winget install --id WinFsp.WinFsp -e
   winget install --id Rclone.Rclone -e
   ```
2. **Create the remote** (obscures the password):
   ```powershell
   rclone config create combinedstorage webdav url=https://file.amcmail.co.uk/dav vendor=other user=admin pass="YOUR_PASSWORD" --obscure
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
- **Large files / Cloudflare**: uploads pass through Cloudflare, which caps proxied request bodies
  (~100 MB on Free/Pro plans). Files larger than that will fail to upload through the tunnel — use a
  higher Cloudflare plan or a direct/LAN path for very large files.
- **Edited files keep their links**: overwriting a file from the drive preserves its `/f/<token>`
  CDN link and any friendly alias.
- Built-in Windows "Map network drive" to `https://file.amcmail.co.uk/dav` also works, but rclone +
  WinFsp is faster and far more reliable (no 50 MB limit, better caching).
