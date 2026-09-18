param([ValidateSet('status','send')][string]$Action='status')
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new()
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices;
public class OrbitWindow {
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int cmd);
}
'@
function Emit($data) { [Console]::WriteLine(($data | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }
function Elements { return $script:root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition) }
function Editor { return @(Elements | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -and $_.Current.ClassName -match 'ProseMirror' -and $_.Current.IsEnabled }) | Select-Object -Last 1 }
function Button($pattern) { return @(Elements | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.Name -match $pattern -and $_.Current.IsEnabled -and !$_.Current.IsOffscreen }) | Select-Object -Last 1 }
function Invoke($element,$label='필요한 컨트롤') { if(!$element){throw ('Claude 앱에서 ' + $label + '을(를) 찾지 못했습니다.')}; $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() }
function Preview($text) { $t=($text -replace '\s+',' ').Trim(); if($t.Length -gt 20){$t=$t.Substring(0,20)+'…'}; return $t }
function Value($element) { return $element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern) }
try {
 $process=Get-Process claude -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
 if(!$process){
  $running=Get-Process claude -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1
  if($running){
   if($running.Path -match 'WindowsApps'){$appId=Get-StartApps | Where-Object AppID -like 'Claude_*!Claude' | Select-Object -First 1; if(!$appId){throw 'Claude 앱 실행 항목을 찾지 못했습니다.'}; Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\'+$appId.AppID)}else{Start-Process -FilePath $running.Path}
   Start-Sleep -Milliseconds 1500; $process=Get-Process claude | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1}
 }
 if(!$process){throw 'Claude 데스크톱이 실행 중이 아닙니다. Claude를 열고 로그인한 뒤 다시 시도하세요.'}
 [OrbitWindow]::ShowWindowAsync($process.MainWindowHandle,9)|Out-Null
 Start-Sleep -Milliseconds 900
 $script:root=[Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
 $editor=Editor
 if(!$editor){throw 'Claude 입력창을 찾을 수 없습니다. Claude에서 채팅 화면을 먼저 열어 주세요.'}
 $value=Value $editor
 if($value.Current.IsReadOnly){throw 'Claude 입력창이 읽기 전용 상태입니다.'}
 $draft=Preview $value.Current.Value
 if($Action -eq 'status'){Emit @{type='ready';app='Claude';transport='Windows UI Automation';clipboard=$false;draft=$draft};exit 0}
 $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
 if(!$request.prompt -or $request.prompt.Length -gt 30000){throw '질문은 1~30,000자여야 합니다.'}
 if($draft){throw ('Claude 입력창에 보내지 않은 초안 ' + [char]0x201C + $draft + [char]0x201D + '이(가) 있습니다. Claude에서 보내거나 지운 뒤 다시 시도하세요.')}
 if(Button '^(Stop response|Stop generating|응답 중지|생성 중지|중지)$'){throw 'Claude가 아직 답변 중입니다. 끝난 뒤 다시 시도하세요.'}
 # 같은 대화를 이어갈 때는 지금 열린 채팅에 그대로 보낸다. 이전 답변을 새 답변으로 착각하지 않도록 마지막 답변의 식별자를 기억해 둔다.
 $goodPattern='^(좋은 답변|Good response|Good answer)$'
 $lastGood=@(Elements | Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.Name -match $goodPattern}) | Select-Object -Last 1
 $lastId=if($lastGood){$lastGood.GetRuntimeId() -join '.'}else{''}
 if($request.newChat){
  # 카드마다 새 대화: 부모 카드 흐름만 프롬프트에 담아 새 채팅에서 시작한다.
  Invoke (Button '^(새로 생성|새 채팅|새 대화|New chat|New conversation)$') '새 채팅 버튼'
  Start-Sleep -Milliseconds 1100
  $editor=Editor
  if(!$editor){throw '새 채팅의 입력창을 찾지 못했습니다.'}
  $value=Value $editor
  if(Preview $value.Current.Value){throw '새 채팅에 이미 초안이 있어 Orbit이 덮어쓰지 않았습니다.'}
  $lastId=''
 }
 $value.SetValue([string]$request.prompt)
 Start-Sleep -Milliseconds 400
 $actual=(Value (Editor)).Current.Value
 if(($actual -replace '\s+',' ').Trim() -ne ($request.prompt -replace '\s+',' ').Trim()){throw 'Claude가 질문을 받아들이지 않았습니다. 아무것도 전송되지 않았습니다.'}
 $send=Button '^(메시지 보내기|보내기|전송|프롬프트 보내기|Send message|Send|Send prompt)$'
 if(!$send){throw '보내기 버튼을 찾지 못했습니다. 질문은 Claude 입력창에 초안으로 남아 있습니다.'}
 Invoke $send
 Emit @{type='sent';app='Claude'}
 $deadline=[DateTime]::UtcNow.AddSeconds(120);$last='';$stable=0
 while([DateTime]::UtcNow -lt $deadline){
  Start-Sleep -Milliseconds 1000
  $all=Elements
  $good=@($all | Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.Name -match $goodPattern}) | Select-Object -Last 1
  $stop=@($all | Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.Name -match '^(Stop response|Stop generating|응답 중지|생성 중지|중지)$'})
  if(!$good -or $stop.Count){continue}
  if(($good.GetRuntimeId() -join '.') -eq $lastId){continue} # 아직 이전 답변만 있음
  $walker=[Windows.Automation.TreeWalker]::ControlViewWalker
  $answer=$walker.GetParent($walker.GetParent($good))
  $texts=$answer.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Text))
  # Claude exposes an accessible answer label. It excludes thinking/status/toolbar text.
  $label=@($texts | Where-Object { $_.Current.ClassName -match 'sr-only' -and $_.Current.Name -match '^(Claude 응답:|Claude response:)' }) | Select-Object -First 1
  if(!$label){throw 'Claude 답변 형식이 바뀌었습니다. Claude에서 답변을 확인하세요. Orbit은 관련 없는 텍스트를 가져오지 않았습니다.'}
  $text=($label.Current.Name -replace '^(Claude 응답:|Claude response:)\s*','').Trim()
  if(!$text){continue}
  if($text -eq $last){$stable++}else{$stable=0;$last=$text}
  if($stable -ge 2){Emit @{type='answer';text=$text;app='Claude'};exit 0}
 }
 throw '답변 대기 시간이 초과되었습니다. 질문은 전송되었으니 재시도 전에 Claude를 확인하세요.'
} catch { Emit @{type='error';message=$_.Exception.Message};exit 1 }
