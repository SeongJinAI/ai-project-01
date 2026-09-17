$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
$dir=Join-Path $env:LOCALAPPDATA 'OrbitDemo'
$profile=Join-Path $env:TEMP ('orbit-native-test-'+[guid]::NewGuid().ToString('N'))
$env:ORBIT_DEBUG_PORT='9225'
$process=Start-Process -FilePath (Join-Path $dir 'node_modules/electron/dist/electron.exe') -ArgumentList @(('"'+$dir+'"'),('--user-data-dir="'+$profile+'"'),'--remote-debugging-port=9225') -WorkingDirectory $dir -PassThru
$resultCode=1
try {
 $ready=$false
 for($i=0;$i -lt 30;$i++){
  try {$targets=Invoke-RestMethod http://127.0.0.1:9225/json/list; if(@($targets).Count -ge 2){$ready=$true;break}}catch{}
  Start-Sleep -Milliseconds 300
 }
 if(!$ready){throw 'Windows test app did not start.'}
 & node.exe (Join-Path $PSScriptRoot 'native-smoke.cjs')
 $resultCode=$LASTEXITCODE
} finally {
 & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
 Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}
exit $resultCode
