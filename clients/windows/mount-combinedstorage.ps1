<#
.SYNOPSIS
  Mount Combined Storage as a Windows drive via rclone + WinFsp (WebDAV).

.DESCRIPTION
  Installs WinFsp + rclone (optional), creates an rclone WebDAV remote for the Combined Storage
  server, and mounts it as a drive letter with on-demand VFS caching (files download on open and
  are cached locally, similar to OneDrive Files On-Demand).

  The remote is configured with vendor=nextcloud so rclone uploads large files in chunks. That
  keeps every HTTP request small, so files of any size upload cleanly through proxies that cap
  request bodies (e.g. Cloudflare's ~100 MB limit).

.EXAMPLE
  # First time (installs tools, prompts for password, mounts Z:)
  powershell -ExecutionPolicy Bypass -File .\mount-combinedstorage.ps1 -Install

.EXAMPLE
  # Mount and also auto-mount at every logon
  .\mount-combinedstorage.ps1 -AtLogon
#>
param(
  [string]$BaseUrl = "https://file.amcmail.co.uk",
  [string]$User = "admin",
  [string]$Password,
  [string]$DriveLetter = "Z",
  [string]$RemoteName = "combinedstorage",
  # Upload chunk size. Must stay below any proxy request-body limit in front of the server
  # (Cloudflare Free/Pro = 100M, Business = 200M).
  [string]$ChunkSize = "50M",
  [switch]$Install,   # install WinFsp + rclone via winget first
  [switch]$AtLogon    # register a Scheduled Task to auto-mount at logon
)

$ErrorActionPreference = "Stop"

function Test-Command($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

if ($Install) {
  Write-Host "Installing WinFsp and rclone via winget (may prompt for admin)..." -ForegroundColor Cyan
  winget install --id WinFsp.WinFsp -e --accept-source-agreements --accept-package-agreements
  winget install --id Rclone.Rclone -e --accept-source-agreements --accept-package-agreements
  # rclone may have landed on PATH only for new shells; refresh this session's PATH.
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path", "User")
}

if (-not (Test-Command rclone)) {
  throw "rclone not found. Re-run with -Install, or install rclone and WinFsp manually, then retry."
}

if (-not $Password) {
  $secure = Read-Host "Combined Storage password for user '$User'" -AsSecureString
  $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

# rclone only enables chunked uploads for vendor=nextcloud, and it derives the chunk endpoint
# from an endpoint URL of the form <prefix>/dav/files/<user>. The server serves that shape.
$davUrl = "$($BaseUrl.TrimEnd('/'))/remote.php/dav/files/$User"

Write-Host "Creating rclone remote '$RemoteName' -> $davUrl" -ForegroundColor Cyan
# --obscure stores the password in rclone's obscured form (not plaintext).
rclone config create $RemoteName webdav `
  url="$davUrl" `
  vendor=nextcloud `
  user="$User" `
  pass="$Password" `
  nextcloud_chunk_size="$ChunkSize" `
  --obscure | Out-Null

# Quick connectivity check.
Write-Host "Checking connection..." -ForegroundColor Cyan
rclone lsd "${RemoteName}:" | Out-Null
Write-Host "Connected (uploads chunked at $ChunkSize)." -ForegroundColor Green

$rclonePath = (Get-Command rclone).Source
$logDir = Join-Path $env:LOCALAPPDATA "CombinedStorage"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir "rclone-mount.log"

$mountArgs = @(
  "mount", "${RemoteName}:", "${DriveLetter}:",
  "--vfs-cache-mode", "full",
  "--vfs-cache-max-age", "168h",
  "--dir-cache-time", "30s",
  "--network-mode",
  "--volname", "Combined Storage",
  "--log-file", $logFile,
  "--log-level", "INFO"
)

# When the args are passed as one command line (Start-Process / Scheduled Task), any argument
# containing a space must stay quoted — otherwise e.g. --volname "Combined Storage" would be
# split into two arguments and rclone would fail to start.
$mountArgLine = ($mountArgs | ForEach-Object {
  if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
}) -join ' '

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Register-AutoMount {
  # Preferred: a Scheduled Task (hidden, robust) — but registering one requires elevation.
  if (Test-Admin) {
    try {
      $action = New-ScheduledTaskAction -Execute $rclonePath -Argument $mountArgLine
      $trigger = New-ScheduledTaskTrigger -AtLogon
      $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
      Register-ScheduledTask -TaskName "Mount Combined Storage" -Action $action -Trigger $trigger `
        -Settings $settings -Force -ErrorAction Stop | Out-Null
      Write-Host "Auto-mount registered as scheduled task 'Mount Combined Storage'." -ForegroundColor Green
      return
    } catch {
      Write-Warning "Could not register the scheduled task ($($_.Exception.Message)). Falling back to the Startup folder."
    }
  }

  # Fallback: a shortcut in the user's Startup folder. Needs no admin rights.
  try {
    $startup = [Environment]::GetFolderPath('Startup')
    $linkPath = Join-Path $startup "Mount Combined Storage.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = $rclonePath
    $link.Arguments = $mountArgLine
    $link.WindowStyle = 7   # minimized
    $link.Description = "Mount Combined Storage as drive ${DriveLetter}:"
    $link.Save()
    Write-Host "Auto-mount registered via Startup shortcut: $linkPath" -ForegroundColor Green
  } catch {
    Write-Warning "Could not set up auto-mount: $($_.Exception.Message)"
    Write-Host "You can still mount manually by re-running this script without -AtLogon." -ForegroundColor Yellow
  }
}

if ($AtLogon) {
  Register-AutoMount
  Write-Host "Mounting ${DriveLetter}: in the background..." -ForegroundColor Cyan
  Start-Process -FilePath $rclonePath -ArgumentList $mountArgLine -WindowStyle Hidden

  # The mount runs hidden, so confirm it actually came up rather than assuming success.
  $ready = $false
  foreach ($i in 1..20) {
    Start-Sleep -Milliseconds 750
    if (Test-Path "${DriveLetter}:\") { $ready = $true; break }
  }
  if ($ready) {
    Write-Host "Drive ${DriveLetter}: is mounted. Open it in File Explorer." -ForegroundColor Green
  } else {
    Write-Warning "Drive ${DriveLetter}: did not appear. Check the log: $logFile"
    Write-Host "Tip: run the mount in the foreground to see errors live:" -ForegroundColor Yellow
    Write-Host "  rclone $mountArgLine" -ForegroundColor Yellow
  }
} else {
  Write-Host "Mounting ${DriveLetter}: (leave this window open; Ctrl+C to unmount)..." -ForegroundColor Cyan
  Write-Host "Log: $logFile" -ForegroundColor DarkGray
  & rclone @mountArgs
}
