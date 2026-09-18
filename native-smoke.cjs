// Run on Windows after launching Orbit with --remote-debugging-port=9224.
const assert = require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(target){
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let seq=0;const pending=new Map();
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
 async function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},15000);pending.set(id,m=>{clearTimeout(timer);if(m.error)reject(new Error(m.error.message));else resolve(m.result);});ws.send(JSON.stringify({id,method,params}));});}
 async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
 return {call,evaluate,close:()=>ws.close()};
}
(async()=>{
 const targets=await (await fetch(`http://127.0.0.1:${process.env.ORBIT_DEBUG_PORT || 9224}/json/list`)).json();
 const canvas=await connect(targets.find(t=>t.url.endsWith('index.html'))),pet=await connect(targets.find(t=>t.url.endsWith('pet.html')));
 let backup;const sockets=[canvas,pet]; // 실패 시에도 모두 닫아 node가 종료되게 한다.
 try{
  backup=await canvas.evaluate(`localStorage.getItem('orbit-map')`);
  await pet.evaluate('window.desktop.toggle()');await sleep(1400);
  // 진단용 계측: 제스처 취소·blur·pointercancel을 기록해 드래그 실패 시 원인을 남긴다.
  await canvas.evaluate(`window.__log=[];const _f=finishGesture;finishGesture=function(c){window.__log.push('finish(cancelled='+c+') moved='+(gesture&&gesture.moved)+' '+((new Error().stack.split('\\n')[2])||'').trim());return _f.apply(this,arguments);};['blur','pointercancel','lostpointercapture'].forEach(t=>window.addEventListener(t,e=>window.__log.push(t+' target='+(e.target&&(e.target.className||e.target.tagName)))));'ok'`);
  for(const selector of ['.answer','textarea']){
   await canvas.evaluate(`document.activeElement.blur()`);
   const p=await canvas.evaluate(`(()=>{const el=document.querySelector('.node');const r=el.querySelector('${selector}').getBoundingClientRect();return {x:r.x+25,y:r.y+14,left:parseFloat(el.style.left)};})()`);
   await canvas.call('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
   for(let i=1;i<=8;i++)await canvas.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+i*7,y:p.y+i*3,button:'left',buttons:1});
   await canvas.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+56,y:p.y+24,button:'left',clickCount:1});
   const next=await canvas.evaluate(`parseFloat(document.querySelector('.node').style.left)`);
   if(!(next>p.left+20))console.error('drag diagnostics:',selector,p,next,await canvas.evaluate('JSON.stringify(window.__log)'),'active=',await canvas.evaluate('document.activeElement&&(document.activeElement.tagName+"."+document.activeElement.className)'));
   assert(next>p.left+20,selector+' drag');
  }
  console.log('PASS: native Windows card drag from title and answer');
  // 카드 크기 조절 손잡이: 드래그 후 너비가 드래그 거리(배율 반영)만큼 커진다.
  const rs=await canvas.evaluate(`(()=>{const el=document.querySelector('.node');const r=el.querySelector('.resize').getBoundingClientRect();return {x:r.x+8,y:r.y+8,w:parseFloat(el.style.width),scale};})()`);
  await canvas.call('Input.dispatchMouseEvent',{type:'mousePressed',x:rs.x,y:rs.y,button:'left',clickCount:1});
  for(let i=1;i<=6;i++)await canvas.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:rs.x+i*20,y:rs.y+i*15,button:'left',buttons:1});
  await canvas.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:rs.x+120,y:rs.y+90,button:'left',clickCount:1});
  const rw=await canvas.evaluate(`parseFloat(document.querySelector('.node').style.width)`);
  assert(Math.abs(rw-Math.min(720,rs.w+120/rs.scale))<=2,`resize handle grows width (${rs.w} → ${rw}, zoom ${rs.scale})`);
  console.log('PASS: native Windows card resize handle');
  const deletion=await canvas.evaluate(`(()=>{const el=document.querySelector('.node');const old=el.getBoundingClientRect();window.__survivor=el;document.querySelector('#add').click();document.querySelector('.node.selected .top button').click();const now=el.getBoundingClientRect();return {same:el===document.querySelector('.node'),connected:el.isConnected,x:old.x===now.x,y:old.y===now.y,opacity:getComputedStyle(el).opacity};})()`);
  assert(deletion.same&&deletion.connected&&deletion.x&&deletion.y);assert.equal(deletion.opacity,'1');
  console.log('PASS: deleting a card preserves sibling elements and opacity');
  // Ctrl+W: 선택한 카드만 지우고 캔버스 창은 유지한다.
  const cards=await canvas.evaluate(`(()=>{document.querySelector('#add').click();return document.querySelectorAll('.node').length;})()`);
  for(const type of ['keyDown','keyUp'])await canvas.call('Input.dispatchKeyEvent',{type,key:'w',code:'KeyW',windowsVirtualKeyCode:87,nativeVirtualKeyCode:87,modifiers:2});
  await sleep(250);
  assert.equal(await canvas.evaluate(`document.querySelectorAll('.node').length`),cards-1,'Ctrl+W deletes exactly one card');
  assert.equal(await canvas.evaluate('document.visibilityState'),'visible','Ctrl+W must not close the canvas');
  console.log('PASS: native Windows Ctrl+W deletes the selected card only');
  // 설치 AI 탐지: 이 PC에는 WSL에 Codex·Claude Code가 로그인된 상태로 있다.
  const detected=await canvas.evaluate('window.desktop.detectBackends(true)');
  const byId=Object.fromEntries(detected.backends.map(b=>[b.id,b]));
  assert(byId['codex-cli']&&byId['codex-cli'].available&&byId['codex-cli'].via==='wsl',JSON.stringify(byId['codex-cli']));
  assert(byId['claude-code']&&byId['claude-code'].available&&byId['claude-code'].via==='wsl',JSON.stringify(byId['claude-code']));
  const options=await canvas.evaluate('[...document.querySelectorAll("#mode option")].map(o=>o.value+":"+(o.disabled?"off":"on")).join(",")');
  assert.match(options,/codex-cli:on/);assert.match(options,/claude-code:on/);
  console.log(`PASS: native Windows detection (codex ${byId['codex-cli'].version}, claude ${byId['claude-code'].version}, desktop=${byId['claude-desktop'].available})`);
  fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
  const shot=await canvas.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'artifacts/windows-card-drag.png'),Buffer.from(shot.data,'base64'));
  await canvas.evaluate('window.desktop.hide()');await sleep(750);
  const old=await pet.evaluate('({w:innerWidth,scale:document.querySelector("#pet-size").textContent,x:screenX,y:screenY})');
  await pet.evaluate('document.querySelector("#larger").click()');await sleep(150);assert(await pet.evaluate('innerWidth')>old.w);
  await pet.evaluate('document.querySelector("#smaller").click()');await sleep(150);assert.equal(await pet.evaluate('innerWidth'),old.w);
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type 'using System; using System.Runtime.InteropServices; public class CursorMove { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); }'; [CursorMove]::SetCursorPos(600,400) | Out-Null`]);
  await pet.evaluate(`window.desktop.petDrag('begin')`);await sleep(100);
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type 'using System; using System.Runtime.InteropServices; public class CursorMove { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); }'; [CursorMove]::SetCursorPos(670,450) | Out-Null`]);
  await pet.evaluate(`window.desktop.petDrag('move');window.desktop.petDrag('end')`);await sleep(150);
  assert(await pet.evaluate(`screenX!==${old.x}||screenY!==${old.y}`));
  console.log('PASS: native Windows pet resize and cursor-based movement');
  assert.match(await pet.evaluate('document.querySelector("#time").textContent'),/^\d{2}:\d{2}$/);
  const petShot=async name=>{const r=await pet.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'artifacts',name),Buffer.from(r.data,'base64'));};
  await petShot('windows-pet-clock.png');
  // 알람 설정 → 다음 07:30 예약, 배지 표시, 패널 스크린샷
  const alarm=await pet.evaluate(`(()=>{const at=orbitPet.setAlarm('07:30',{label:'회의',sound:false});const d=new Date(at);return {at,h:d.getHours(),m:d.getMinutes(),s:d.getSeconds(),badge:document.querySelector('.clock').textContent};})()`);
  assert(alarm.at>Date.now()&&alarm.h===7&&alarm.m===30&&alarm.s===0);assert.match(alarm.badge,/07:30/);
  await pet.evaluate('document.querySelector(".clock").click()');await sleep(100);await petShot('windows-pet-alarm-panel.png');await pet.evaluate('document.querySelector(".clock").click()');
  await pet.evaluate('orbitPet.clearAlarm()');assert.equal(await pet.evaluate('orbitPet.alarmAt'),0);
  // 알람 도달 → 고양이 창은 숨고, 모든 모니터를 덮는 오버레이에서 고양이가 대각선으로 날다가 제자리 복귀
  const overlayTargets=(await (await fetch(`http://127.0.0.1:${process.env.ORBIT_DEBUG_PORT || 9224}/json/list`)).json()).filter(t=>t.url.includes('mode=flight'));
  assert(overlayTargets.length>=1,'flight overlay window exists (one per display)');
  const overlays=[];for(const t of overlayTargets){const o=await connect(t);o.origin=await o.evaluate('({x:screenX,y:screenY,w:outerWidth,h:outerHeight})');overlays.push(o);sockets.push(o);}
  const overlay=overlays[0]; // 좌표 계산은 첫 오버레이 기준(전체 화면 좌표 = origin + translate)
  const home=await pet.evaluate('({x:screenX,y:screenY})');
  await pet.evaluate('orbitPet.setAlarmAt(Date.now()+800,{time:"07:30",label:"회의",repeat:false,sound:false})');await sleep(2300);
  assert.equal(await pet.evaluate('document.body.classList.contains("ringing")&&document.querySelector(".pet").classList.contains("flying")'),true,'alarm starts the flight');
  const origin=await overlay.evaluate('({x:screenX,y:screenY,w:outerWidth,h:outerHeight})');
  const spot=()=>overlay.evaluate('(()=>{const m=/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/.exec(document.querySelector(".pet").style.transform);return m?{x:+m[1],y:+m[2]}:null;})()');
  const first=await spot();await sleep(700);const second=await spot();
  assert(first&&second&&(first.x!==second.x||first.y!==second.y),'overlay cat moves across the screen');
  // 비행 자세 스크린샷: 고양이가 현재 들어 있는 모니터의 오버레이에서 잘라 찍는다.
  const gx=origin.x+second.x,gy=origin.y+second.y;const host=overlays.find(o=>gx>=o.origin.x&&gx<o.origin.x+o.origin.w)||overlay;
  const clip={x:Math.max(0,gx-host.origin.x-60),y:Math.max(0,gy-host.origin.y-60),width:340,height:400,scale:1};
  const flightShot=await host.call('Page.captureScreenshot',{format:'png',clip});fs.writeFileSync(path.join(__dirname,'artifacts/windows-pet-flight.png'),Buffer.from(flightShot.data,'base64'));
  let reach={x:0,y:0};
  for(let i=0;i<120&&await pet.evaluate('document.querySelector(".pet").classList.contains("flying")');i++){const p=await spot();if(p)reach={x:Math.max(reach.x,origin.x+p.x),y:Math.max(reach.y,origin.y+p.y)};await sleep(250);}
  const back=await pet.evaluate('({x:screenX,y:screenY,visible:document.visibilityState,flying:document.querySelector(".pet").classList.contains("flying"),ringing:document.body.classList.contains("ringing"),alarmAt:orbitPet.alarmAt,panel:!document.querySelector("#alarm").hidden})');
  assert.equal(back.flying,false);assert.equal(back.x,home.x);assert.equal(back.y,home.y);assert.equal(back.ringing,true);assert.equal(back.alarmAt,0);assert.equal(back.panel,true,'landing shows the 확인 / 5분 뒤 다시 panel');
  console.log(`PASS: native Windows alarm flight (home ${home.x},${home.y} → farthest ${reach.x},${reach.y}, overlay ${origin.w}x${origin.h})`);
  await pet.evaluate('document.querySelector("#alarm-stop").click()');assert.equal(await pet.evaluate('document.body.classList.contains("ringing")'),false);
  await pet.evaluate('document.querySelector(".pet").click()');await sleep(1700);
  assert.equal(await canvas.evaluate('!document.body.classList.contains("cape-closing")'),true);
  console.log('PASS: native Windows cape animation');
 }finally{
  if(backup!==undefined)await canvas.evaluate(`localStorage.setItem('orbit-map',${JSON.stringify(backup)});location.reload()`);
  sockets.forEach(s=>s.close());
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
