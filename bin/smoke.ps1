#Requires -Version 7.0
<#
.SYNOPSIS
    Acceptance test for t3-code-kit, on a Windows host with no bash.

.DESCRIPTION
    PowerShell port of bin/smoke. This is what "it works" means.

    Leaves the sandbox running unless SMOKE_DOWN=1.

    The agent round-trip is SKIPPED by default: set SMOKE_AGENT=1 to run it.
    It spends real model tokens, and it currently fails for a reason outside
    this repo's control - pi hangs under a non-TTY `sbx exec` and answers only
    interactively. A suite that fails by default on a known upstream bug just
    teaches people to ignore failures.

    When enabled, the round-trip is killed after SMOKE_AGENT_TIMEOUT seconds
    (120), so a wedged pi fails the check instead of blocking the run.

.EXAMPLE
    .\smoke.ps1

.EXAMPLE
    $env:SMOKE_AGENT = 1; .\smoke.ps1 t3ck-smoke
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
    # The trap: a native command's non-zero exit becomes a terminating error
    # under $ErrorActionPreference='Stop' once
    # $PSNativeCommandUseErrorActionPreference is on. Relax the preference for
    # the duration and judge the exit code instead.
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

foreach ($f in @('kit/t3-code.yaml', 'kit/t3-code.dockerfile', 'kit/serve.sh', 'kit/skills.txt', 'kit/skills.sh', 'policy/allow.txt', 'policy/install.txt')) {
    if (Test-Path (Join-Path $Root $f)) { Ok "$f exists" } else { No "$f missing" }
}

