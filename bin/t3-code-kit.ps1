#Requires -Version 5.1
<#
.SYNOPSIS
    t3-code-kit - run T3 Code + pi inside a Docker Sandbox, driven from a browser.

.DESCRIPTION
    PowerShell port of bin/t3-code-kit, for a Windows host with no bash.
    Same verbs, same behaviour. Written for Windows PowerShell 5.1 and up, so
    it runs on a stock Windows 11 without installing anything.

.PARAMETER Verb
    up | url | logs | shell | down | rebuild | nuke | policy | help

.PARAMETER Name
    Sandbox name. Defaults to $env:T3CK_NAME.

.PARAMETER Extra
    logs: number of lines to tail.

.EXAMPLE
    .\t3-code-kit.ps1 up myproject

.EXAMPLE
    $env:T3CK_NAME = 'myproject'; .\t3-code-kit.ps1 url
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string] $Verb,
    [Parameter(Position = 1)][string] $Name,
    [Parameter(Position = 2)][string] $Extra
)

$ErrorActionPreference = 'Stop'

$Root       = Split-Path -Parent $PSScriptRoot
$KitDir     = Join-Path $Root 'kit'
# Nested on purpose: Join-Path takes two positional arguments in Windows
# PowerShell 5.1; -AdditionalChildPath is PowerShell 6+.
$PolicyFile = Join-Path (Join-Path $Root 'policy') 'allow.txt'

$Sbx           = if ($env:SBX) { $env:SBX } else { 'sbx' }
# Build the Kit in a builder sandbox, not with the host's Docker Buildx. The
# whole promise here is that the host needs no Docker Engine; without this, a
# host with Docker Desktop installed but not running fails with
# "open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file".
if (-not $env:SBX_KIT_BUILDER) { $env:SBX_KIT_BUILDER = 'sandbox' }
$HostPort      = if ($env:T3CK_PORT) { [int] $env:T3CK_PORT } else { 3773 }
$ContainerPort = 3773
$ReadyTimeout  = if ($env:T3CK_READY_TIMEOUT) { [int] $env:T3CK_READY_TIMEOUT } else { 180 }

function Fail {
    param([string] $Message)
    [Console]::Error.WriteLine("t3-code-kit: $Message")
    exit 1
}

function Warn {
    param([string] $Message)
    [Console]::Error.WriteLine("WARNING: $Message")
}

function Assert-Sbx {
    if (-not (Get-Command $Sbx -ErrorAction SilentlyContinue)) {
        Fail "the '$Sbx' CLI is not on PATH. Install Docker Sandboxes: https://docs.docker.com/ai/sandboxes/install/"
    }
}

# Windows PowerShell 5.1 raises NativeCommandError whenever a native command
# writes to stderr while $ErrorActionPreference is 'Stop' — and 2>&1 does not
# prevent it, it only moves the line into the output stream on the way to the
# error. `sbx` writes progress, build logs, and even its success banners
# ("sandbox X — running detached") to stderr, so every call goes through here:
# the preference is relaxed for the duration, stderr is merged into the output,
# and the exit code comes back for the caller to judge.
function Invoke-Sbx {
    param([string[]] $SbxArgs)
    $code = 1
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # stderr arrives as ErrorRecord objects even when merged; take their
        # message, or the output reads like a crash ("sbx.exe : ...
        # NativeCommandError") instead of the build log it actually is.
        $output = (& $Sbx @SbxArgs 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_ }
        }) -join "`n"
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    [pscustomobject]@{ Output = $output; Code = $code }
}

function Get-SandboxName {
    param([string] $Candidate)
    $n = if ($Candidate) { $Candidate } elseif ($env:T3CK_NAME) { $env:T3CK_NAME } else { '' }
    if (-not $n) { Fail 'no sandbox name: pass one, or set T3CK_NAME' }
    return $n
}

function Test-SandboxExists {
    param([string] $Sandbox)
    $r = Invoke-Sbx @('ls')
    return [bool] ($r.Output -match "(?m)^\s*$([regex]::Escape($Sandbox))\b")
}

function Test-Secret {
    $r = Invoke-Sbx @('secret', 'ls')
    if ($r.Output -notmatch '(?m)^\s*github\b') {
        Warn "no 'github' secret on this host: clone/push will fail."
        Warn 'set one with:  sbx secret set github'
    }
}

function Show-Policy {
    Write-Output ''
    Write-Output 'egress allowed at runtime (everything else denied):'
    if (Test-Path $PolicyFile) {
        Get-Content $PolicyFile |
            ForEach-Object { ($_ -replace '#.*$', '').Trim() } |
            Where-Object { $_ } |
            ForEach-Object { Write-Output "  $_" }
    }
    Write-Output ''
}

function Test-Url {
    param([string] $Uri)
    # HttpWebRequest with Proxy = $null, not Invoke-WebRequest: the latter
    # honours the system proxy, so a host with one configured never reaches
    # localhost and every readiness check is a false negative.
    try {
        $req = [System.Net.HttpWebRequest]::Create($Uri)
        $req.Proxy = $null
        $req.Timeout = 5000
        $req.Method = 'GET'
        $resp = $req.GetResponse()
        $code = [int] $resp.StatusCode
        $resp.Close()
        return ($code -lt 500)
    }
    catch [System.Net.WebException] {
        if ($_.Exception.Response) { return ([int] $_.Exception.Response.StatusCode -lt 500) }
        return $false
    }
    catch { return $false }
}

