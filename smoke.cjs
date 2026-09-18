const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-test-'));
 // 가짜 CLI로 Codex/Claude Code 어댑터를 검증한다(실제 CLI·사용량을 쓰지 않음).
 const fakeCli=path.resolve(__dirname,'test/fake-cli.cjs'),fakeLogPath=path.join(profile,'fake-cli.log');
 let app, clipboardBackup;
 try {
 app=await electron.launch({executablePath:process.env.ORBIT_EXECUTABLE,args:[process.env.ORBIT_APP || '.',`--user-data-dir=${profile}`],env:{...process.env,ORBIT_CLI_CODEX:fakeCli,ORBIT_CLI_CLAUDE:fakeCli,ORBIT_CLI_DIRECT:'1',FAKE_CLI_LOG:fakeLogPath,ORBIT_CODEX_HOME:path.join(profile,'codex-home')}});
 if(process.platform!=='win32') clipboardBackup=await app.evaluate(({clipboard})=>({text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF()}));
 console.log('Test: Electron started');
 const isCanvasVisible=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).isVisible());
 const waitClipboard=async accept=>{let text='';for(let i=0;i<30;i++){text=await app.evaluate(({clipboard})=>clipboard.readText());if(accept(text))return text;await new Promise(r=>setTimeout(r,100));}return text;};
 let page;
 for(let i=0;i<50;i++){page=app.windows().find(w=>w.url().endsWith('index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}
 assert(page,'canvas window loaded');
 page.on('pageerror',e=>console.error('canvas page error:',e.message)); // 렌더러 예외를 테스트 로그에 남긴다
 await page.waitForSelector('.node',{state:'attached'});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).show());
 await page.waitForFunction(()=>[...document.querySelectorAll('#mode option')].some(o=>o.value==='codex-cli'),{},{timeout:10000}); // 탐지 완료 후 시작
 await page.locator('#mode').selectOption('demo'); // 앞부분 카드 검증은 데모 답변으로
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
 // 카드 크기 조절: 손잡이 드래그로 너비·답변 높이가 바뀌고 저장된다. 더블클릭은 기본 크기. 제목은 줄 수에 맞게 자동으로 늘어난다.
 await page.locator('#select').click();
 const sizeBefore=await firstCard.evaluate(el=>({w:parseFloat(el.style.width),answer:el.querySelector('.answer').getBoundingClientRect().height,titleH:el.querySelector('textarea').getBoundingClientRect().height}));
 const grip=await firstCard.locator('.resize').boundingBox();
 await page.evaluate(()=>{window.__rlog=[];const orig=window.onpointermove;window.onpointermove=e=>{const g=gesture;orig(e);if(g)window.__rlog.push(`${g.type} cx=${e.clientX} gx=${g.x} ow=${g.ow} scale=${scale} w=${g.n&&g.n.w}`);};}); // 진단용
 await page.mouse.move(grip.x+8,grip.y+8);await page.mouse.down();await page.mouse.move(grip.x+8+150,grip.y+8+120,{steps:6});await page.mouse.up();
 if(parseFloat(await firstCard.evaluate(el=>el.style.width))>600)console.error('resize diagnostics:',grip,await page.evaluate(()=>window.__rlog.join(' | ')));
 const zoom=await page.evaluate(()=>scale);const sizeAfter=await firstCard.evaluate(el=>({w:parseFloat(el.style.width),answer:el.querySelector('.answer').getBoundingClientRect().height,left:parseFloat(el.style.left)}));
 const expectedW=Math.min(720,Math.round(sizeBefore.w+150/zoom));
 assert(Math.abs(sizeAfter.w-expectedW)<=2,`width grows by the drag ÷ zoom (${sizeBefore.w} → ${sizeAfter.w}, expected ${expectedW} at zoom ${zoom})`);
 assert(sizeAfter.answer>sizeBefore.answer+60*zoom,`answer area grows by the drag (${sizeBefore.answer} → ${sizeAfter.answer})`);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('orbit-map'))[0]);assert.equal(saved.w,sizeAfter.w);assert(saved.h>=80,'height is saved');
 await firstCard.locator('textarea').fill('아주 긴 제목을 넣어서 두 줄이나 세 줄로 넘치게 만들어 보는 질문입니다. 이 제목은 잘리지 않아야 합니다.');
 const titleH=await firstCard.evaluate(el=>el.querySelector('textarea').getBoundingClientRect().height);assert(titleH>sizeBefore.titleH+20,`title box grows with content (${sizeBefore.titleH} → ${titleH})`);
 await firstCard.locator('textarea').fill('우주');
 await firstCard.locator('.resize').dblclick();
 const reset=await firstCard.evaluate(el=>({w:parseFloat(el.style.width),h:el.querySelector('.answer').style.height}));assert.equal(reset.w,290);assert.equal(reset.h,'');
 console.log('Test: card resize handle and auto-growing title passed');

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
 await page.locator('#mode').selectOption('manual');
 await page.locator('.node.selected .send').click();
 const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert.match(copied,/블랙홀의 탄생/);assert.match(copied,/이어지는 질문/);
 await app.evaluate(({clipboard})=>clipboard.writeText('실제 앱 답변 테스트 <script>안전한 텍스트</script>'));
 await page.locator('.node.selected .paste').click();assert.match(await page.locator('.node.selected .answer').innerText(),/<script>/);
 }
 console.log('Test: card checks passed (clipboard check only on Linux)');
 await page.reload();await page.waitForSelector('.node');assert.equal(await page.locator('.node').count(),5);
 const area=await page.locator('#canvas').boundingBox();
 // 빈 곳 드래그는 화면 이동(카드 수 불변), Ctrl+드래그는 카드 생성
 const offsetBefore=await page.evaluate(()=>({...offset}));
 await page.mouse.move(area.x+30,area.y+300);await page.mouse.down();await page.mouse.move(area.x+130,area.y+360,{steps:4});await page.mouse.up();
 const offsetAfter=await page.evaluate(()=>({...offset}));assert.equal(await page.locator('.node').count(),5,'plain drag must not create a card');
 assert(Math.abs(offsetAfter.x-offsetBefore.x-100)<2&&Math.abs(offsetAfter.y-offsetBefore.y-60)<2,`plain drag pans the canvas (${JSON.stringify(offsetBefore)} → ${JSON.stringify(offsetAfter)})`);
 await page.keyboard.down('Control');await page.mouse.move(area.x+30,area.y+300);await page.mouse.down();await page.mouse.move(area.x+300,area.y+430);await page.mouse.up();await page.keyboard.up('Control');assert.equal(await page.locator('.node').count(),6,'Ctrl+drag creates a card');
 // 휠: 화면 이동, Ctrl+휠: 커서 기준 확대
 const o1=await page.evaluate(()=>({...offset}));await page.mouse.move(area.x+400,area.y+300);await page.mouse.wheel(0,120);await page.waitForTimeout(100);
 const o2=await page.evaluate(()=>({...offset}));assert(o2.y<o1.y-100,'wheel pans the canvas vertically');
 const s1=await page.evaluate(()=>scale);await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');await page.waitForTimeout(100);
 const s2=await page.evaluate(()=>scale);assert(s2>s1,`Ctrl+wheel zooms in (${s1} → ${s2})`);assert.match(await page.locator('#zoom').innerText(),/\d+%/);
 await page.locator('#select').click();
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
 // 알람 시각 도달: 고양이 창은 숨고, 모든 모니터를 덮는 오버레이 안에서 고양이가 대각선으로 날다가 제자리로 돌아온다. 반복 알람은 다음 07:30으로 다시 예약된다.
 const petBounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('pet.html')).getBounds());
 const petVisible=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('pet.html')).isVisible());
 const overlayVisible=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=flight')).isVisible());
 const overlay=app.windows().find(w=>w.url().includes('mode=flight'));assert(overlay,'flight overlay window is loaded at startup');
 assert.equal(await overlayVisible(),false,'overlay stays hidden until a flight');
 const home=await petBounds();
 await pet.evaluate(()=>orbitPet.setAlarmAt(Date.now()+1200,{time:'07:30',label:'회의',repeat:true,sound:false}));
 await pet.waitForFunction(()=>document.body.classList.contains('ringing')&&document.querySelector('.pet').classList.contains('flying'),{},{timeout:6000});
 assert.match(await pet.locator('.clock').evaluate(el=>el.textContent),/⏰ \d{2}:\d{2} 회의/); // 비행 중에는 시계가 숨겨져 innerText가 비므로 textContent로 확인
 await overlay.waitForFunction(()=>document.querySelector('.pet').classList.contains('flying'),{},{timeout:3000});
 assert.equal(await overlayVisible(),true,'overlay is shown for the flight');
 assert.equal(await pet.evaluate(()=>getComputedStyle(document.querySelector('.pet')).visibility),'hidden','pet window content hides while the overlay cat flies');
 const spot=()=>overlay.evaluate(()=>document.querySelector('.pet').style.transform);
 const first=await spot();await overlay.waitForTimeout(700);const second=await spot();
 assert(first!==second&&/translate\(/.test(second),`overlay cat moves across the screen (${first} → ${second})`);
 assert.match(await overlay.evaluate(()=>document.querySelector('.pet').style.getPropertyValue('--fly-angle')),/deg$/);
 await pet.waitForFunction(()=>!document.querySelector('.pet').classList.contains('flying'),{},{timeout:25000});
 assert.equal(await overlayVisible(),false,'overlay hides after landing');assert.equal(await petVisible(),true,'pet window stays');
 assert.equal(await pet.evaluate(()=>getComputedStyle(document.querySelector('.pet')).visibility),'visible','pet content is back after landing');
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

 // AI 백엔드(가짜 CLI): 탐지·기본 선택 → 새 대화 → 이어가기 → 재개 실패 복구 → 한도 오류 → Claude Code 전환
 await pet.locator('.pet').click();await page.waitForTimeout(1300);
 const fakeLog=()=>fs.existsSync(fakeLogPath)?fs.readFileSync(fakeLogPath,'utf8').trim().split('\n').map(l=>JSON.parse(l)):[];
 await page.locator('#mode').hover();
 await page.waitForFunction(()=>[...document.querySelectorAll('#mode option')].some(o=>o.value==='codex-cli'&&!o.disabled),{},{timeout:10000});
 const optionText=await page.evaluate(()=>[...document.querySelectorAll('#mode option')].map(o=>`${o.value}:${o.disabled?'off':'on'}`).join(','));
 assert.match(optionText,/codex-cli:on/);assert.match(optionText,/claude-code:on/);assert.match(optionText,/claude-desktop:off/);assert.match(optionText,/demo:on/);assert.match(optionText,/manual:on/);
 await page.locator('#mode').selectOption('codex-cli');
 await page.locator('#add').click();await page.locator('.node.selected textarea').fill('가짜 "질문" `하나`\n둘째 줄');await page.locator('.node.selected .send').click();
 await page.waitForFunction(()=>/가짜 Codex 답변/.test(document.querySelector('.node.selected .answer')?.textContent||''),{},{timeout:10000});
 let log=fakeLog();assert.equal(log.length,1);assert.equal(log[0].kind,'codex');assert.deepEqual(log[0].args.slice(0,3),['exec','--json','--skip-git-repo-check']);assert(log[0].args.includes('read-only'),'codex runs in the read-only sandbox');
 assert(log[0].input.includes('가짜 "질문" `하나`\n둘째 줄'),'prompt reaches the CLI verbatim through stdin');assert(log[0].input.includes('마인드맵 브레인스토밍 중입니다'),'first message carries the framing');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('orbit-threads'))['codex-cli']),'fake-thread-1');
 assert.match(await page.locator('.node.selected .meta').innerText(),/Codex · [\d.]+초 · 토큰 입력 10 · 출력 5/,'card shows backend, elapsed time and token usage');
 await page.waitForFunction(()=>/Codex 5h 12%/.test(document.querySelector('#usage').textContent),{},{timeout:8000}); // 세션 기록에서 읽은 플랜 한도
 await page.locator('#usage').click();const panel=await page.locator('#usage-panel').innerText();
 assert.match(panel,/5시간 창: 12% 사용/);assert.match(panel,/주간: 34% 사용/);assert.match(panel,/질문 1건 · 입력 10 · 출력 5 토큰/);assert.match(panel,/마지막 답변/);
 await page.locator('#usage-close').click();assert.equal(await page.locator('#usage-panel').isVisible(),false);
 await page.locator('.node.selected .branch').click();await page.locator('.node.selected textarea').fill('이어지는 질문');await page.locator('.node.selected .send').click();
 await page.waitForFunction(()=>/이어짐/.test(document.querySelector('.node.selected .answer')?.textContent||''),{},{timeout:10000});
 log=fakeLog();assert.equal(log.length,2);assert.deepEqual(log[1].args.slice(0,3),['exec','resume','fake-thread-1']);assert(log[1].args.includes('--json'));
 assert(!log[1].input.includes('아래 흐름을 참고해'),'follow-up prompt is the brief form');
 await page.locator('.node.selected .branch').click();await page.locator('.node.selected textarea').fill('[FAKE:RESUME_FAIL] 세션이 사라진 뒤 질문');await page.locator('.node.selected .send').click();
 await page.waitForFunction(()=>/가짜 Codex 답변: /.test(document.querySelector('.node.selected .answer')?.textContent||''),{},{timeout:10000});
 log=fakeLog();assert.equal(log.length,4);assert.equal(log[2].args[1],'resume');assert.equal(log[3].args[0],'exec');assert.notEqual(log[3].args[1],'resume');
 assert(log[3].input.includes('아래 흐름을 참고해'),'recovery resends the full context');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('orbit-threads'))['codex-cli']),'fake-thread-4');
 assert.match(await page.locator('#toast').innerText(),/새 대화로 이어 갔습니다/);
 const answerBefore=await page.locator('.node.selected .answer').innerText();
 await page.locator('.node.selected textarea').fill('[FAKE:RATE_LIMIT] 한도 확인');await page.locator('.node.selected .send').click();
 await page.waitForFunction(()=>/사용량 한도/.test(document.querySelector('#toast').textContent),{},{timeout:10000});
 assert.equal(await page.locator('.node.selected .answer').innerText(),answerBefore,'a failed call keeps the previous answer');
 assert.equal(await page.locator('.node.selected').evaluate(el=>el.classList.contains('busy')),false);
 console.log('Test: Codex CLI adapter (new/resume/recover/rate-limit) passed');
 await page.locator('#mode').selectOption('claude-code');
 await page.locator('.node.selected textarea').fill('클로드 코드 질문');await page.locator('.node.selected .send').click();
 await page.waitForFunction(()=>/가짜 Claude 답변/.test(document.querySelector('.node.selected .answer')?.textContent||''),{},{timeout:10000});
 log=fakeLog();const c1=log[log.length-1];assert.equal(c1.kind,'claude');assert.deepEqual(c1.args.slice(0,8),['-p','--output-format','stream-json','--include-partial-messages','--verbose','--tools','','--safe-mode']);assert(!c1.args.includes('--resume'));
 await page.waitForFunction(()=>/Claude Code 5h 41% · 주 12%/.test(document.querySelector('#usage').textContent),{},{timeout:5000}); // 스트림의 한도 이벤트
 assert.match(await page.locator('.node.selected .meta').innerText(),/Claude Code · fable-5-1 · [\d.]+초 · 토큰 입력 23\(캐시 20\) · 출력 7/,'claude meta shows model and cached tokens');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('orbit-threads'))['claude-code']),'fake-session-6');
 await page.locator('.node.selected .branch').click();await page.locator('.node.selected textarea').fill('클로드 이어서');await page.locator('.node.selected .send').click();
 await page.waitForFunction(()=>/가짜 Claude 답변\(이어짐\)/.test(document.querySelector('.node.selected .answer')?.textContent||''),{},{timeout:10000});
 log=fakeLog();const c2=log[log.length-1];assert.equal(c2.args[c2.args.indexOf('--resume')+1],'fake-session-6');
 assert.equal(await page.evaluate(()=>localStorage.getItem('orbit-backend')),'claude-code','selection persists');
 // 스트리밍: 느린 응답의 첫 조각이 최종 답변 전에 카드에 나타난다.
 await page.locator('.node.selected .branch').click();await page.locator('.node.selected textarea').fill('[FAKE:SLOW] 스트리밍 확인');await page.locator('.node.selected .send').click();
 await page.waitForFunction(()=>/가짜 Claude 답변.*▍$/.test(document.querySelector('.node.busy .answer')?.textContent||''),{},{timeout:2500});
 await page.waitForFunction(()=>/답변 기다리는 중… \d+초/.test(document.querySelector('.node.busy .send')?.textContent||''),{},{timeout:2500}); // 1초마다 경과 시간 갱신
 await page.waitForFunction(()=>{const t=document.querySelector('.node.selected .answer')?.textContent||'';return !document.querySelector('.node.busy')&&/^가짜 Claude 답변/.test(t)&&!/▍$/.test(t);},{},{timeout:10000}); // 최종 답변으로 교체되고 커서가 사라진다
 console.log('Test: Claude Code streaming shows partial answers');
 console.log('Test: Claude Code CLI adapter (new/resume) passed');
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
 console.log('PASS: Electron launcher, cards, demo responses, parent context, clipboard, shortcuts, persistence, drawing, collapse/reopen, clock, alarm flight, CLI backends');
 } finally {if(app){if(clipboardBackup)await app.evaluate(({clipboard},backup)=>clipboard.write(backup),clipboardBackup).catch(()=>{});await app.close();}fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
