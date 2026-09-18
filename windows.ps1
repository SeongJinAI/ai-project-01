$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$source = $PSScriptRoot
$destination = Join-Path $env:LOCALAPPDATA 'OrbitDemo'
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $destination 'node_modules\electron\dist\electron.exe') } | Stop-Process -Force
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$files = @('main.cjs', 'preload.cjs', 'index.html', 'app.js', 'style.css', 'pet.html', 'pet.js', 'pet.css', 'bridge.cjs', 'bridge.ps1', 'errors.cjs', 'cli.cjs', 'detect.cjs', 'backends.cjs')
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $source $file) -Destination $destination -Force }
Copy-Item -LiteralPath (Join-Path $source 'assets') -Destination $destination -Recurse -Force
$version = (Get-Content -LiteralPath (Join-Path $source 'node_modules/electron/package.json') -Raw | ConvertFrom-Json).version
$package = @{ name = 'orbit-desktop'; version = '0.1.0'; private = $true; main = 'main.cjs'; devDependencies = @{ electron = $version } } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $destination 'package.json'), $package)
$executable = Join-Path $destination 'node_modules\electron\dist\electron.exe'
$installed = Join-Path $destination 'node_modules\electron\package.json'
if (!(Test-Path $executable) -or !(Test-Path $installed) -or (Get-Content $installed -Raw | ConvertFrom-Json).version -ne $version) {
    Write-Output 'Installing Windows Electron (first launch)...'
    Push-Location $destination
    try {
        & npm.cmd install --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { throw 'Windows Electron installation failed.' }
    } finally { Pop-Location }
}
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Orbit.lnk'
if (!(Test-Path $shortcutPath)) {
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $executable
    $shortcut.Arguments = '"' + $destination + '"'
    $shortcut.WorkingDirectory = $destination
    $shortcut.Description = 'Orbit - desktop brainstorming companion'
    $shortcut.Save()
}
$process = Start-Process -FilePath $executable -ArgumentList ('"' + $destination + '"') -WorkingDirectory $destination -PassThru
Write-Output "Windows Orbit launched. PID=$($process.Id) Location=$destination"
