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
 let backup;
 try{
  backup=await canvas.evaluate(`localStorage.getItem('orbit-map')`);
  await pet.evaluate('window.desktop.toggle()');await sleep(1400);
  for(const selector of ['.answer','textarea']){
   await canvas.evaluate(`document.activeElement.blur()`);
   const p=await canvas.evaluate(`(()=>{const el=document.querySelector('.node');const r=el.querySelector('${selector}').getBoundingClientRect();return {x:r.x+25,y:r.y+14,left:parseFloat(el.style.left)};})()`);
   await canvas.call('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
   for(let i=1;i<=8;i++)await canvas.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+i*7,y:p.y+i*3,button:'left',buttons:1});
   await canvas.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+56,y:p.y+24,button:'left',clickCount:1});
   const next=await canvas.evaluate(`parseFloat(document.querySelector('.node').style.left)`);assert(next>p.left+20,selector+' drag');
  }
  console.log('PASS: native Windows card drag from title and answer');
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
  // 알람 도달 → 모든 모니터를 합친 영역의 가장자리를 한 바퀴 날고 제자리 복귀
  const home=await pet.evaluate('({x:screenX,y:screenY})');
  await pet.evaluate('orbitPet.setAlarmAt(Date.now()+800,{time:"07:30",label:"회의",repeat:false,sound:false})');await sleep(2300);
  assert.equal(await pet.evaluate('document.body.classList.contains("ringing")&&document.querySelector(".pet").classList.contains("flying")'),true,'alarm starts the flight');
  const mid=await pet.evaluate('({x:screenX,y:screenY})');assert(mid.x!==home.x||mid.y!==home.y,'pet flies away from its spot');
  await petShot('windows-pet-flight.png');
  let reach={x:0,y:0};
  for(let i=0;i<60&&await pet.evaluate('document.querySelector(".pet").classList.contains("flying")');i++){const p=await pet.evaluate('({x:screenX,y:screenY})');reach={x:Math.max(reach.x,p.x),y:Math.max(reach.y,p.y)};await sleep(250);}
  const back=await pet.evaluate('({x:screenX,y:screenY,flying:document.querySelector(".pet").classList.contains("flying"),ringing:document.body.classList.contains("ringing"),alarmAt:orbitPet.alarmAt,panel:!document.querySelector("#alarm").hidden})');
  assert.equal(back.flying,false);assert.equal(back.x,home.x);assert.equal(back.y,home.y);assert.equal(back.ringing,true);assert.equal(back.alarmAt,0);assert.equal(back.panel,true,'landing shows the 확인 / 5분 뒤 다시 panel');
  console.log(`PASS: native Windows alarm flight (home ${home.x},${home.y} → farthest ${reach.x},${reach.y})`);
  await pet.evaluate('document.querySelector("#alarm-stop").click()');assert.equal(await pet.evaluate('document.body.classList.contains("ringing")'),false);
  await pet.evaluate('document.querySelector(".pet").click()');await sleep(1700);
  assert.equal(await canvas.evaluate('!document.body.classList.contains("cape-closing")'),true);
  console.log('PASS: native Windows cape animation');
 }finally{
  if(backup!==undefined)await canvas.evaluate(`localStorage.setItem('orbit-map',${JSON.stringify(backup)});location.reload()`);
  canvas.close();pet.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