function Wait-Ready {
    param([string] $Sandbox)
    Write-Host "waiting for the server on http://localhost:${HostPort}/ ..."
    $deadline = (Get-Date).AddSeconds($ReadyTimeout)
    while ((Get-Date) -lt $deadline) {
        if (Test-Url "http://localhost:${HostPort}/") {
            Write-Host 'server is up.'
            return $true
        }
        Start-Sleep -Seconds 2
    }
    Warn "no answer after ${ReadyTimeout}s. Check: t3-code-kit logs $Sandbox"
    return $false
}

function Confirm-Port {
    param([string] $Sandbox)
    $r = Invoke-Sbx @('ports', $Sandbox)
    if ($r.Output -match ":${HostPort}\b") { return }
    $r = Invoke-Sbx @('ports', $Sandbox, '--publish', "127.0.0.1:${HostPort}:$ContainerPort")
    if ($r.Code -ne 0) {
        Warn "could not publish ${HostPort}:$ContainerPort (see: sbx ports $Sandbox)"
    }
}

function Invoke-Up {
    param([string] $Sandbox)
    Assert-Sbx
    Test-Secret
    if (Test-SandboxExists $Sandbox) {
        Write-Output "sandbox '$Sandbox' exists; starting it."
        # A restart keeps the image the sandbox was created from. Changing
        # anything under kit/ needs `rebuild`, not `up`.
        Write-Output "note: this reuses the sandbox's existing image; run 't3-code-kit.ps1 rebuild $Sandbox' after editing kit/."
        $r = Invoke-Sbx @('run', '-d', '--name', $Sandbox)
        Write-Output $r.Output
        if ($r.Code -ne 0) { Fail "could not start sandbox '$Sandbox'" }
        # --publish is ignored on re-attach, so the mapping must be re-asked.
        Confirm-Port $Sandbox
    }
    else {
        # `create`, not `run`: `sbx run` always mounts a workspace, and with no
        # path argument it mounts the *current directory*. `sbx create` with no
        # path is the mountless form - the agent works in the container's own
        # filesystem, which is the whole point here.
        # `sbx create` builds the Kit and writes the build log to stderr: the
        # output is the interesting part, so print it, then judge the exit code.
        $r = Invoke-Sbx @('create', '--name', $Sandbox, '-p', "127.0.0.1:${HostPort}:$ContainerPort", $KitDir)
        Write-Output $r.Output
        if ($r.Code -ne 0) { Fail "could not create sandbox '$Sandbox'" }
        $r = Invoke-Sbx @('run', '-d', '--name', $Sandbox)
        Write-Output $r.Output
        if ($r.Code -ne 0) { Fail "could not start sandbox '$Sandbox'" }
        # create published via -p already; asking again is a 409 Conflict.
    }
    Show-Policy
    $null = Wait-Ready $Sandbox
    Invoke-Url $Sandbox
}

function Invoke-Url {
    param([string] $Sandbox)
    Assert-Sbx
    $pattern = 'http://[^\s"'']*#token=[A-Za-z0-9]+'

    $raw = (Invoke-Sbx @('exec', $Sandbox, '--', 't3', 'pair')).Output
    $m = [regex]::Match($raw, $pattern)

    if (-not $m.Success) {
        # t3 prints the pairing URL once at startup; read it back from the log
        # serve.sh keeps rather than minting a second token.
        $log = (Invoke-Sbx @('exec', $Sandbox, '--', 'tail', '-n', '500', '/home/agent/.t3/serve.log')).Output
        $m = [regex]::Match($log, 'Pairing URL: (' + $pattern + ')')
        if ($m.Success) { $m = [regex]::Match($m.Groups[1].Value, $pattern) }
    }

    if (-not $m.Success) { Fail "no pairing URL: is the server up? try: t3-code-kit logs $Sandbox" }

    # t3 prints the outbound interface address, which the host browser cannot
    # reach. Rewrite it to the published loopback port.
    $token = ($m.Value -split '#token=')[1]
    Write-Output "http://localhost:${HostPort}/pair#token=$token"
}

function Invoke-Logs {
    param([string] $Sandbox, [string] $Lines)
    Assert-Sbx
    if (-not $Lines) { $Lines = '200' }
    $r = Invoke-Sbx @('exec', $Sandbox, '--', 'tail', '-n', $Lines, '/home/agent/.t3/serve.log')
    if ($r.Code -eq 0) { Write-Output $r.Output; return }
    Warn "no /home/agent/.t3/serve.log in '$Sandbox' - serve.sh never started."
    Warn "falling back to the runtime's startup-hook log:"
    $r = Invoke-Sbx @('exec', $Sandbox, '--', 'tail', '-n', $Lines, '/var/log/sbx-kit-startup.log')
    if ($r.Code -eq 0) { Write-Output $r.Output }
    else { Warn "no startup-hook log either: the lifecycle@1 hook did not run." }
}

