#Requires -Version 5.1
<#
.SYNOPSIS
    Acceptance test for t3-code-kit, on a Windows host with no bash.

.DESCRIPTION
    PowerShell port of bin/smoke. This is what "it works" means.

    Leaves the sandbox running unless SMOKE_DOWN=1.
    WARNING: the agent round-trip spends real model tokens.
    Set SMOKE_SKIP_AGENT=1 to skip it.

.EXAMPLE
    .\smoke.ps1

.EXAMPLE
    $env:SMOKE_SKIP_AGENT = 1; .\smoke.ps1 t3ck-smoke
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string] $Name
)

$ErrorActionPreference = 'Stop'

$Root   = Split-Path -Parent $PSScriptRoot
$KitBin = Join-Path $PSScriptRoot 't3-code-kit.ps1'

$Sbx      = if ($env:SBX) { $env:SBX } else { 'sbx' }
$HostPort = if ($env:T3CK_PORT) { [int] $env:T3CK_PORT } else { 3773 }
$Repo     = if ($env:SMOKE_REPO) { $env:SMOKE_REPO } else { 'https://github.com/juranki/t3-code-kit' }
if (-not $Name) {
    $Name = if ($env:T3CK_NAME) { $env:T3CK_NAME } else { 't3ck-smoke' }
}

$script:Pass = 0
$script:Fail = 0
$script:Skip = 0

function Ok   { param([string] $m) $script:Pass++; Write-Output "  PASS  $m" }
function No   { param([string] $m) $script:Fail++; Write-Output "  FAIL  $m" }
function Meh  { param([string] $m) $script:Skip++; Write-Output "  SKIP  $m" }
function Head { param([string] $m) Write-Output ''; Write-Output "== $m" }

function Invoke-InSandbox {
    param([string[]] $Command)
    # Deliberately a copy of the launcher's Invoke-Sbx: this script is a
    # standalone port of bin/smoke and must run without the launcher, the same
    # way the two launchers are deliberate duplicates. Keep the two in step.
    #
    # The trap: a native command writing to stderr under
    # $ErrorActionPreference='Stop' raises NativeCommandError, and 2>&1 does
    # not prevent it. Relax the preference for the duration and judge the exit
    # code instead.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # stderr arrives as ErrorRecord objects even when merged; take their
        # message, or a warning from inside the sandbox reads like a crash.
        $out = (& $Sbx exec $Name -- @Command 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_ }
        }) -join "`n"
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{ Output = $out; ExitCode = $code }
}

