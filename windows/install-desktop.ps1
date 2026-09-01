#requires -Version 7.4

<#
.SYNOPSIS
Replace every earlier-named copy of this product with the freshly built one.

.DESCRIPTION
The product has shipped under three names -- Agent Kanban, Agent Hub, Valkama --
and each rename changed the NSIS appId. A new installer therefore lands *beside*
the previous copy instead of over it: the old executable, its Start Menu entry
and its uninstaller all stay, and only the current name matches the path the
tray opens. That is the whole reason installing is not one click.

This performs the exchange. It reads what is actually registered under HKCU
rather than guessing paths, stops anything running out of those directories,
runs each stale copy's own registered silent uninstaller, and then installs the
artifact electron-builder produced for the name in desktop/package.json. A copy
already carrying the current name is left for the installer to upgrade in place.

Nothing is removed unless it is both registered under one of this product's own
names and installed in one of this product's own directories under
%LOCALAPPDATA%\Programs. Anything else is reported and left alone.

-WhatIf shows the whole plan without touching the machine. Rollback is the
previous installer, which is still in desktop/release/.

.EXAMPLE
.\install-desktop.ps1 -Build
Rebuild the installer, remove the older-named copies, install the new one.

.EXAMPLE
.\install-desktop.ps1 -WhatIf
Print what would happen and change nothing.
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    # Run `npm run dist` first. Required whenever the desktop sources are newer
    # than the artifact, because shipping the previous binary is exactly the
    # failure this script exists to stop.
    [switch]$Build,
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

# This script lives in `windows/`; the Electron app it installs is a sibling
# directory one level up.
$RepositoryRoot = Split-Path $PSScriptRoot -Parent
$DesktopRoot = Join-Path $RepositoryRoot "desktop"
$ReleaseRoot = Join-Path $DesktopRoot "release"
$ProgramsRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Programs"))
$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"

# Every name this product has shipped under. A rename is finished when the
# runtime agrees, and this list is the runtime remembering the names it must
# still be able to clean up. Add the outgoing name here in the same commit that
# changes productName.
$FormerProducts = @("Agent Hub", "Agent Kanban")
$FormerDirectories = @("agent-hub-desktop", "agent-kanban-desktop")

$package = Get-Content (Join-Path $DesktopRoot "package.json") -Raw | ConvertFrom-Json
$CurrentProduct = $package.build.productName
$CurrentDirectory = $package.name
$OwnDirectories = @($CurrentDirectory) + $FormerDirectories
$AllProducts = @($CurrentProduct) + $FormerProducts
$Installer = Join-Path $ReleaseRoot "$CurrentProduct Setup $($package.version).exe"
$InstalledExe = Join-Path $ProgramsRoot $CurrentDirectory "$CurrentProduct.exe"

function Write-Step([string]$Message) {
    Write-Host "==> $Message"
}

function Write-Detail([string]$Message) {
    Write-Host "    $Message"
}

function Split-Command([string]$CommandLine) {
    <# An uninstall string is one quoted path followed by its switches. #>
    if ($CommandLine -match '^\s*"([^"]+)"\s*(.*)$') {
        return @($Matches[1], $Matches[2].Trim())
    }
    $parts = $CommandLine -split "\s+", 2
    $rest = ""
    if ($parts.Count -gt 1) { $rest = $parts[1] }
    return @($parts[0], $rest)
}

function Test-OwnDirectory([string]$Directory) {
    # Two conditions, both required: it lives directly under Programs, and its
    # folder is one this product installs into. A display name alone is not
    # enough to start deleting things.
    if (-not $Directory) { return $false }
    $full = [IO.Path]::GetFullPath($Directory)
    if ([IO.Path]::GetDirectoryName($full) -ne $ProgramsRoot) { return $false }
    return [IO.Path]::GetFileName($full) -in $OwnDirectories
}