function Invoke-Shell {
    param([string] $Sandbox)
    Assert-Sbx
    # Not piped: an interactive shell needs the real console, and piping it
    # through Out-String would break the TTY. Only the preference is relaxed,
    # so a command writing to stderr inside the shell does not kill the verb.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Sbx exec -it $Sandbox -- bash
        if ($LASTEXITCODE -ne 0) { & $Sbx attach $Sandbox }
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-Refresh {
    param([string] $Sandbox)
    Assert-Sbx
    Write-Output "refreshing pi's model catalog inside '$Sandbox'"
    $r = Invoke-Sbx @('exec', $Sandbox, '--', 'pi', 'update', '--models')
    Write-Output $r.Output
    if ($r.Code -ne 0) { Warn 'pi update --models failed; check egress to pi.dev' }
    # t3 caches the upstream manifest with a fetchedAtMs; drop it so the next
    # start fetches instead of reusing the bundled fallback.
    $null = Invoke-Sbx @('exec', $Sandbox, '--', 'rm', '-f', '/home/agent/.t3/userdata/model-manifest.json')
    Write-Output 'restarting the server so t3 refetches its manifest'
    $r = Invoke-Sbx @('stop', $Sandbox)
    Write-Output $r.Output
    if ($r.Code -ne 0) { Fail "could not stop '$Sandbox'" }
    $r = Invoke-Sbx @('run', '-d', '--name', $Sandbox)
    Write-Output $r.Output
    if ($r.Code -ne 0) { Fail "could not start '$Sandbox'" }
    $null = Wait-Ready $Sandbox
    Invoke-Url $Sandbox
}

function Invoke-Down {
    param([string] $Sandbox)
    Assert-Sbx
    Write-Output (Invoke-Sbx @('stop', $Sandbox)).Output
}

function Invoke-Rebuild {
    param([string] $Sandbox)
    Assert-Sbx
    Write-Output "removing '$Sandbox' to force a Kit rebuild; volumes survive."
    $null = Invoke-Sbx @('rm', '--force', $Sandbox)
    Invoke-Up $Sandbox
}

function Invoke-Nuke {
    param([string] $Sandbox)
    Assert-Sbx
    Write-Output "destroying '$Sandbox' and its volumes. This loses every repo and all t3 state."
    $null = Invoke-Sbx @('rm', '--force', $Sandbox)
    # Volume names are the runtime's business, not ours: list and match.
    $listing = (Invoke-Sbx @('volume', 'ls')).Output
    # Not $matches: that is an automatic variable, and clobbering it breaks
    # every -match that runs afterwards.
    $volLines = $listing -split "`r?`n" | Where-Object { $_ -match [regex]::Escape($Sandbox) }
    if (-not $volLines) {
        Warn "no volume matched '$Sandbox'; check with: sbx volume ls"
    }
    foreach ($line in $volLines) {
        $id = ($line -split '\s+')[0]
        if (-not $id) { continue }
        Write-Output "  removing volume $id"
        $r = Invoke-Sbx @('volume', 'rm', $id)
        if ($r.Code -ne 0) { Warn "could not remove volume $id" }
    }
    Write-Output 'done.'
}

function Show-Usage {
    @'
usage: t3-code-kit.ps1 <verb> [sandbox-name]

  up       create or start the sandbox, publish the port, print the pairing URL
  url      print the pairing URL for a running sandbox
  logs     tail the server log inside the sandbox (optional: line count)
  shell    open a bash shell inside the sandbox
  refresh  refresh pi's model catalog and t3's model manifest, then restart
  down     stop the sandbox (volumes and repos survive)
  rebuild  destroy and recreate, forcing a Kit image rebuild (volumes survive)
  nuke     destroy the sandbox and its volumes (loses all repos and t3 state)
  policy   print the runtime egress allowlist

The sandbox name defaults to $env:T3CK_NAME. Host port defaults to
$env:T3CK_PORT (3773). The sbx binary defaults to $env:SBX.
'@ | Write-Output
}

if (-not $Verb) { Show-Usage; exit 2 }

switch ($Verb.ToLowerInvariant()) {
    'up'      { Invoke-Up (Get-SandboxName $Name) }
    'url'     { Invoke-Url (Get-SandboxName $Name) }
    'logs'    { Invoke-Logs (Get-SandboxName $Name) $Extra }
    'shell'   { Invoke-Shell (Get-SandboxName $Name) }
    'refresh' { Invoke-Refresh (Get-SandboxName $Name) }
    'down'    { Invoke-Down (Get-SandboxName $Name) }
    'rebuild' { Invoke-Rebuild (Get-SandboxName $Name) }
    'nuke'    { Invoke-Nuke (Get-SandboxName $Name) }
    'policy'  { Show-Policy }
    'help'    { Show-Usage }
    '-h'      { Show-Usage }
    '--help'  { Show-Usage }
    default   { Fail "unknown verb '$Verb' (try: t3-code-kit.ps1 help)" }
}
