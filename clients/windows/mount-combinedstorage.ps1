<#
.SYNOPSIS
  Mount Combined Storage as a Windows drive via rclone + WinFsp (WebDAV).

.DESCRIPTION
  Installs WinFsp + rclone (optional), creates an rclone WebDAV remote for the Combined Storage
  /dav endpoint, and mounts it as a drive letter with on-demand VFS caching (files download on
  open and are cached locally, similar to OneDrive Files On-Demand).

.EXAMPLE
  # First time (installs tools, prompts for password, mounts Z:)
  powershell -ExecutionPolicy Bypass -File .\mount-combinedstorage.ps1 -Install

.EXAMPLE
  # Mount and also auto-mount at every logon
  .\mount-combinedstorage.ps1 -AtLogon
#>
param(
  [string]$Url = "https://file.amcmail.co.uk/dav",
  [string]$User = "admin",
  [string]$Password,
  [string]$DriveLetter = "Z",
  [string]$RemoteName = "combinedstorage",
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

Write-Host "Creating rclone remote '$RemoteName' -> $Url" -ForegroundColor Cyan
# --obscure stores the password in rclone's obscured form (not plaintext).
rclone config create $RemoteName webdav url="$Url" vendor=other user="$User" pass="$Password" --obscure | Out-Null

# Quick connectivity check.
Write-Host "Checking connection..." -ForegroundColor Cyan
rclone lsd "${RemoteName}:" | Out-Null
Write-Host "Connected." -ForegroundColor Green

$mountArgs = @(
  "mount", "${RemoteName}:", "${DriveLetter}:",
  "--vfs-cache-mode", "full",
  "--vfs-cache-max-age", "168h",
  "--dir-cache-time", "30s",
  "--network-mode",
  "--volname", "Combined Storage"
)

if ($AtLogon) {
  # Register a hidden Scheduled Task that mounts the drive at logon (persists like OneDrive).
  $rclone = (Get-Command rclone).Source
  $action = New-ScheduledTaskAction -Execute $rclone -Argument ($mountArgs -join " ")
  $trigger = New-ScheduledTaskTrigger -AtLogon
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
  Register-ScheduledTask -TaskName "Mount Combined Storage" -Action $action -Trigger $trigger `
    -Settings $settings -Force | Out-Null
  Write-Host "Registered logon task 'Mount Combined Storage'. It will mount ${DriveLetter}: at each logon." -ForegroundColor Green
  Write-Host "Mounting now..." -ForegroundColor Cyan
  Start-Process -FilePath $rclone -ArgumentList ($mountArgs -join " ") -WindowStyle Hidden
} else {
  Write-Host "Mounting ${DriveLetter}: (leave this window open; Ctrl+C to unmount)..." -ForegroundColor Cyan
  & rclone @mountArgs
}
