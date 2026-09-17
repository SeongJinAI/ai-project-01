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
function Invoke($element) { if(!$element){throw 'Required app control was not found.'}; $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() }
function Value($element) { return $element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern) }
try {
 $process=Get-Process claude -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
 if(!$process){
  $running=Get-Process claude -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1
  if($running){
   if($running.Path -match 'WindowsApps'){$appId=Get-StartApps | Where-Object AppID -like 'Claude_*!Claude' | Select-Object -First 1; if(!$appId){throw 'Claude app launch entry was not found.'}; Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\'+$appId.AppID)}else{Start-Process -FilePath $running.Path}
   Start-Sleep -Milliseconds 1500; $process=Get-Process claude | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1}
 }
 if(!$process){throw 'Claude desktop is not running. Open Claude and sign in first.'}
 [OrbitWindow]::ShowWindowAsync($process.MainWindowHandle,9)|Out-Null
 Start-Sleep -Milliseconds 900
 $script:root=[Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
 $editor=Editor
 if(!$editor){throw 'Claude chat input is unavailable. Open a chat in Claude first.'}
 $value=Value $editor
 if($value.Current.IsReadOnly){throw 'Claude input is read-only.'}
 if($Action -eq 'status'){Emit @{type='ready';app='Claude';transport='Windows UI Automation';clipboard=$false};exit 0}
 $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
 if(!$request.prompt -or $request.prompt.Length -gt 30000){throw 'Prompt must contain 1-30000 characters.'}
 if($value.Current.Value.Trim()){throw 'Claude has an unsent draft. Send or clear it before connecting Orbit.'}
 if(Button '^(Stop response|Stop generating|응답 중지|생성 중지|중지)$'){throw 'Claude is already responding. Wait for it to finish.'}
 # Each card gets a fresh chat, with only its parent chain as context.
 Invoke (Button '^(새로 생성|새 채팅|새 대화|New chat|New conversation)$')
 Start-Sleep -Milliseconds 1100
 $editor=Editor
 if(!$editor){throw 'New chat input was not found.'}
 $value=Value $editor
 if($value.Current.Value.Trim()){throw 'New chat has an existing draft; Orbit did not replace it.'}
 $value.SetValue([string]$request.prompt)
 Start-Sleep -Milliseconds 400
 $actual=(Value (Editor)).Current.Value
 if(($actual -replace '\s+',' ').Trim() -ne ($request.prompt -replace '\s+',' ').Trim()){throw 'Claude did not accept the prompt. Nothing was sent.'}
 $send=Button '^(메시지 보내기|보내기|전송|프롬프트 보내기|Send message|Send|Send prompt)$'
 if(!$send){throw 'Send button was not found. Your prompt remains in Claude as a draft.'}
 Invoke $send
 Emit @{type='sent';app='Claude'}
 $deadline=[DateTime]::UtcNow.AddSeconds(120);$last='';$stable=0
 while([DateTime]::UtcNow -lt $deadline){
  Start-Sleep -Milliseconds 1000
  $all=Elements
  $good=@($all | Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.Name -match '^(좋은 답변|Good response|Good answer)$'}) | Select-Object -Last 1
  $stop=@($all | Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.Name -match '^(Stop response|Stop generating|응답 중지|생성 중지|중지)$'})
  if(!$good -or $stop.Count){continue}
  $walker=[Windows.Automation.TreeWalker]::ControlViewWalker
  $answer=$walker.GetParent($walker.GetParent($good))
  $texts=$answer.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Text))
  # Claude exposes an accessible answer label. It excludes thinking/status/toolbar text.
  $label=@($texts | Where-Object { $_.Current.ClassName -match 'sr-only' -and $_.Current.Name -match '^(Claude 응답:|Claude response:)' }) | Select-Object -First 1
  if(!$label){throw 'Claude answer format changed. Check the reply in Claude; Orbit did not import unrelated text.'}
  $text=($label.Current.Name -replace '^(Claude 응답:|Claude response:)\s*','').Trim()
  if(!$text){continue}
  if($text -eq $last){$stable++}else{$stable=0;$last=$text}
  if($stable -ge 2){Emit @{type='answer';text=$text;app='Claude'};exit 0}
 }
 throw 'Reply timed out. The prompt was sent; check Claude before retrying.'
} catch { Emit @{type='error';message=$_.Exception.Message};exit 1 }
