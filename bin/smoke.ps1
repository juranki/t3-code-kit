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
    @('git', '--version'),
    @('mise', '--version')
)
foreach ($cmd in $toolchain) {
    $r = Invoke-InSandbox $cmd
    $label = $cmd -join ' '
    if ($r.ExitCode -eq 0) { Ok $label } else { No $label }
}

# The baked versions are the descriptor's build-arg defaults - read them here
# rather than keeping a second copy that drifts from kit/t3-code.yaml.
function Get-ArgDefault {
    param([string] $Key)
    $descriptorText = Get-Content (Join-Path (Join-Path $Root 'kit') 't3-code.yaml') -Raw
    $pattern = '(?m)^\s*' + [regex]::Escape($Key) + ':\s*\r?\n\s*default:\s*"([^"]+)"'
    if ($descriptorText -match $pattern) { return $Matches[1] }
    return ''
}

# mise's shims, not the base image's node 24 / go / python. `sbx exec` runs a
# non-interactive shell, which is exactly where `mise activate` would never
# have fired - so this is the assertion that catches a PATH-ordering
# regression here, instead of it surfacing later as "the agent used the wrong
# node".
#
# One round trip, one parse: the sandbox normalises the version strings so this
# port and bin/smoke cannot disagree about their formats.
$shims = '/home/agent/.local/share/mise/shims'
$shimScript = @'
echo "node=$(node --version 2>&1 | sed s/^v//)"
echo "go=$(go version 2>&1 | sed "s/^go version go\([0-9][0-9.]*\).*/\1/")"
echo "python=$(python --version 2>&1 | sed "s/^Python //")"
echo "node_path=$(command -v node)"
echo "go_path=$(command -v go)"
echo "python_path=$(command -v python)"
'@
$r = Invoke-InSandbox @('sh', '-c', $shimScript)
$shim = @{}
foreach ($line in ($r.Output -split "`r?`n")) {
    if ($line -match '^(node|go|python)(_path)?=(.*)$') {
        $shim[$Matches[1] + $Matches[2]] = $Matches[3].Trim()
    }
}

function Test-ShimTool {
    param([string] $Tool, [string] $Want)
    $got = $shim[$Tool]
    $path = $shim["${Tool}_path"]
    if (-not $Want) {
        No "${Tool}: no $($Tool)Version default in kit/t3-code.yaml"
    }
    elseif ($path -ne "$shims/$Tool") {
        $found = if ($path) { $path } else { 'nothing' }
        No "$Tool resolves to $found, not the mise shim ($shims/$Tool)"
    }
    elseif ($got -ne $Want) {
        $found = if ($got) { $got } else { 'nothing' }
        No "$Tool reports $found, want $Want (the baked version)"
    }
    else {
        Ok "$Tool $got through the mise shim"
    }
}

Test-ShimTool 'node' (Get-ArgDefault 'nodeVersion')
Test-ShimTool 'go' (Get-ArgDefault 'goVersion')
Test-ShimTool 'python' (Get-ArgDefault 'pythonVersion')

# Java is the base image's OpenJDK 21, not mise's: mise-java.jdx.dev is not in
# the allowlist and the base image already carries a JDK. This asserts the PATH
# append actually reaches it.
$r = Invoke-InSandbox @('java', '-version')
if ($r.Output -match 'openjdk version "21') {
    Ok "java -version is the base image's OpenJDK 21"
}
else {
    $first = @($r.Output -split "`r?`n" | Where-Object { $_ }) | Select-Object -First 1
    $found = if ($first) { $first } else { 'nothing' }
    No "java -version is not OpenJDK 21: $found"
}

# mise pulls ca-certificates-bundle, which ships its own copy of
# /etc/ssl/certs/ca-certificates.crt. Without --force-confold dpkg stops at the
# conffile prompt and leaves both packages in state iU: mise still runs, but
# the next apt operation fails. dpkg --audit is the assertion that the flag is
# there; replacing the bundle instead shows up as a TLS failure in the egress
# check below.
$r = Invoke-InSandbox @('sh', '-c', 'echo "audit=$(dpkg --audit 2>&1 | tr "\n" " ")"')
$audit = ''
if ($r.Output -match '(?m)^audit=(.*)$') { $audit = $Matches[1].Trim() }
if (-not $audit) {
    Ok 'dpkg --audit is clean'
}
else {
    No "dpkg --audit reports unconfigured packages: $audit"
}

$r = Invoke-InSandbox @('sh', '-c', 'mountpoint -q /home/agent/workspace')
if ($r.ExitCode -eq 0) {
    Ok '/home/agent/workspace is a volume, not a host mount'
}
else {
    No '/home/agent/workspace is not a volume'
}

# The UI's terminal is whatever t3 spawns from the server's $SHELL, and the
# platform starts the workload with SHELL=/bin/sh - dash, which has no
# readline: no history, no completion, no prompt colors. serve.sh exports bash.
# Read the running server's environment, not serve.sh: the failure this catches
# is a server that started before the export existed.
$r = Invoke-InSandbox @('sh', '-c', 'tr "\0" "\n" < /proc/$(pgrep -f "^t3 serve" | head -1)/environ 2>/dev/null | sed -n "s/^SHELL=//p"')
$serverShell = ''
if ($r.Output -match '(?m)^(/bin/bash)\s*$') { $serverShell = $Matches[1] }
if ($serverShell -eq '/bin/bash') {
    Ok 't3 serve runs with SHELL=/bin/bash (the terminal has history and completion)'
}
else {
    $found = if ($serverShell) { $serverShell } else { 'unknown' }
    No "t3 serve has SHELL=$found - the UI terminal falls back to dash"
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

Head 'model catalog'

# serve.sh refreshes pi's catalog before t3 serve. pi keeps the refreshed
# catalog in <agent-dir>/models-store.json; a non-empty one written after this
# start's `t3 serve starting` marker means the refresh ran and fetched, rather
# than the sandbox falling back to the catalog baked into the image. Compare
# against the marker, not the log's mtime: tee appends t3's output after the
# catalog write, so the live log is always newer than the store.
$catalogProbe = @'
log="${T3CODE_HOME:-$HOME/.t3}/serve.log"
store="$HOME/.pi/agent/models-store.json"
started=$(sed -n "s/^--- \([^ ]*\) t3 serve starting$/\1/p" "$log" 2>/dev/null | tail -1)
started_epoch=0
[ -n "$started" ] && started_epoch=$(date -d "$started" +%s 2>/dev/null || echo 0)
store_epoch=$(stat -c %Y "$store" 2>/dev/null || echo 0)
if [ -s "$store" ] && grep -q "\"models\"" "$store" && grep -q "\"id\"" "$store" && [ "$store_epoch" -ge "$started_epoch" ]; then
  echo "pi_catalog=fresh"
elif [ -s "$store" ] && grep -q "\"models\"" "$store" && grep -q "\"id\"" "$store"; then
  echo "pi_catalog=stale"
else
  echo "pi_catalog=missing"
fi
'@
$r = Invoke-InSandbox @('sh', '-c', $catalogProbe)
$piCatalog = if ($r.Output -match 'pi_catalog=(\w+)') { $Matches[1] } else { 'missing' }
switch ($piCatalog) {
    'fresh' {
        Ok "pi's model catalog refreshed at startup"
    }
    'stale' {
        No "pi's model catalog is older than this start - the startup refresh did not run (see: t3-code-kit logs $Name)"
    }
    default {
        No "pi's model catalog is missing - the startup refresh did not fetch one (blocked pi.dev or no provider credential; see: t3-code-kit logs $Name)"
    }
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
