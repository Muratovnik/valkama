#requires -Version 7.4

<#
.SYNOPSIS
Tray icon that lives exactly as long as one Valkama MCP session.

.DESCRIPTION
Started through the managed launcher when an agent opens an MCP session, so the
icon is present precisely while an agent is holding Valkama, and gone when
nobody is. Clicking it opens Valkama. Windows Forms ships with .NET, so this
needs nothing installed.

Liveness is the session mutex named by -SessionMutex, which the owning MCP
process holds for its lifetime. It is deliberately per-session and not the
shared icon mutex: watching the shared one left this icon up when a different
session claimed it, which showed the user two icons.

A click always ends in something the owner can see. This surface has failed the
same way twice -- once when ELECTRON_RUN_AS_NODE made the app exit without a
window, once when a rebuilt front end left the running server on its startup
snapshot and the identity check refused it -- and both times the only trace was
a line in a log file nobody reads, so the icon looked frozen. The decision is
therefore a pure function of runtime, ownership and app availability; the
effect is separate, and anything that is not an opened window is said out loud.

When the desktop app is installed, a click starts it and that is all: the app
opens its window at once and owns every server decision, the stale-server
question and its restart included. This script used to run the same checks
first, synchronously on the icon's thread, which held the click for seconds,
queued a second click behind it, and let two deciders read the port at
different moments of one startup -- a click during startup was offered a
restart of the server the app had just started. Only without the app does this
script decide anything, and then off the icon's thread.

-PrintPlan resolves that decision from supplied identities and prints it,
touching no network and no process, which is what tests/test_tray_contract.py
drives. -SelfTest performs a real open and prints the outcome.
#>

[CmdletBinding(DefaultParameterSetName = "Run")]
param(
    [Parameter(Mandatory = $true, ParameterSetName = "Run")][string]$IconPath,
    [Parameter(Mandatory = $true, ParameterSetName = "Run")][string]$SessionMutex,
    [Parameter(Mandatory = $true, ParameterSetName = "SelfTest")][switch]$SelfTest,
    [Parameter(Mandatory = $true, ParameterSetName = "Plan")][switch]$PrintPlan,
    [Parameter(Mandatory = $true, ParameterSetName = "Launcher")][switch]$PrintLauncher,
    [Parameter(ParameterSetName = "Plan")][string]$ExpectedJson = "",
    [Parameter(ParameterSetName = "Plan")][string]$ListenerJson = "",
    [Parameter(ParameterSetName = "Plan")]
    [ValidateSet("free", "managed", "foreign", "unavailable")]
    [string]$ListenerOwner = "free",
    # A switch, not a [bool]: `pwsh -File` hands every argument over as a string
    # and [bool]"false" is $true, so a bool here would silently answer the wrong
    # half of the table for the caller that matters most, the test.
    [Parameter(ParameterSetName = "Plan")][switch]$AppExists,
    [string]$AppPath = "$env:LOCALAPPDATA\Programs\valkama-desktop\Valkama.exe",
    [string]$LauncherDirectory = "$env:LOCALAPPDATA\Valkama\bin",
    [int]$Port = 8642
)

$ErrorActionPreference = "Stop"
$LogPath = Join-Path $env:TEMP "valkama-tray.log"
$script:Busy = $false
$script:LastClickAt = [DateTime]::MinValue
$script:Notify = $null
# A click this soon after the last one handled is the same click: a double
# click, or one that queued while a dialog was up. The app focuses its window
# on a second start anyway, so swallowing it loses nothing.
$ClickQuietMilliseconds = 1500
# A refused loopback connect costs Windows its whole SYN retry, about two
# seconds; a live listener accepts in well under one millisecond.
$ConnectTimeoutMilliseconds = 300
# What the off-thread worker dot-sources to get these same functions.
$TrayScriptPath = $PSCommandPath

# VS Code exports this to every child process, and it makes an Electron
# executable run as plain Node: the app would start and vanish without a
# window. Valkama must open for whoever launched the agent.
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

function Write-TrayLog([string]$Message) {
    # Shared for writing: several trays and the desktop app can be writing the
    # temp directory at once, and a line lost to a sharing violation is how a
    # log ends up with an "icon up" and no "icon down".
    $line = "$([DateTime]::UtcNow.ToString('o')) tray[$PID] $Message`n"
    $bytes = [Text.Encoding]::UTF8.GetBytes($line)
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        try {
            $stream = [IO.File]::Open($LogPath, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
            try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
            return
        }
        catch [IO.IOException] {
            Start-Sleep -Milliseconds 20
        }
    }
}