# The policy mirrors must not promise anything the descriptor denies: the
# descriptor is normative, these files are the readable copies. allow.txt is
# runtime egress, install.txt is build-time egress; both are checked.
$policyDir = Join-Path $Root 'policy'
$policyPath = Join-Path $policyDir 'allow.txt'
$descriptor = Join-Path $Root 'kit' 't3-code.yaml'
if ((Test-Path $policyPath) -and (Test-Path $descriptor)) {
    $text = Get-Content $descriptor -Raw
    $missing = @()
    foreach ($mirror in @($policyPath, (Join-Path $policyDir 'install.txt'))) {
        if (-not (Test-Path $mirror)) { continue }
        foreach ($line in Get-Content $mirror) {
            $host_ = ($line -replace '#.*$', '').Trim()
            if (-not $host_) { continue }
            if ($text -notmatch [regex]::Escape($host_)) { $missing += $host_ }
        }
    }
    if ($missing.Count -eq 0) {
        Ok 'policy mirrors match the descriptor'
    }
    else {
        No ("in a policy mirror but not in kit/t3-code.yaml: " + ($missing -join ', '))
    }

    # `t3-code-kit policy` prints policy/allow.txt as "egress allowed at
    # runtime", so a build-time host in that file is a permission an agent acts
    # on and then gets a 403 for. The two lists must not be merged.
    $installHosts = @('nodejs.org', 'dl.google.com', 'pypi.org', 'files.pythonhosted.org')
    $leaked = @()
    foreach ($line in Get-Content $policyPath) {
        $host_ = ($line -replace '#.*$', '').Trim()
        if (-not $host_) { continue }
        if ($installHosts -contains $host_) { $leaked += $host_ }
    }
    if ($leaked.Count -eq 0) {
        Ok 'policy/allow.txt lists runtime egress only'
    }
    else {
        No ('install-time hosts in policy/allow.txt (they belong in policy/install.txt): ' + ($leaked -join ', '))
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
    $descriptorText = Get-Content (Join-Path $Root 'kit' 't3-code.yaml') -Raw
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
# The payload stays free of double quotes so it reads the same as bin/smoke's
# probes and survives being pasted into either shell. The launcher's parse-only
# calls read stdout and this port normalises versions here rather than in sed.
$shimScript = @'
echo node=$(node --version)
echo go=$(go version)
echo python=$(python --version)
echo node_path=$(command -v node)
echo go_path=$(command -v go)
echo python_path=$(command -v python)
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
    $raw = $shim[$Tool]
    $path = $shim["${Tool}_path"]
    $got = ''
    if ($Tool -eq 'go') {
        if ($raw -match 'go(\d+\.\d+\.\d+)') { $got = $Matches[1] }
    }
    elseif ($Tool -eq 'python') {
        if ($raw -match '(\d+\.\d+\.\d+)') { $got = $Matches[1] }
    }
    else {
        $got = ($raw -replace '^v', '')
    }
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
# This probe mirrors bin/smoke, which is the reference for this port. Two
# things had drifted, and each one reports `unknown` on a sandbox whose
# terminal is fine:
#
#  - The tr escapes were unquoted. `tr \0 \n` reaches the shell as `tr 0 n`:
#    the backslashes are eaten, so the NULs are never turned into newlines and
#    sed sees one long line with no ^SHELL= to match. Quote them.
#  - The pattern was unanchored. `t3.serve` means t3 + any char + serve, which
#    also matches serve.sh - the wrapper the platform starts with SHELL=/bin/sh.
#    pgrep lists lowest PID first and the wrapper starts before the server, so
#    head -1 picked the wrapper. Anchor it, as bin/smoke does.
#
# Either one alone is enough to fail, so both are fixed; the quoting one is the
# defect that shows up on every host, the anchor the one that shows up when a
# serve.sh wrapper is in the process table.
#
# 2>/dev/null keeps a failed /proc read (a PID that already exited) a clean
# empty result instead of noise.
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
# ignored); a Windows host has no sh to call it.
$manifest = Join-Path $Root 'kit' 'skills.txt'
$skillsWant = 0
if (Test-Path $manifest) {
    $skillsWant = @(Get-Content $manifest | Where-Object { $_ -match '\S' -and $_ -notmatch '^\s*#' }).Count
}
# No double quotes, same as the $shimScript probes.
$r = Invoke-InSandbox @('sh', '-c', 'echo skills=$(ls -1 /home/agent/.agents/skills | wc -l)')
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
# serve.sh refreshes pi's catalog before it starts t3, and says so in
# serve.log. That log line is the evidence: the refresh ran and pi exited 0.
#
# This used to infer the same thing from ~/.pi/agent/models-store.json, which
# was a guess about pi's on-disk layout - unverified, and it reported "missing"
# on a sandbox whose catalog had demonstrably refreshed. Assert on what the
# entrypoint records instead of on where pi happens to keep its cache.
#
# No double quotes, same as the $shimScript probes.
$r = Invoke-InSandbox @('sh', '-c', 'tail -n 2000 $HOME/.t3/serve.log')
$serveLog = $r.Output
if ($r.ExitCode -ne 0) {
    No "could not read serve.log (exit $($r.ExitCode)) - serve.sh never ran"
}
elseif ($serveLog -match 'model catalog refreshed') {
    Ok "pi's model catalog refreshed at startup"
}
elseif ($serveLog -match 'model catalog refresh failed') {
    No 'the startup refresh ran and failed - check egress to pi.dev (see: t3-code-kit logs <name>)'
}
elseif ($serveLog -match 'model catalog refresh timed out') {
    No 'the startup refresh timed out - check egress to pi.dev (see: t3-code-kit logs <name>)'
}
else {
    No 'no refresh line in serve.log - the startup refresh did not run'
}

Head 'egress and credentials'

$r = Invoke-InSandbox @('git', 'ls-remote', '--exit-code', $Repo, 'HEAD')
if ($r.ExitCode -eq 0) {
    Ok "git ls-remote $Repo (network + github credential)"
}
else {
    No "git ls-remote $Repo - check policy/allow.txt and: sbx secret set github"
}

# The identity the launcher asserts. Only its *shape* is checkable here: smoke
# sees the sandbox, never the host that created it, so "matches the host" is
# out of reach and "is not the auto-generated placeholder" is the real
# regression this catches. bin/test asserts the exact value.
#
# "Configured at all" is the assertion, not "has the prefix". The prefix is
# user-overridable (T3CK_AGENT_NAME_PREFIX, empty for the bare host name), so a
# name without it is a valid configuration, not a failure. What must never
# appear is git's own invention from the username and hostname.
$identityName  = (Invoke-InSandbox @('git', 'config', '--global', 'user.name')).Output.Trim()
$identityEmail = (Invoke-InSandbox @('git', 'config', '--global', 'user.email')).Output.Trim()

if (-not $identityName) {
    No 'no git user.name in the sandbox - commits get an auto-generated author'
}
elseif ($identityName -eq 'agent' -or $identityName -like 'agent@*') {
    No "git user.name is '$identityName' - the auto-generated placeholder"
}
else {
    Ok "git identity name is '$identityName'"
}

# The launcher's own fallback (agent@t3-code-kit) is a correct value here: it is
# what `up` writes when the host has no git config, so rejecting it would fail
# smoke on a sandbox the launcher configured exactly as designed.
if (-not $identityEmail) {
    No 'no git user.email in the sandbox - commits get an auto-generated author'
}
elseif ($identityEmail -eq 'agent@t3.t3.docker.internal') {
    No "git user.email is '$identityEmail' - the auto-generated placeholder"
}
else {
    Ok "git identity email is '$identityEmail'"
}

Head 'agent round-trip'

if ($env:SMOKE_AGENT -ne '1') {
    Meh 'pi prompt skipped (set SMOKE_AGENT=1 to run it)'
}
else {
    # Bounded on purpose, and bounded *inside* the sandbox.
    #
    # Invoke-InSandbox collects output with `... | ForEach-Object { ... }`, which
    # waits for the stream to close. A pi that never exits therefore never closes
    # the exec session's stdout, and the whole suite waits forever - the failure
    # this check used to have. Killing pi inside the sandbox is what closes the
    # pipe; a host-side timeout would abandon the session and leave pi running,
    # reparented to PID 1.
    #
    # `timeout` is the same tool serve.sh uses as its backstop for pi, and 124 is
    # its timeout status, so a hang reads as a hang rather than as a bad answer.
    $agentTimeout = if ($env:SMOKE_AGENT_TIMEOUT) { [int] $env:SMOKE_AGENT_TIMEOUT } else { 120 }
    $r = Invoke-InSandbox @('sh', '-c', "timeout $agentTimeout pi -p 'Reply with exactly: OK' --no-tools --no-session")
    if ($r.ExitCode -eq 124) {
        # Not "check the credential": pi answering in ~1s interactively while
        # hanging here points at the non-TTY exec session, not at the key. Both
        # are named because the fix differs and guessing wrong costs a run.
        No "pi did not answer within ${agentTimeout}s and was killed - it hangs under a non-TTY 'sbx exec' even when the provider key, its binding and egress are all fine; re-run with -it to tell the two apart"
    }
    elseif ($r.Output -match 'OK') {
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
