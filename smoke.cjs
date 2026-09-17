const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-test-'));
 let app, clipboardBackup;
 try {
 app=await electron.launch({executablePath:process.env.ORBIT_EXECUTABLE,args:[process.env.ORBIT_APP || '.',`--user-data-dir=${profile}`]});
 if(process.platform!=='win32') clipboardBackup=await app.evaluate(({clipboard})=>({text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF()}));
 console.log('Test: Electron started');
 const isCanvasVisible=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).isVisible());
 const waitClipboard=async accept=>{let text='';for(let i=0;i<30;i++){text=await app.evaluate(({clipboard})=>clipboard.readText());if(accept(text))return text;await new Promise(r=>setTimeout(r,100));}return text;};
 let page;
 for(let i=0;i<50;i++){page=app.windows().find(w=>w.url().endsWith('index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}
 assert(page,'canvas window loaded');
 await page.waitForSelector('.node',{state:'attached'});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).show());
 assert.equal(await page.locator('.node').count(),3);
 const firstCard=page.locator('.node').first();
 for(const selector of ['.answer','textarea']) {
  await page.locator('#select').click();
  const previous=await firstCard.evaluate(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top)}));
  const hit=await firstCard.locator(selector).boundingBox();
  await page.mouse.move(hit.x+30,hit.y+12);await page.mouse.down();await page.mouse.move(hit.x+90,hit.y+42,{steps:8});await page.mouse.up();
  const current=await firstCard.evaluate(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top)}));
  assert(current.x>previous.x+30&&current.y>previous.y+10,selector+' should drag the whole card');
 }
 await firstCard.locator('textarea').click();assert.equal(await firstCard.locator('textarea').evaluate(el=>el===document.activeElement),true);
 console.log('Test: dragging from answer/title and click-to-edit passed');
 await page.evaluate(()=>{window.__survivor=document.querySelector('.node');});
 await page.locator('#add').click();await page.locator('.node.selected .top button').click();
 assert.equal(await page.evaluate(()=>window.__survivor===document.querySelector('.node')&&window.__survivor.isConnected),true);
 assert.equal(await page.locator('.node').count(),3);
 console.log('Test: deleting one card preserves sibling DOM');

 // Ctrl+W: 선택한 카드만 지우고 창은 닫지 않는다. 선택이 없으면 아무 일도 하지 않는다.
 await page.locator('#add').click();await page.locator('.node.selected textarea').fill('단축키로 지울 카드');
 assert.equal(await page.locator('.node').count(),4);
 await page.keyboard.press('Control+w');
 await page.waitForFunction(()=>document.querySelectorAll('.node').length===3);
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.node textarea')].some(t=>t.value==='단축키로 지울 카드')),false);
 assert.equal(await isCanvasVisible(),true,'Ctrl+W must not close the canvas window');
 await page.keyboard.press('Control+w');await page.waitForTimeout(300);
 assert.equal(await page.locator('.node').count(),3);assert.equal(await isCanvasVisible(),true);
 console.log('Test: Ctrl+W deletes only the selected card and keeps the window');
 if(process.platform!=='win32'){
  // Ctrl+C: 카드 선택 상태면 질문+답변을 복사하고, 글자를 선택 중이면 선택한 글자만 복사한다.
  await firstCard.locator('.answer').click();
  await app.evaluate(({clipboard})=>clipboard.writeText('초기값'));
  await page.keyboard.press('Control+c');
  const copied=await waitClipboard(text=>text!=='초기값');
  assert.match(copied,/^우주\n\n모든 질문이 시작되는/);
  const title=firstCard.locator('textarea');await title.click();await title.evaluate(el=>el.setSelectionRange(0,1));
  await page.keyboard.press('Control+c');
  assert.equal(await waitClipboard(text=>text!==copied),'우');
  console.log('Test: Ctrl+C copies the card, or only the selected text');
 }

 await page.locator('#add').click();
 const input=page.locator('.node.selected textarea');await input.fill('블랙홀의 탄생');await input.press('Enter');
 assert.match(await page.locator('.node.selected .answer').innerText(),/사건의 지평선/);
 await page.locator('.node.selected .branch').click();assert.equal(await page.locator('.node').count(),5);
 await page.locator('.node.selected textarea').fill('이어지는 질문');
 if(process.platform!=='win32'){
 await page.locator('#mode').selectOption('desktop');
 await page.locator('.node.selected .send').click();
 const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert.match(copied,/블랙홀의 탄생/);assert.match(copied,/이어지는 질문/);
 await app.evaluate(({clipboard})=>clipboard.writeText('실제 앱 답변 테스트 <script>안전한 텍스트</script>'));
 await page.locator('.node.selected .paste').click();assert.match(await page.locator('.node.selected .answer').innerText(),/<script>/);
 }
 console.log('Test: card checks passed (clipboard check only on Linux)');
 await page.reload();await page.waitForSelector('.node');assert.equal(await page.locator('.node').count(),5);
 const area=await page.locator('#canvas').boundingBox();
 await page.mouse.move(area.x+30,area.y+300);await page.mouse.down();await page.mouse.move(area.x+300,area.y+430);await page.mouse.up();assert.equal(await page.locator('.node').count(),6);
 await page.locator('#home').click();
 fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/orbit-demo.png'});
 await page.keyboard.press('Escape');
 await page.waitForTimeout(750);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).isVisible()),false);
 console.log('Test: canvas drawing/collapse passed');
 const pet=app.windows().find(w=>w.url().endsWith('pet.html'));await pet.locator('.pet').click();
 await page.waitForTimeout(1100);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).isVisible()),true);
 await page.keyboard.press('Escape');await page.waitForTimeout(750);
 const before=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('pet.html')).getBounds());
 await pet.locator('#larger').click();
 await pet.waitForFunction(()=>document.querySelector('#pet-size').textContent==='110%');
 const bigger=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('pet.html')).getBounds());assert(bigger.width>before.width);
 await pet.locator('#smaller').click();await pet.waitForFunction(()=>document.querySelector('#pet-size').textContent==='100%');
 const cat=await pet.locator('.pet').boundingBox();await pet.mouse.move(cat.x+cat.width/2,cat.y+cat.height/2);await pet.mouse.down();await pet.mouse.move(cat.x+cat.width/2+35,cat.y+cat.height/2+20,{steps:5});await pet.mouse.up();
 const moved=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('pet.html')).getBounds());assert(moved.x!==before.x||moved.y!==before.y);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).isVisible()),false);

 console.log('Test: pet drag and resize passed');

 // 고양이 머리 위 시계
 const shown=await pet.locator('#time').innerText();
 const expected=await pet.evaluate(()=>{const p=n=>String(n).padStart(2,'0');const d=new Date(),m=new Date(d-60000);return [d,m].map(t=>`${p(t.getHours())}:${p(t.getMinutes())}`);});
 assert(expected.includes(shown),`clock shows the system time (${shown} vs ${expected})`);
 // 알람 설정: 시계를 눌러 패널을 열고 시각·메모·매일 반복을 입력하면 다음 07:30에 예약되고, 재시작 후에도 남는다.
 await pet.locator('.clock').click();assert.equal(await pet.locator('#alarm').isVisible(),true);
 await pet.locator('#alarm-time').fill('07:30');await pet.locator('#alarm-label').fill('회의');await pet.locator('#alarm-repeat').check();await pet.locator('#alarm-sound').uncheck();
 await pet.locator('#alarm button[type=submit]').click();
 assert.equal(await pet.locator('#alarm').isVisible(),false);
 let alarm=await pet.evaluate(()=>orbitPet.alarm),at=new Date(alarm.at);
 assert(alarm.at>Date.now()&&alarm.at-Date.now()<=86400000&&at.getHours()===7&&at.getMinutes()===30&&at.getSeconds()===0,'alarm is scheduled for the next 07:30');
 assert.deepEqual([alarm.time,alarm.label,alarm.repeat,alarm.sound],['07:30','회의',true,false]);
 assert.match(await pet.locator('.clock').innerText(),/07:30/);
 await pet.reload();await pet.waitForFunction(()=>window.orbitPet&&orbitPet.alarmAt>0);
 assert.deepEqual(await pet.evaluate(()=>orbitPet.alarm),alarm,'alarm survives a restart');
 await pet.locator('.clock').click();assert.match(await pet.locator('#alarm-status').innerText(),/07:30 \(.+ 후\) · 회의 · 매일/);
 // 프리셋: +30분은 지금부터 30분 뒤로 잡는다.
 await pet.locator('.alarm-presets button[data-minutes="30"]').click();
 const preset=await pet.evaluate(()=>orbitPet.alarmAt);assert(Math.abs(preset-(Date.now()+30*60000))<3000,'preset schedules 30 minutes ahead');
 await pet.locator('.clock').click();await pet.locator('#alarm-clear').click();
 assert.equal(await pet.evaluate(()=>orbitPet.alarmAt),0);assert.doesNotMatch(await pet.locator('.clock').innerText(),/⏰/);
 console.log('Test: alarm set/persist/preset/clear passed');
 // 알람 시각 도달: 종이 울리고 화면 한 바퀴 비행 후 제자리 복귀. 반복 알람은 다음 07:30으로 다시 예약되고 캔버스는 열리지 않는다.
 const petBounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('pet.html')).getBounds());
 const home=await petBounds();
 await pet.evaluate(()=>orbitPet.setAlarmAt(Date.now()+1200,{time:'07:30',label:'회의',repeat:true,sound:false}));
 await pet.waitForFunction(()=>document.body.classList.contains('ringing')&&document.querySelector('.pet').classList.contains('flying'),{},{timeout:6000});
 assert.match(await pet.locator('.clock').innerText(),/⏰ \d{2}:\d{2} 회의/);
 await pet.waitForTimeout(900);
 const mid=await petBounds();assert(mid.x!==home.x||mid.y!==home.y,'pet flies away from its spot');
 assert.match(await pet.evaluate(()=>document.querySelector('.pet').style.getPropertyValue('--fly-angle')),/deg$/);
 await pet.waitForFunction(()=>!document.querySelector('.pet').classList.contains('flying'),{},{timeout:15000});
 const back=await petBounds();assert.equal(back.x,home.x);assert.equal(back.y,home.y);
 alarm=await pet.evaluate(()=>orbitPet.alarm);at=new Date(alarm.at);
 assert(alarm.at>Date.now()&&at.getHours()===7&&at.getMinutes()===30,'repeating alarm is re-armed for the next 07:30');
 assert.equal(await isCanvasVisible(),false,'flight must not open the canvas');
 assert.equal(await pet.locator('#alarm .ring-actions').isVisible(),true,'landing shows 확인 / 5분 뒤 다시');
 await pet.locator('#alarm-snooze').click();
 const snoozed=await pet.evaluate(()=>orbitPet.alarm);
 assert.equal(await pet.evaluate(()=>document.body.classList.contains('ringing')),false);
 assert(Math.abs(snoozed.at-(Date.now()+5*60000))<3000&&snoozed.time==='07:30'&&snoozed.repeat===true,'snooze rings again in 5 minutes and keeps the daily time');
 await pet.evaluate(()=>orbitPet.clearAlarm());
 console.log('Test: alarm flight passed');
 if(process.env.ORBIT_LIVE_CLAUDE==='1') {
  await pet.locator('.pet').click();await page.waitForTimeout(1700);
  await page.locator('#mode').selectOption('auto');await page.locator('#add').click();
  await page.locator('.node.selected textarea').fill('블랙홀이 무엇인지 한국어로 한 문장만 설명해 줘.');
  console.log('Test: sending live question');
  await page.locator('.node.selected .send').click();
  await page.waitForFunction(()=>!autoBusy,{},{timeout:140000});
  assert.match(await page.locator('.node.selected .answer').innerText(),/블랙홀/,await page.locator('#toast').innerText());
  const answer=await page.locator('.node.selected .answer').innerText();
  assert(!answer.includes('Claude 응답:'));assert(!answer.includes('준비를 하는 중'));
  await page.screenshot({path:'artifacts/windows-live-claude.png'});
  console.log('PASS: native Windows UI -> Claude desktop -> clean answer card (no clipboard)');
 }
 console.log('PASS: Electron launcher, cards, demo responses, parent context, clipboard, shortcuts, persistence, drawing, collapse/reopen, clock, alarm flight');
 } finally {if(app){if(clipboardBackup)await app.evaluate(({clipboard},backup)=>clipboard.write(backup),clipboardBackup).catch(()=>{});await app.close();}fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