function New-TrayResult([string]$Outcome, [string]$Message, [string]$Steps = "") {
    # `opened` is the only silent outcome. `stale` is a refusal a restart can
    # lift; `starting` means the port is changing hands and a moment will
    # settle it; `failed` is everything else, and all three are spoken.
    return [pscustomobject]@{ outcome = $Outcome; message = $Message; steps = $Steps }
}

function Test-SamePath([string]$Left, [string]$Right) {
    if (-not $Left -or -not $Right) { return $false }
    return [IO.Path]::GetFullPath($Left).Equals(
        [IO.Path]::GetFullPath($Right),
        [StringComparison]::OrdinalIgnoreCase)
}

function Get-ManagedLauncher {
    if (-not [IO.Path]::IsPathFullyQualified($LauncherDirectory)) {
        throw "the managed launcher directory must be an absolute path"
    }
    $manifestPath = Join-Path $LauncherDirectory "valkama-launcher.json"
    $commandPath = Join-Path $LauncherDirectory "valkama.cmd"
    $shimPath = Join-Path $LauncherDirectory "valkama-launcher.py"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "the managed launcher is missing at $LauncherDirectory; run 'python valkama.py launcher install' from the current checkout"
    }
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    }
    catch {
        throw "the managed launcher manifest is malformed at $manifestPath"
    }
    if ($manifest.schema_version -ne 1 -or $manifest.platform -ne "nt") {
        throw "the managed launcher manifest has an unsupported schema or platform"
    }
    foreach ($path in @($commandPath, $shimPath)) {
        $name = Split-Path $path -Leaf
        $owned = $manifest.files.PSObject.Properties[$name]
        if ($null -eq $owned -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "managed launcher file is missing: $name"
        }
        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne ([string]$owned.Value).ToLowerInvariant()) {
            throw "managed launcher file was modified: $name"
        }
    }
    if (-not [IO.Path]::IsPathFullyQualified([string]$manifest.python) -or
        -not (Test-Path -LiteralPath $manifest.python -PathType Leaf)) {
        throw "the Python interpreter recorded by the managed launcher is missing"
    }
    if (-not [IO.Path]::IsPathFullyQualified([string]$manifest.source_script) -or
        -not (Test-Path -LiteralPath $manifest.source_script -PathType Leaf)) {
        throw "the source recorded by the managed launcher is missing; reinstall the launcher from the current checkout"
    }
    $raw = & $manifest.python $shimPath "launcher" "status" "--directory" $LauncherDirectory 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "the managed launcher could not verify its status"
    }
    $status = ($raw -join "`n") | ConvertFrom-Json
    $pathsMatch =
        (Test-SamePath $status.directory $LauncherDirectory) -and
        (Test-SamePath $status.command $commandPath) -and
        (Test-SamePath $status.shim $shimPath) -and
        (Test-SamePath $status.manifest $manifestPath) -and
        (Test-SamePath $status.python $manifest.python) -and
        (Test-SamePath $status.source_script $manifest.source_script)
    if ($status.state -ne "installed" -or -not $status.source_available -or -not $pathsMatch) {
        throw "managed launcher status does not match its verified manifest; reinstall it from the current checkout"
    }
    return [pscustomobject]@{
        Python = [string]$status.python
        Shim = [string]$status.shim
        SourceScript = [string]$status.source_script
    }
}

function Invoke-ManagedLauncherJson($Launcher, [string[]]$Arguments) {
    $raw = @(& $Launcher.Python $Launcher.Shim @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        $detail = (($raw | ForEach-Object { [string]$_ }) -join "`n").Trim()
        if (-not $detail) {
            $detail = "the managed launcher command failed: $($Arguments -join ' ')"
        }
        throw "$detail`nNo process was stopped. Inspect the reported port owner yourself or choose another port, then try again."
    }
    return (($raw | ForEach-Object { [string]$_ }) -join "`n") | ConvertFrom-Json
}

function Get-ExpectedRuntime($Launcher) {
    $payload = Invoke-ManagedLauncherJson $Launcher @("runtime")
    if ($payload.interface_version -ne "runtime" -or [string]$payload.identity -notmatch '^[0-9a-f]{64}$') {
        throw "the managed launcher returned a malformed runtime identity"
    }
    return $payload
}