function Test-Url {
    param([string] $Uri)
    # Proxy = $null: Invoke-WebRequest honours the system proxy and would never
    # reach localhost on a host with one configured.
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

# ---------------------------------------------------------------- static
Head 'static checks'

foreach ($f in @('kit/t3-code.yaml', 'kit/t3-code.dockerfile', 'kit/serve.sh', 'kit/skills.txt', 'kit/skills.sh', 'policy/allow.txt')) {
    if (Test-Path (Join-Path $Root $f)) { Ok "$f exists" } else { No "$f missing" }
}

# policy/allow.txt must not promise anything the descriptor denies: the
# descriptor is normative, this file is the readable mirror.
# Nested on purpose: Join-Path takes two positional arguments in Windows
# PowerShell 5.1; -AdditionalChildPath is PowerShell 6+.
$policyPath = Join-Path (Join-Path $Root 'policy') 'allow.txt'
$descriptor = Join-Path (Join-Path $Root 'kit') 't3-code.yaml'
if ((Test-Path $policyPath) -and (Test-Path $descriptor)) {
    $text = Get-Content $descriptor -Raw
    $missing = @()
    foreach ($line in Get-Content $policyPath) {
        $host_ = ($line -replace '#.*$', '').Trim()
        if (-not $host_) { continue }
        if ($text -notmatch [regex]::Escape($host_)) { $missing += $host_ }
    }
    if ($missing.Count -eq 0) {
        Ok 'policy/allow.txt matches the descriptor'
    }
    else {
        No ("in policy/allow.txt but not in kit/t3-code.yaml: " + ($missing -join ', '))
    }
}

# ---------------------------------------------------------------- runtime
Head 'sandbox lifecycle'

$upLog = Join-Path ([System.IO.Path]::GetTempPath()) 't3ck-smoke-up.log'
$env:T3CK_NAME = $Name
& $KitBin up $Name *> $upLog
if ($LASTEXITCODE -eq 0) {
    Ok 'up succeeded'
}
else {
    No "up failed; see $upLog"
    Get-Content $upLog | Write-Output
    exit 1
}

Head 'reachability'

if (Test-Url "http://localhost:${HostPort}/") {
    Ok "http://localhost:${HostPort}/ answers"
}
else {
    No "http://localhost:${HostPort}/ does not answer"
}

$pair = (& $KitBin url $Name 2>&1 | Out-String).Trim()
if ($pair -match '^http://localhost:\d+/pair#token=') {
    Ok 'pairing URL minted and rewritten to localhost'
    $pairPage = ($pair -split '#')[0]
    if (Test-Url $pairPage) { Ok 'pairing page answers' } else { No 'pairing page does not answer' }
}
else {
    No "no usable pairing URL (got: $(if ($pair) { $pair } else { 'nothing' }))"
}

Head 'toolchain inside the sandbox'

$toolchain = @(
    @('t3', '--version'),
    @('pi', '--version'),
    @('git', '--version')
)
foreach ($cmd in $toolchain) {
    $r = Invoke-InSandbox $cmd
    $label = $cmd -join ' '
    if ($r.ExitCode -eq 0) { Ok $label } else { No $label }
}

$r = Invoke-InSandbox @('sh', '-c', 'mountpoint -q /home/agent/workspace')
if ($r.ExitCode -eq 0) {
    Ok '/home/agent/workspace is a volume, not a host mount'
}
else {
    No '/home/agent/workspace is not a volume'
}

# Skills are baked into the image, and the Dockerfile already asserts the
# count against kit/skills.txt. This is the other failure: an image built
# before skills were baked in, or a RUN that never executed.
# Port of kit/skills.sh's rule (one name per line, blank lines and #-comments
# ignored); a stock Windows host has no sh to call it.
$manifest = Join-Path (Join-Path $Root 'kit') 'skills.txt'
$skillsWant = 0
if (Test-Path $manifest) {
    $skillsWant = @(Get-Content $manifest | Where-Object { $_ -match '\S' -and $_ -notmatch '^\s*#' }).Count
}
$r = Invoke-InSandbox @('sh', '-c', 'echo "skills=$(ls -1 /home/agent/.agents/skills 2>/dev/null | wc -l | tr -d " ")"')
$skillsHave = 0
# The same sentinel bin/smoke reads: merged stderr must not be counted.
if ($r.Output -match '(?m)^skills=(\d+)\s*$') { $skillsHave = [int] $Matches[1] }
if ($skillsWant -gt 0 -and $skillsHave -eq $skillsWant) {
    Ok "$skillsWant skills baked in, kit/skills.txt agrees"
}
else {
    No "skills: $skillsHave baked in, $skillsWant in kit/skills.txt"
}

Head 'egress and credentials'

$r = Invoke-InSandbox @('git', 'ls-remote', '--exit-code', $Repo, 'HEAD')
if ($r.ExitCode -eq 0) {
    Ok "git ls-remote $Repo (network + github credential)"
}
else {
    No "git ls-remote $Repo - check policy/allow.txt and: sbx secret set github"
}

Head 'agent round-trip'

if ($env:SMOKE_SKIP_AGENT -eq '1') {
    Meh 'pi prompt skipped (SMOKE_SKIP_AGENT=1)'
}
else {
    $r = Invoke-InSandbox @('pi', '-p', 'Reply with exactly: OK', '--no-tools', '--no-session')
    if ($r.Output -match 'OK') {
        Ok 'pi answered through its provider'
    }
    else {
        No 'pi could not answer - check the provider key and its egress entry'
    }
}

# ---------------------------------------------------------------- teardown
Head 'summary'
Write-Output ("  {0} passed, {1} failed, {2} skipped" -f $script:Pass, $script:Fail, $script:Skip)

if ($env:SMOKE_DOWN -eq '1') {
    & $KitBin down $Name 2>&1 | Out-Null
    Write-Output '  sandbox stopped'
}
else {
    Write-Output "  sandbox $Name left running (SMOKE_DOWN=1 to stop it)"
}

if ($script:Fail -ne 0) { exit 1 }
