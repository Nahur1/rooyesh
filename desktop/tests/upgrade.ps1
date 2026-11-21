param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

# Registry and installation tests run only on the disposable GitHub Windows VM.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or -not $env:RUNNER_TEMP) {
    throw 'Run installer integration tests on a disposable GitHub Windows runner.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The disposable runner must allow testing machine-wide installation.'
}

$Installer = (Resolve-Path -LiteralPath $Installer).Path
$testRoot = Join-Path $env:RUNNER_TEMP ("rooyesh-upgrade-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testRoot | Out-Null
$legacyKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\9a31e201-1f01-58b0-b8f0-f1403a53c121'
$currentKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\87fe41a6-4156-5366-9a77-7c0128618733'

function Assert-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Invoke-Installer([string]$Executable, [string]$Arguments, [bool]$ExpectFailure = $false) {
    Write-Output "Running $([IO.Path]::GetFileName($Executable)) $Arguments"
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(180000)) {
        $process.Kill()
        throw "Installer timed out: $Executable"
    }
    if ($ExpectFailure) {
        Assert-Condition ($process.ExitCode -ne 0) 'The failed uninstall should stop installation.'
    } else {
        Assert-Condition ($process.ExitCode -eq 0) "Installer failed with exit code $($process.ExitCode): $Executable"
    }
}

$compiler = Get-ChildItem -LiteralPath "$env:LOCALAPPDATA\electron-builder\Cache" -Filter makensis.exe -Recurse |
    Select-Object -First 1 -ExpandProperty FullName
Assert-Condition ([bool]$compiler) 'NSIS compiler was not downloaded by the build.'
& $compiler "/DTEST_OUTPUT=$testRoot" "$PSScriptRoot\legacy-fixture.nsi"
$legacyInstaller = Join-Path $testRoot 'legacy-fixture.exe'
$legacyUserDir = Join-Path $testRoot 'Legacy user installation'
$profileDir = Join-Path $env:APPDATA 'Nava'
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
$sentinel = Join-Path $profileDir 'upgrade-preservation-check.txt'
Set-Content -LiteralPath $sentinel -Value 'Personal data must survive upgrade.'

# An unsuccessful legacy uninstall must not install a second copy.
Invoke-Installer $legacyInstaller "/S /D=$legacyUserDir"
$failureMarker = Join-Path $legacyUserDir 'fail-uninstall'
Set-Content -LiteralPath $failureMarker -Value 'Simulate an uninstall error.'
Invoke-Installer $Installer "/S /currentuser /D=$legacyUserDir" $true
Assert-Condition (Test-Path -LiteralPath (Join-Path $legacyUserDir 'Nava.exe')) 'Legacy files were deleted after an uninstall failure.'
Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $legacyUserDir 'Rooyesh.exe'))) 'Installation continued after an uninstall failure.'
Assert-Condition (Test-Path "HKCU:\$legacyKey") 'Legacy registration was deleted after an uninstall failure.'

Remove-Item -LiteralPath $failureMarker

# Install the actual published predecessor, then add both legacy install scopes.
$previousTag = gh release view --repo $env:GITHUB_REPOSITORY --json tagName --jq .tagName
$previousAsset = gh release view $previousTag --repo $env:GITHUB_REPOSITORY --json assets --jq '.assets[].name | select(startswith("Rooyesh-Setup-") and endswith(".exe"))'
Assert-Condition ([bool]$previousAsset) 'The previous release has no Windows installer.'
gh release download $previousTag --repo $env:GITHUB_REPOSITORY --pattern $previousAsset --dir $testRoot
$previousInstaller = Join-Path $testRoot $previousAsset
$previousDir = Join-Path $testRoot 'Previous Rooyesh installation'
Invoke-Installer $previousInstaller "/S /currentuser /D=$previousDir"
Assert-Condition (Test-Path -LiteralPath (Join-Path $previousDir 'Rooyesh.exe')) 'The previous release did not install.'
Assert-Condition ((Get-ItemProperty "HKCU:\$currentKey").DisplayVersion -ne $Version) 'The predecessor test must install a different version.'

# Reusing the old directory must remove both old apps before new files are extracted.
Invoke-Installer $Installer "/S /currentuser /D=$legacyUserDir"
Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $legacyUserDir 'Nava.exe'))) 'Legacy executable remains after migration.'
Assert-Condition (Test-Path -LiteralPath (Join-Path $legacyUserDir 'Rooyesh.exe')) 'New executable is missing in the reused directory.'
Assert-Condition (-not (Test-Path "HKCU:\$legacyKey")) 'Legacy registration remains after migration.'
Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $previousDir 'Rooyesh.exe'))) 'The previous published executable remains after upgrade.'

# Add legacy installations alongside the upgraded Rooyesh in both scopes.
$installedUserDir = $legacyUserDir
$legacyUserDir = Join-Path $testRoot 'Additional legacy user installation'
Invoke-Installer $legacyInstaller "/S /D=$legacyUserDir"
$legacyMachineDir = Join-Path $testRoot 'Legacy machine installation'
Invoke-Installer $legacyInstaller "/S /allusers /D=$legacyMachineDir"
$newDir = Join-Path $testRoot 'Current Rooyesh installation'
Invoke-Installer $Installer "/S /D=$newDir"
Assert-Condition (Test-Path -LiteralPath (Join-Path $newDir 'Rooyesh.exe')) 'The new version was not installed.'
Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $installedUserDir 'Rooyesh.exe'))) 'The previous Rooyesh executable remains.'
Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $legacyUserDir 'Nava.exe'))) 'The per-user Nava executable remains.'
Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $legacyMachineDir 'Nava.exe'))) 'The machine-wide Nava executable remains.'
Assert-Condition (-not (Test-Path "HKCU:\$legacyKey")) 'The per-user Nava registration remains.'
Assert-Condition (-not (Test-Path "HKLM:\$legacyKey")) 'The machine-wide Nava registration remains.'
Assert-Condition (-not (Test-Path "HKCU:\$currentKey")) 'A duplicate per-user Rooyesh registration remains.'
Assert-Condition ((Get-ItemProperty "HKLM:\$currentKey").DisplayVersion -eq $Version) 'The registered version was not updated.'
Assert-Condition ((Get-Content -LiteralPath $sentinel -Raw).Trim() -eq 'Personal data must survive upgrade.') 'The personal profile changed during upgrade.'
Write-Output 'Installer integration checks passed: failure handling, reused directory, previous release, both legacy scopes, and profile preservation.'