function Get-ListenerOwnership($Launcher) {
    return Invoke-ManagedLauncherJson $Launcher @(
        "launcher", "listener", "status", "--directory", $LauncherDirectory, "--port", [string]$Port)
}

function Stop-ManagedListener($Launcher) {
    return Invoke-ManagedLauncherJson $Launcher @(
        "launcher", "listener", "stop", "--directory", $LauncherDirectory, "--port", [string]$Port)
}

function Get-ListenerRuntime {
    # The connect is held to a short timeout of its own: nothing listening is
    # the common case here, and Windows takes about two seconds to report a
    # refused loopback connect.
    $handler = [Net.Http.SocketsHttpHandler]::new()
    $handler.ConnectTimeout = [TimeSpan]::FromMilliseconds($ConnectTimeoutMilliseconds)
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    try {
        $response = $client.GetAsync("http://127.0.0.1:$Port/api/runtime").GetAwaiter().GetResult()
        # An HTTP error proves that something owns the port; do not treat an
        # older listener with no runtime endpoint as an unused port.
        $unreadable = [pscustomobject]@{ interface_version = ""; identity = "" }
        if (-not $response.IsSuccessStatusCode) { return $unreadable }
        $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        try { $payload = $text | ConvertFrom-Json } catch { return $unreadable }
        if ($null -eq $payload -or $payload -isnot [pscustomobject]) { return $unreadable }
        return $payload
    }
    catch {
        return $null
    }
    finally {
        $client.Dispose()
    }
}

function Test-RuntimeMatch($Expected, $Actual) {
    return $null -ne $Actual -and
        $Actual.interface_version -eq "runtime" -and
        [string]$Expected.identity -eq [string]$Actual.identity
}

function Get-StaleReason($Expected, $Actual) {
    # Name the half that drifted. A bare "identity differs" is what made this
    # unreadable: the owner cannot tell a rebuilt front end from changed server
    # code, and only one of those is usually theirs to expect.
    $parts = @()
    if ([string]$Expected.static.sha256 -ne [string]$Actual.static.sha256) {
        $parts += "a newer front end has been built since it started"
    }
    if ([string]$Expected.backend.sha256 -ne [string]$Actual.backend.sha256) {
        $parts += "its server code has changed since it started"
    }
    if ($parts.Count -eq 0) {
        $parts += "its runtime identity no longer matches the managed launcher source"
    }
    return "The running Valkama server is out of date: $($parts -join '; ')."
}

function Resolve-OpenPlan($Expected, $Listener, [string]$Ownership, [bool]$AppIsInstalled) {
    <#
    The whole decision, as a pure function of runtime, ownership and app
    availability. Six actions:

      open-app          the app is installed; it decides everything else itself
      open-browser      no app is installed, so the page opens in a browser
      start-server      nothing is listening and there is no app to start one
      in-transition     the two readings disagree: the port is changing hands
      restart-required  a managed server is stale and may be stopped safely
      refuse            managed launcher ownership could not be proven

    `restart-required` is separate from `refuse` on purpose: only one of them
    has a remedy this script may carry out, and stopping a stranger's process
    is never that remedy. `in-transition` is separate from both: an answer
    from a port the table calls free, or a managed owner that has not answered
    yet, is what a server starting or stopping looks like between two reads,
    and neither a refusal nor a restart is the right answer to it.
    #>
    if ($AppIsInstalled) {
        return [pscustomobject]@{ action = "open-app"; reason = "the app finds or starts the server itself" }
    }
    if ($Ownership -eq "foreign") {
        return [pscustomobject]@{
            action = "refuse"
            reason = "Port $Port is held by a process not started by the managed Valkama launcher. Valkama left it untouched. Stop that process or choose another port, then click again."
        }
    }
    if ($Ownership -notin @("free", "managed")) {
        return [pscustomobject]@{
            action = "refuse"
            reason = "Valkama could not verify who owns port $Port, so it left the listener untouched. Verify the managed launcher, then click again."
        }
    }
    if ($null -eq $Listener -and $Ownership -eq "managed") {
        return [pscustomobject]@{
            action = "in-transition"
            reason = "the managed listener holds port $Port but has not answered yet"
        }
    }
    if ($null -eq $Listener) {
        return [pscustomobject]@{ action = "start-server"; reason = "nothing is listening and no app is installed" }
    }
    if ($Ownership -eq "free") {
        return [pscustomobject]@{
            action = "in-transition"
            reason = "a listener answered on port $Port but none holds it now"
        }
    }
    if (Test-RuntimeMatch $Expected $Listener) {
        return [pscustomobject]@{ action = "open-browser"; reason = "the managed server has the current runtime identity; no app is installed" }
    }
    return [pscustomobject]@{
        action = "restart-required"
        reason = Get-StaleReason $Expected $Listener
    }
}

