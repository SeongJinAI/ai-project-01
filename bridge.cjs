const { spawn } = require('node:child_process');
const path = require('node:path');
let active;
function request(action, prompt, onEvent = () => {}) {
 if (process.platform !== 'win32') return Promise.reject(new Error('Windows 앱으로 실행해야 자동 연결할 수 있습니다.'));
 if (active) return Promise.reject(new Error('이전 연결 작업이 진행 중입니다.'));
 return new Promise((resolve, reject) => {
  const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'bridge.ps1'),'-Action',action], {windowsHide:true,stdio:['pipe','pipe','pipe']});
  active = child; let buffer='', result, error, stderr='';
  const timer=setTimeout(()=>{error=new Error('연결 시간이 초과되었습니다. 재전송 전에 Claude를 확인하세요.');child.kill();},140000);
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line)continue;try{const event=JSON.parse(line);if(event.type==='error')error=new Error(event.message);if(event.type==='ready'||event.type==='answer')result=event;onEvent(event);}catch{}}});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
  child.on('error',e=>{error=e;});
  child.on('close',()=>{clearTimeout(timer);active=null;if(error)reject(error);else if(result)resolve(result);else reject(new Error(stderr||'연결 작업이 종료되었습니다.'));});
  child.stdin.on('error',()=>{});child.stdin.end(action==='send'?JSON.stringify({prompt}):'');
 });
}
function cancel(){if(active)active.kill();}
module.exports={request,cancel};