function Get-RegisteredCopies {
    <# Every per-user install that is provably a copy of this product. #>
    $found = @()
    foreach ($key in Get-ChildItem $UninstallKey -ErrorAction SilentlyContinue) {
        $entry = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
        if (-not $entry.DisplayName -or -not $entry.UninstallString) { continue }
        $product = $AllProducts | Where-Object {
            $entry.DisplayName -eq $_ -or $entry.DisplayName -like "$_ *"
        } | Select-Object -First 1
        if (-not $product) { continue }
        $uninstaller = (Split-Command $entry.UninstallString)[0]
        $directory = Split-Path $uninstaller -Parent
        if (-not (Test-OwnDirectory $directory)) {
            Write-Verbose "skipping '$($entry.DisplayName)': $directory is not one of this product's directories"
            continue
        }
        $quiet = $entry.QuietUninstallString
        if (-not $quiet) { $quiet = "$($entry.UninstallString) /S" }
        $found += [pscustomobject]@{
            Product     = $product
            DisplayName = $entry.DisplayName
            Directory   = [IO.Path]::GetFullPath($directory)
            Quiet       = $quiet
            Key         = $key.PSPath
            IsCurrent   = $product -eq $CurrentProduct
        }
    }
    return $found
}

function Wait-For([scriptblock]$Condition) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $Condition) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Stop-CopyProcesses([string]$Directory) {
    # Win32_Process rather than Get-Process: reading .Path on a process this
    # user cannot open raises Access Denied, and $ErrorActionPreference is Stop,
    # so one unrelated protected process would abort the whole install.
    $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($Directory, [StringComparison]::OrdinalIgnoreCase)
    }
    foreach ($process in $running) {
        $label = "$($process.Name) (PID $($process.ProcessId))"
        if ($PSCmdlet.ShouldProcess($label, "stop, so the uninstaller is not blocked")) {
            Write-Detail "stopping $label"
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Remove-StaleShortcut([string]$Product) {
    # The uninstaller normally takes its own shortcut. This catches the one it
    # leaves behind, and only when the shortcut still points into a directory
    # this product owns.
    $path = Join-Path $StartMenu "$Product.lnk"
    if (-not (Test-Path -LiteralPath $path)) { return }
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($path).TargetPath
    if (-not (Test-OwnDirectory (Split-Path $target -Parent))) {
        Write-Detail "leaving '$Product.lnk': it points at $target, which is not ours"
        return
    }
    if ($PSCmdlet.ShouldProcess($path, "remove the leftover Start Menu shortcut")) {
        Remove-Item -LiteralPath $path -Force
        Write-Detail "removed the leftover Start Menu shortcut"
    }
}

function Remove-Residue([string]$Directory) {
    if (-not (Test-Path -LiteralPath $Directory)) { return }
    if (-not (Test-OwnDirectory $Directory)) { return }
    # Only a directory that still looks like that install, so a name collision
    # cannot turn this into a recursive delete of something else.
    $looksInstalled =
        (Test-Path -LiteralPath (Join-Path $Directory "resources")) -or
        (Get-ChildItem -LiteralPath $Directory -Filter "Uninstall *.exe" -ErrorAction SilentlyContinue)
    if (-not $looksInstalled) {
        Write-Warning "left $Directory alone: it survived the uninstaller but no longer looks like an install"
        return
    }
    if ($PSCmdlet.ShouldProcess($Directory, "remove the directory the uninstaller left behind")) {
        Remove-Item -LiteralPath $Directory -Recurse -Force
        Write-Detail "removed the leftover directory"
    }
}

function Test-InstallerIsCurrent {
    <# The artifact must be newer than the sources it packages. #>
    if (-not (Test-Path -LiteralPath $Installer)) { return $false }
    $built = (Get-Item -LiteralPath $Installer).LastWriteTimeUtc
    $sources = Get-ChildItem -LiteralPath $DesktopRoot -File |
        Where-Object { $_.Extension -in ".js", ".json" -and $_.Name -ne "package-lock.json" }
    foreach ($source in $sources) {
        if ($source.LastWriteTimeUtc -gt $built) {
            Write-Detail "$($source.Name) is newer than the installer"
            return $false
        }
    }
    return $true
}

Write-Step "Product: $CurrentProduct $($package.version)  ->  $InstalledExe"

if ($Build) {
    if ($PSCmdlet.ShouldProcess($DesktopRoot, "npm run dist")) {
        Write-Step "Building the installer"
        Push-Location $DesktopRoot
        try {
            npm run dist
            if ($LASTEXITCODE -ne 0) { throw "npm run dist failed with exit code $LASTEXITCODE" }
        }
        finally {
            Pop-Location
        }
    }
}

if (-not (Test-Path -LiteralPath $Installer)) {
    throw "no installer at $Installer -- run this with -Build"
}
if (-not (Test-InstallerIsCurrent) -and -not $Build) {
    throw "the installer is older than the desktop sources it packages -- run this with -Build"
}
Write-Step "Installer: $Installer ($([int]((Get-Item -LiteralPath $Installer).Length / 1MB)) MB, built $((Get-Item -LiteralPath $Installer).LastWriteTime))"

$copies = @(Get-RegisteredCopies)
$stale = @($copies | Where-Object { -not $_.IsCurrent })
$current = @($copies | Where-Object { $_.IsCurrent })

if ($copies.Count -eq 0) {
    Write-Step "Nothing of this product is installed yet"
}
else {
    Write-Step "Installed now: $(($copies | ForEach-Object { $_.DisplayName }) -join ', ')"
}
foreach ($copy in $current) {
    Write-Detail "keeping '$($copy.DisplayName)' -- the installer upgrades it in place"
}

foreach ($copy in $stale) {
    Write-Step "Removing '$($copy.DisplayName)' from $($copy.Directory)"
    Stop-CopyProcesses $copy.Directory
    $command, $arguments = Split-Command $copy.Quiet
    if ($PSCmdlet.ShouldProcess($copy.DisplayName, "run its registered silent uninstaller")) {
        Write-Detail "$command $arguments"
        if ($arguments) {
            Start-Process -FilePath $command -ArgumentList ($arguments -split "\s+") -Wait
        }
        else {
            Start-Process -FilePath $command -Wait
        }
        # An NSIS uninstaller copies itself to TEMP and re-executes, so the
        # process we waited on exiting proves nothing. The registry entry going
        # away does.
        $gone = Wait-For { -not (Test-Path -LiteralPath $copy.Key) }
        if (-not $gone) {
            throw "'$($copy.DisplayName)' is still registered after $TimeoutSeconds seconds"
        }
        Write-Detail "unregistered"
        Remove-Residue $copy.Directory
    }
    Remove-StaleShortcut $copy.Product
}

Write-Step "Installing $CurrentProduct $($package.version)"
if ($PSCmdlet.ShouldProcess($Installer, "run silently")) {
    Start-Process -FilePath $Installer -ArgumentList "/S" -Wait
    if (-not (Wait-For { Test-Path -LiteralPath $InstalledExe })) {
        throw "the installer finished but $InstalledExe never appeared"
    }
}

if ($WhatIfPreference) {
    Write-Step "Nothing was changed (-WhatIf)"
    return
}

Write-Step "Checking the result"
$problems = @()

if (Test-Path -LiteralPath $InstalledExe) {
    Write-Detail "installed: $InstalledExe"
}
else {
    $problems += "$InstalledExe is missing"
}

# The tray opens one hardcoded default. If this script installs anywhere else,
# the icon silently falls back to a browser -- which is how the last two renames
# were noticed, months late.
$tray = Join-Path $PSScriptRoot "tray.ps1"
if (Test-Path -LiteralPath $tray) {
    $default = ([regex]::Match((Get-Content $tray -Raw), '\$AppPath = "([^"]+)"')).Groups[1].Value
    # A plain substitution, never ExpandString: this text comes out of a file,
    # and expanding it would make reading that file a way to run code.
    $expanded = $default.Replace('$env:LOCALAPPDATA', $env:LOCALAPPDATA)
    if ([IO.Path]::GetFullPath($expanded) -ne [IO.Path]::GetFullPath($InstalledExe)) {
        $problems += "the tray opens '$expanded', which is not where this installed"
    }
    else {
        Write-Detail "the tray's default path matches"
    }
}

$left = @(Get-RegisteredCopies | Where-Object { -not $_.IsCurrent })
if ($left.Count -gt 0) {
    $problems += "still registered: $(($left | ForEach-Object { $_.DisplayName }) -join ', ')"
}
else {
    Write-Detail "no older-named copy is left"
}

foreach ($product in $FormerProducts) {
    if (Test-Path -LiteralPath (Join-Path $StartMenu "$product.lnk")) {
        $problems += "the Start Menu still has '$product.lnk'"
    }
}

if ($problems.Count -gt 0) {
    foreach ($problem in $problems) { Write-Warning $problem }
    exit 1
}
Write-Step "Done. $CurrentProduct $($package.version) is the only copy installed."