function Restart-Server($Launcher) {
    # Only the HTTP listener goes down. Agent sessions are their own
    # managed-shim MCP processes reading the store directly, so none of them is
    # interrupted. The launcher re-reads the listener command line immediately
    # before stop; an HTTP runtime payload is never stop authority.
    $stopped = Stop-ManagedListener $Launcher
    if ($stopped.state -eq "refused") {
        throw $stopped.detail
    }
    if ($stopped.state -notin @("stopped", "free")) {
        throw "the managed listener could not be stopped safely"
    }
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        Start-Sleep -Milliseconds 200
        $ownership = Get-ListenerOwnership $Launcher
        if ($ownership.state -eq "free") { return }
        if ($ownership.state -eq "foreign") { throw $ownership.detail }
    }
    throw "the old server on port $Port did not stop"
}

function Measure-Step([System.Collections.Generic.List[string]]$Steps, [string]$Name, [scriptblock]$Work) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try { return & $Work }
    finally { $Steps.Add("$Name=$($watch.ElapsedMilliseconds)ms") }
}

function Open-App {
    $steps = [System.Collections.Generic.List[string]]::new()
    try {
        Measure-Step $steps "start-app" { Start-Process -FilePath $AppPath } | Out-Null
        return New-TrayResult "opened" "opened $AppPath" ($steps -join " ")
    }
    catch {
        return New-TrayResult "failed" "Could not start $AppPath.`n`n$($_.Exception.Message)" ($steps -join " ")
    }
}

function Open-ValkamaWithoutApp {
    # The browser path: with no app to decide, this script decides, and it may
    # start the server itself. Runs off the icon's thread.
    $steps = [System.Collections.Generic.List[string]]::new()
    try {
        $launcher = Measure-Step $steps "launcher" { Get-ManagedLauncher }
        $expected = Measure-Step $steps "runtime" { Get-ExpectedRuntime $launcher }
        $listener = Measure-Step $steps "http" { Get-ListenerRuntime }
        $ownership = Measure-Step $steps "owner" { Get-ListenerOwnership $launcher }
        $plan = Resolve-OpenPlan $expected $listener $ownership.state $false
        if ($plan.action -eq "in-transition") {
            # Read both again, once. A start or stop in progress settles within
            # a moment; a reading that still disagrees is said, not acted on.
            Start-Sleep -Milliseconds 400
            $listener = Measure-Step $steps "http-again" { Get-ListenerRuntime }
            $ownership = Measure-Step $steps "owner-again" { Get-ListenerOwnership $launcher }
            $plan = Resolve-OpenPlan $expected $listener $ownership.state $false
        }
        $trace = { "$($steps -join ' ') plan=$($plan.action)" }
        switch ($plan.action) {
            "open-browser" {
                Start-Process "http://127.0.0.1:$Port/"
                return New-TrayResult "opened" "opened Valkama in a browser; no app at $AppPath" (& $trace)
            }
            "start-server" {
                Start-Process -FilePath $launcher.Python -ArgumentList "`"$($launcher.Shim)`"", "serve", "--port", $Port -WindowStyle Hidden
                for ($attempt = 0; $attempt -lt 20; $attempt++) {
                    Start-Sleep -Milliseconds 300
                    $listener = Get-ListenerRuntime
                    $ownership = Get-ListenerOwnership $launcher
                    if ($ownership.state -eq "managed" -and (Test-RuntimeMatch $expected $listener)) {
                        Start-Process "http://127.0.0.1:$Port/"
                        return New-TrayResult "opened" "started the server and opened Valkama in a browser" (& $trace)
                    }
                    if ($ownership.state -eq "foreign") {
                        return New-TrayResult "failed" $ownership.detail (& $trace)
                    }
                }
                return New-TrayResult "failed" "The Valkama server did not start. Its log is $LogPath." (& $trace)
            }
            "in-transition" {
                return New-TrayResult "starting" "Valkama is starting or stopping on port $Port right now. Click again in a moment. If this keeps happening, use Restart the server from this icon's menu." (& $trace)
            }
            "restart-required" { return New-TrayResult "stale" $plan.reason (& $trace) }
            default { return New-TrayResult "failed" $plan.reason (& $trace) }
        }
    }
    catch {
        # A click must never kill the icon, and WinForms swallows handler
        # errors, so the failure is carried back as a value instead.
        return New-TrayResult "failed" $_.Exception.Message ($steps -join " ")
    }
}

function Open-Valkama {
    if (Test-Path -LiteralPath $AppPath) { return Open-App }
    return Open-ValkamaWithoutApp
}

function Invoke-RestartWork {
    try {
        $launcher = Get-ManagedLauncher
        Restart-Server $launcher
        $result = Open-Valkama
        return New-TrayResult $result.outcome $result.message "after restart: $($result.steps)"
    }
    catch {
        return New-TrayResult "failed" "Could not restart the Valkama server.`n`n$($_.Exception.Message)"
    }
}

if ($PrintLauncher) {
    Get-ManagedLauncher | ConvertTo-Json -Compress
    return
}

if ($PrintPlan) {
    $expected = if ($ExpectedJson) { $ExpectedJson | ConvertFrom-Json } else { $null }
    $listener = if ($ListenerJson) { $ListenerJson | ConvertFrom-Json } else { $null }
    Resolve-OpenPlan $expected $listener $ListenerOwner $AppExists.IsPresent | ConvertTo-Json -Compress
    return
}

if ($SelfTest) {
    $result = Open-Valkama
    Write-TrayLog "self test: $($result.outcome): $($result.message) ($($result.steps))"
    $result | ConvertTo-Json -Compress
    return
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-TrayProblem([string]$Message) {
    # A balloon is the wrong channel here: notification settings may drop it,
    # which is the failure this whole file exists to end. An explicit click
    # gets an explicit answer.
    [void][System.Windows.Forms.MessageBox]::Show(
        $Message,
        "Valkama",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning)
}

function Confirm-Restart([string]$Message) {
    $answer = [System.Windows.Forms.MessageBox]::Show(
        "$Message`n`nRestart it now? Agent sessions are not affected.",
        "Valkama",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning)
    return $answer -eq [System.Windows.Forms.DialogResult]::Yes
}

function Show-TrayNotice([string]$Message) {
    # Not a problem, a moment: the port is changing hands.
    [void][System.Windows.Forms.MessageBox]::Show(
        $Message,
        "Valkama",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information)
}

# One worker at a time: the busy gate admits no second open while one runs.
# Plain script-scope state and one timer, rather than closures, because a
# closure is a module of its own and would not see this script's functions
# or its $script: variables.
$script:Work = $null
$script:WorkTimer = New-Object System.Windows.Forms.Timer
$script:WorkTimer.Interval = 50
$script:WorkTimer.add_Tick({ Complete-TrayWork })

function Start-TrayWork([string]$Name, [string]$Then, $Context) {
    <#
    Run one of this script's functions on a thread of its own and hand its
    result to the function named $Then back on the icon's thread, where dialogs
    belong. The worker dot-sources this same file in its side-effect-free
    -PrintPlan mode, so it runs exactly the code the tests drive.
    #>
    $worker = [powershell]::Create()
    $null = $worker.AddScript({
            param($Script, $Directory, $ListenPort, $App, $Function)
            . $Script -PrintPlan -LauncherDirectory $Directory -Port $ListenPort -AppPath $App | Out-Null
            & $Function
        }).AddArgument($TrayScriptPath).AddArgument($LauncherDirectory).AddArgument($Port).AddArgument($AppPath).AddArgument($Name)
    $script:Work = [pscustomobject]@{
        Worker = $worker
        Pending = $worker.BeginInvoke()
        Then = $Then
        Context = $Context
    }
    $script:WorkTimer.Start()
}

function Complete-TrayWork {
    $work = $script:Work
    if ($null -eq $work -or -not $work.Pending.IsCompleted) { return }
    $script:WorkTimer.Stop()
    $script:Work = $null
    try {
        $result = @($work.Worker.EndInvoke($work.Pending))[-1]
        if ($null -eq $result) {
            # The worker's own error is the only account of what went wrong.
            $why = @($work.Worker.Streams.Error | ForEach-Object { [string]$_ }) -join "`n"
            $result = New-TrayResult "failed" "The Valkama check ended without an answer.`n`n$why"
        }
    }
    catch {
        $result = New-TrayResult "failed" $_.Exception.Message
    }
    finally {
        $work.Worker.Dispose()
    }
    & $work.Then $result $work.Context
}

function Complete-Open($Result, [Diagnostics.Stopwatch]$Watch) {
    # Every outcome of an open ends here, on the icon's thread, and every one
    # but `opened` is said in a dialog. The icon stays busy until it is.
    $restarting = $false
    try {
        Write-TrayLog "$($Result.outcome) after $($Watch.ElapsedMilliseconds) ms: $($Result.message) ($($Result.steps))"
        if ($Result.outcome -eq "opened") { return }
        if ($Result.outcome -eq "stale" -and (Confirm-Restart $Result.message)) {
            Write-TrayLog "restart confirmed"
            $restarting = $true
            Start-TrayWork "Invoke-RestartWork" "Complete-Restart" $null
            return
        }
        if ($Result.outcome -eq "starting") {
            Show-TrayNotice $Result.message
            return
        }
        Show-TrayProblem $Result.message
    }
    finally {
        if (-not $restarting) { $script:Busy = $false }
    }
}

function Complete-Restart($Result, $Context) {
    try {
        Write-TrayLog "after restart: $($Result.outcome): $($Result.message) ($($Result.steps))"
        if ($Result.outcome -ne "opened") { Show-TrayProblem $Result.message }
    }
    finally {
        $script:Busy = $false
    }
}

function Invoke-Open {
    # Clicks are gated by time as well as by the busy flag: a click queued
    # while the icon's thread was occupied arrives after the flag has cleared,
    # and used to start a second decision in the middle of the first one's
    # startup.
    $now = [DateTime]::UtcNow
    $sinceLast = ($now - $script:LastClickAt).TotalMilliseconds
    if ($script:Busy -or $sinceLast -lt $ClickQuietMilliseconds) {
        $why = if ($script:Busy) { "an open is in flight" } else { "$([int]$sinceLast) ms after the last one" }
        Write-TrayLog "click ignored: $why"
        return
    }
    $script:LastClickAt = $now
    $script:Busy = $true
    $watch = [Diagnostics.Stopwatch]::StartNew()
    Write-TrayLog "click"
    if (Test-Path -LiteralPath $AppPath) {
        Complete-Open (Open-App) $watch
        return
    }
    Start-TrayWork "Open-ValkamaWithoutApp" "Complete-Open" $watch
}

function Invoke-MenuRestart {
    if ($script:Busy) {
        Write-TrayLog "restart ignored: an open is in flight"
        return
    }
    $script:Busy = $true
    Write-TrayLog "restart chosen from the menu"
    Start-TrayWork "Invoke-RestartWork" "Complete-Restart" $null
}

function New-TrayIcon([string]$Path) {
    # The one-argument constructor takes the frame for the system's large icon
    # size (32px at 100%), and the shell then shrinks it into the small tray
    # slot. Asking for the small size takes the frame drawn for that slot.
    New-Object System.Drawing.Icon($Path, [System.Windows.Forms.SystemInformation]::SmallIconSize)
}

$script:Notify = New-Object System.Windows.Forms.NotifyIcon
$script:Notify.Icon = New-TrayIcon $IconPath
$script:Notify.Text = "Valkama - a session is open"
$script:Notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add("Open Valkama")
$open.add_Click({ Invoke-Open })
$restart = $menu.Items.Add("Restart the server")
$restart.add_Click({ Invoke-MenuRestart })
$hide = $menu.Items.Add("Hide this icon")
$hide.add_Click({ [System.Windows.Forms.Application]::Exit() })
$script:Notify.ContextMenuStrip = $menu

$script:Notify.add_MouseClick({
        if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Invoke-Open }
    })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
        try {
            $probe = [System.Threading.Mutex]::OpenExisting($SessionMutex)
            $probe.Dispose()  # never keep the session's mutex alive ourselves
        }
        catch {
            Write-TrayLog "session mutex gone"
            [System.Windows.Forms.Application]::Exit()
        }
    })
$timer.Start()

Write-TrayLog "icon up, watching $SessionMutex"
try {
    [System.Windows.Forms.Application]::Run()
}
finally {
    $timer.Stop()
    $script:Notify.Visible = $false
    $script:Notify.Dispose()
    Write-TrayLog "icon down"
}
