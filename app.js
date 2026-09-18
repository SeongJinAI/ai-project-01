const $ = s => document.querySelector(s);
const canvas = $('#canvas'), world = $('#world');
let autoBusy = false;
// AI 백엔드: 사용자가 고르는 것은 "어떤 AI"인지 하나뿐이다. 지도 하나 = 대화 하나이며 백엔드별 thread를 숨겨 저장한다.
let backends = [];
let threads = {}; try { threads = JSON.parse(localStorage.getItem('orbit-threads')) || {}; } catch {} if (typeof threads !== 'object' || Array.isArray(threads)) threads = {};
const saveThreads = () => { try { localStorage.setItem('orbit-threads', JSON.stringify(threads)); } catch {} };
const isAi = () => mode !== 'demo' && mode !== 'manual';
const backendLabel = id => (backends.find(b => b.id === id) || {}).label || id;
// 사용량: 카드마다 {backend, ms, usage:{input,cached,output}, model}을 기록하고 지도 누적치는 orbit-usage에 둔다. 플랜 잔여 한도는 CLI가 알려주지 않아 표시할 수 없다.
let usageTotal = {questions: 0, input: 0, output: 0}; try { usageTotal = {...usageTotal, ...(JSON.parse(localStorage.getItem('orbit-usage')) || {})}; } catch {}
const fmtTokens = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
function describeMeta(m){ if(!m) return ''; const parts=[backendLabel(m.backend)+(m.model?' · '+m.model.replace(/^claude-/,'').replace(/-\d{8}$/,''):''), m.ms?(m.ms/1000).toFixed(1)+'초':null]; if(m.usage) parts.push(`토큰 입력 ${fmtTokens(m.usage.input)}${m.usage.cached?'(캐시 '+fmtTokens(m.usage.cached)+')':''} · 출력 ${fmtTokens(m.usage.output)}`); return parts.filter(Boolean).join(' · '); }
// 플랜 한도(Codex: 5시간·주간 사용률)는 백엔드에서 읽어 오고 마지막 값을 저장해 둔다. Claude Code는 CLI가 한도를 노출하지 않는다.
let limits = {}; try { limits = JSON.parse(localStorage.getItem('orbit-limits')) || {}; } catch {}
let lastMeta = null;
const fmtReset = ms => { if(!ms) return ''; const d=new Date(ms), today=d.toDateString()===new Date().toDateString(); const hm=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; return today?`${hm} 초기화`:`${d.getMonth()+1}/${d.getDate()} ${hm} 초기화`; };
const levelOf = p => p>=90?'danger':p>=70?'warn':'';
function renderUsageTotal(){
 $('#saved').textContent='로컬에 저장됨';
 const chip=$('#usage'),known=[mode,'codex-cli','claude-code'].find(id=>limits[id]&&limits[id].primary),cur=known?limits[known]:null; // 선택한 AI의 한도를 우선 표시
 if(cur){chip.textContent=`사용량 · ${backendLabel(known)} 5h ${Math.round(cur.primary.usedPercent)}%${cur.secondary?` · 주 ${Math.round(cur.secondary.usedPercent)}%`:''}`;chip.className=levelOf(Math.max(cur.primary.usedPercent,cur.secondary?cur.secondary.usedPercent:0));}
 else{chip.textContent=usageTotal.questions?`사용량 · 질문 ${usageTotal.questions} · 토큰 ${fmtTokens(usageTotal.input+usageTotal.output)}`:'사용량';chip.className='';}
 if(!$('#usage-panel').hidden)renderUsagePanel();
}
function limitBlock(name,w){ if(!w) return ''; const p=Math.round(w.usedPercent); return `<p>${name}: <strong>${p}% 사용</strong> <span class="muted">· ${fmtReset(w.resetsAt)}</span></p><div class="bar"><i class="${levelOf(p)}" style="width:${Math.min(100,p)}%"></i></div>`; }
function renderUsagePanel(){
 const body=$('#usage-body');const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
 let html='';
 for(const [id,name,source,hint] of [['codex-cli','CODEX','Codex 세션 기록 기준','Codex에 질문을 한 번 보내면 5시간·주간 사용률이 표시됩니다. (chatgpt.com/codex/settings/usage)'],['claude-code','CLAUDE CODE','Claude Code 응답의 한도 이벤트 기준','Claude Code에 질문을 한 번 보내면 5시간·7일 사용률이 표시됩니다. (claude.ai/settings/usage)']]){
  const l=limits[id];html+=`<h4>플랜 한도 · ${name}</h4>`;
  if(l&&l.primary)html+=limitBlock('5시간 창',l.primary)+limitBlock(id==='codex-cli'?'주간':'7일',l.secondary)+`<p class="muted">${source} · ${new Date(l.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 읽음</p>`;
  else html+=`<p class="muted">아직 읽은 기록이 없습니다. ${hint}</p>`;
 }
 html+=`<h4>이 지도</h4><p>질문 <strong>${usageTotal.questions}</strong>건 · 입력 ${usageTotal.input.toLocaleString()} · 출력 ${usageTotal.output.toLocaleString()} 토큰</p>`;
 if(lastMeta)html+=`<h4>마지막 답변</h4><p>${esc(describeMeta(lastMeta))}</p>`;
 body.innerHTML=html;
}
async function refreshLimits(backend){
 if(!window.desktop?.backendUsage||(backend!=='codex-cli'&&backend!=='claude-code'))return;
 try{const r=await window.desktop.backendUsage({backend,thread:threads[backend]||null});if(r&&r.limits){limits[backend]=r.limits;try{localStorage.setItem('orbit-limits',JSON.stringify(limits));}catch{}renderUsageTotal();}}catch{}
}
function recordUsage(result){ usageTotal.questions+=1; if(result.usage){usageTotal.input+=result.usage.input||0;usageTotal.output+=result.usage.output||0;} try{localStorage.setItem('orbit-usage',JSON.stringify(usageTotal));}catch{} renderUsageTotal(); }
$('#usage').onclick=()=>{const panel=$('#usage-panel');panel.hidden=!panel.hidden;if(!panel.hidden){renderUsagePanel();refreshLimits('codex-cli');refreshLimits('claude-code');}};
$('#usage-close').onclick=()=>{$('#usage-panel').hidden=true;};
$('#usage-refresh').onclick=()=>{refreshLimits('codex-cli');refreshLimits('claude-code');toast('사용량을 다시 읽었습니다.');};
let nodes, selected, mode = 'demo', scale = 1, offset = {x:0,y:0}, gesture, toastTimer;
try { nodes = JSON.parse(localStorage.getItem('orbit-map')); } catch {}
if (!Array.isArray(nodes) || !nodes.every(n => typeof n.id === 'string' && typeof n.text === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y))) nodes = null;
if (!nodes?.length) nodes = [
 {id:'space',text:'우주',x:390,y:115,w:300,parent:null,answer:'모든 질문이 시작되는, 끝없는 공간.\n별과 은하, 시간과 중력. 어떤 이야기가 궁금한가요?',art:true},
 {id:'blackhole',text:'블랙홀',x:800,y:60,w:295,parent:'space',answer:'빛조차 빠져나올 수 없는 강한 중력의 영역. 경계인 사건의 지평선 너머에는 무엇이 있을까요?'},
 {id:'time',text:'시간도 느려질까?',x:800,y:355,w:295,parent:'space',answer:''}
];
selected = nodes[0].id;
function toast(t) { $('#toast').textContent=t; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500); }
function save() { try { localStorage.setItem('orbit-map',JSON.stringify(nodes)); renderUsageTotal(); } catch { $('#saved').textContent='저장 공간 부족'; } }
function pick(id) { selected=id; document.querySelectorAll('.node').forEach(el=>el.classList.toggle('selected',el.dataset.id===id)); }
function lines() { $('#links').replaceChildren(); nodes.forEach(n=>{const p=nodes.find(p=>p.id===n.parent);if(!p)return;const x=p.x+p.w,y=p.y+70,tx=n.x,ty=n.y+70;const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',`M ${x} ${y} C ${x+85} ${y}, ${tx-85} ${ty}, ${tx} ${ty}`);$('#links').append(path);const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',tx);dot.setAttribute('cy',ty);dot.setAttribute('r',3);$('#links').append(dot);}); }
function deleteCard(id=selected){
 const n=nodes.find(n=>n.id===id);if(!n)return;
 finishGesture(true);
 nodes=nodes.filter(v=>v.id!==id);
 nodes.forEach(v=>{if(v.parent===id)v.parent=n.parent;});
 if(selected===id)selected=null;
 if(!nodes.length){threads={};saveThreads();usageTotal={questions:0,input:0,output:0};try{localStorage.removeItem('orbit-usage');}catch{}renderUsageTotal();} // 지도를 비우면 대화와 누적 사용량도 새로 시작한다.
 save();render();
}
async function copyCard(){
 const n=nodes.find(n=>n.id===selected);if(!n)return;
 try{await window.desktop.copy([n.text,n.answer].filter(Boolean).join('\n\n'));toast('카드의 질문과 답변을 복사했습니다.');}
 catch{toast('카드를 복사하지 못했습니다.');}
}
function render() {
 const existing=new Map([...$('#nodes').children].map(el=>[el.dataset.id,el]));
 const liveIds=new Set(nodes.map(n=>n.id));
 for(const [id,el] of existing)if(!liveIds.has(id))el.remove();
 nodes.forEach(n=>{
 let el=existing.get(n.id);
 if(!el){
 el=document.createElement('article');el.className='node';el.dataset.id=n.id;
 el.innerHTML='<div class="top"><span></span><button title="카드 삭제 · Ctrl+W">×</button></div><textarea rows="1" placeholder="어떤 생각이 떠올랐나요?" aria-label="질문"></textarea><div class="visual"></div><div class="answer"></div><div class="meta"></div><div class="bottom"><button class="branch">＋ 가지 잇기</button><button class="paste">답변 붙이기</button><button class="send"></button></div><div class="resize" title="드래그로 크기 조절 · 더블클릭으로 기본 크기"></div>';
 $('#nodes').append(el);
 }
 el.classList.toggle('root',!n.parent);el.style.cssText=`left:${n.x}px;top:${n.y}px;width:${n.w}px`;
 applySize(el,n);
 el.querySelector('.top span').textContent=n.parent?'↳ CONNECTED THOUGHT':'✳ CENTRAL IDEA';
 const input=el.querySelector('textarea');if(input.value!==n.text)input.value=n.text;autosize(input);input.oninput=()=>{n.text=input.value;autosize(input);save();};input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(n);}};
 const answer=el.querySelector('.answer'),reply=n.answer || '질문을 적고 ↗ 버튼을 눌러 탐색하세요.';if(answer.textContent!==reply)answer.textContent=reply;
 const meta=el.querySelector('.meta'),metaText=describeMeta(n.meta);if(meta.textContent!==metaText)meta.textContent=metaText;meta.hidden=!metaText;
 const visual=el.querySelector('.visual');if(Boolean(n.art)!==Boolean(visual.children.length))visual.innerHTML=n.art?'<div class="orbit-art"><div class="planet"></div><div class="ring"></div></div>':'';
 el.querySelector('.send').textContent=el.classList.contains('busy')?'답변 기다리는 중…':mode==='demo'?'탐색하기 ↗':mode==='manual'?'질문 복사 ↗':backendLabel(mode)+'에 질문 ↗';
 el.querySelector('.send').onclick=()=>send(n);
 el.querySelector('.paste').hidden=mode!=='manual';
 el.querySelector('.paste').onclick=async()=>{try{const text=await window.desktop.paste();if(!text.trim())return toast('클립보드에 답변을 먼저 복사해 주세요.');n.answer=text;n.art=false;save();render();toast('앱에서 복사한 답변을 붙였습니다.');}catch{toast('클립보드를 읽을 수 없습니다.');}};
 el.querySelector('.branch').onclick=()=>add(n.x+n.w+100,n.y+100,n.id);
 el.querySelector('.top button').onclick=()=>deleteCard(n.id);
 el.onfocusin=()=>pick(n.id);
 const grip=el.querySelector('.resize');
 grip.onpointerdown=e=>{e.stopPropagation();if(e.button!==0)return;finishGesture(true);pick(n.id);e.preventDefault();grip.setPointerCapture(e.pointerId);const answer=el.querySelector('.answer');gesture={type:'resize',n,el,grip,pointer:e.pointerId,x:e.clientX,y:e.clientY,ow:n.w,oh:n.h||answer.getBoundingClientRect().height/scale};el.classList.add('resizing');};
 grip.ondblclick=e=>{e.stopPropagation();n.w=290;n.h=null;applySize(el,n);lines();save();toast('카드를 기본 크기로 되돌렸습니다.');};
 el.onpointerdown=e=>{
  e.stopPropagation();if(e.button!==0)return;pick(n.id);
  if(e.target.closest('button'))return;
  const editor=e.target.closest('textarea');
  if(editor&&document.activeElement===editor)return;
  e.preventDefault();el.setPointerCapture(e.pointerId);
  gesture={type:'node',n,el,editor,pointer:e.pointerId,x:e.clientX,y:e.clientY,ox:n.x,oy:n.y,moved:false};
 };
 });pick(selected);lines();
}
// 카드 크기: w는 너비(220~720), h는 답변 영역 높이(80~900, 없으면 내용에 맞춤). 손잡이 드래그·질문 그리기 사각형으로 정한다.
const SIZE={minW:220,maxW:720,minH:80,maxH:900};
function applySize(el,n){el.style.width=n.w+'px';const answer=el.querySelector('.answer');if(n.h){answer.style.height=n.h+'px';answer.style.maxHeight='none';}else{answer.style.height='';answer.style.maxHeight='';}}
function autosize(input){input.style.height='auto';input.style.height=Math.max(38,input.scrollHeight)+'px';}
function add(x,y,parent=null,w=290,h=null){const n={id:crypto.randomUUID(),text:'',x,y,w:Math.max(SIZE.minW,Math.min(SIZE.maxW,w)),parent,answer:''};if(h&&h>=260)n.h=Math.max(SIZE.minH,Math.min(SIZE.maxH,Math.round(h-170)));nodes.push(n);selected=n.id;save();render();document.querySelector(`[data-id="${n.id}"] textarea`).focus();}
function context(n,brief=false){const chain=[];let cur=n;const seen=new Set();while(cur&&!seen.has(cur.id)){seen.add(cur.id);chain.unshift(cur);cur=nodes.find(v=>v.id===cur.parent);}
 // 같은 대화를 이어갈 때는 답변이 이미 대화에 있으므로 질문 흐름만 짧게 보낸다.
 if(brief)return (chain.length>1?'마인드맵에서 이어지는 질문입니다 (흐름: '+chain.slice(0,-1).map(v=>v.text).join(' → ')+').\n\n':'마인드맵 브레인스토밍 중입니다. ')+`질문: ${n.text}\n\n한국어로 간결하게 답하고, 이어서 탐색할 질문 2개를 제안해 주세요.`;
 return '마인드맵 브레인스토밍 중입니다. 아래 흐름을 참고해 마지막 질문에 한국어로 간결하게 답하고, 이어서 탐색할 질문 2개를 제안해 주세요.\n\n'+chain.map(v=>`질문: ${v.text}${v!==n&&v.answer?'\n답변: '+v.answer:''}`).join('\n\n');}
async function send(n){if(!n.text.trim())return toast('먼저 질문을 적어 주세요.');if(isAi()){
 if(autoBusy)return toast('이전 답변을 기다리고 있습니다.');
 const backend=mode,thread=threads[backend]||null;
 autoBusy=true;$('#cancel').hidden=false;document.querySelector(`[data-id="${n.id}"]`)?.classList.add('busy');render();toast(`${backendLabel(backend)}에 질문을 보내고 있습니다.`);
 const startedAt=Date.now(),ticker=setInterval(()=>{const b=document.querySelector(`[data-id="${n.id}"].busy .send`);if(b)b.textContent=`답변 기다리는 중… ${Math.round((Date.now()-startedAt)/1000)}초`;},1000); // 대기 중 경과 시간
 try{
  // thread가 있으면 질문 흐름만 짧게, 없으면 도입 문장과 부모 카드 전체를 보낸다. 재개 실패 시 main이 fallbackPrompt로 새 대화를 만든다.
  const result=await window.desktop.backendSend({backend,prompt:context(n,Boolean(thread)),thread,fallbackPrompt:context(n,false)});
  if(result.ok){n.answer=result.text;n.art=false;n.meta={backend,ms:result.ms||null,usage:result.usage||null,model:result.model||null,at:Date.now()};lastMeta=n.meta;if(result.thread){threads[backend]=result.thread;saveThreads();}if(result.limits){limits[backend]=result.limits;try{localStorage.setItem('orbit-limits',JSON.stringify(limits));}catch{}}recordUsage(result);if(!result.limits)refreshLimits(backend);save();toast(`${backendLabel(backend)} 답변을 받았습니다 · ${((result.ms||0)/1000).toFixed(1)}초${result.recovered?' · 이전 대화를 찾지 못해 새 대화로 이어 갔습니다':''}`);}
  else{toast(result.message);if(['ERR_BACKEND_NOT_INSTALLED','ERR_BACKEND_LOGIN_REQUIRED','ERR_BACKEND_FAILED'].includes(result.code))refreshBackends(true);}
 }catch(error){toast(String(error&&error.message||error).replace(/^Error invoking remote method '[^']+': Error: /,''));}
 finally{clearInterval(ticker);autoBusy=false;$('#cancel').hidden=true;document.querySelector(`[data-id="${n.id}"]`)?.classList.remove('busy');render();}return;
 }if(mode==='manual'){try{await window.desktop.copy(context(n));toast('질문을 복사했습니다. 앱에 붙여 넣은 뒤 답변을 복사해 돌아오세요.');}catch{toast('데스크톱 앱으로 실행하면 복사할 수 있습니다.');}return;}
 if(/블랙홀/.test(n.text)) n.answer='블랙홀은 중력이 매우 강해 빛도 빠져나올 수 없는 영역입니다. 사건의 지평선은 돌아올 수 없는 경계예요.\n\n↳ 블랙홀은 어떻게 만들어질까?\n↳ 블랙홀 근처에서 시간은 어떻게 흐를까?';
 else if(/시간/.test(n.text)) n.answer='강한 중력장에 있는 시계는 멀리 있는 시계와 비교하면 더 느리게 갑니다. 일반 상대성 이론이 설명하는 중력 시간 지연이에요.\n\n↳ 우주여행 후 나이가 달라질까?\n↳ GPS는 시간 차이를 어떻게 보정할까?';
 else if(/우주|별|은하/.test(n.text))n.answer='우주는 공간과 시간, 물질과 에너지를 모두 포함합니다. 작은 질문 하나로도 아주 먼 곳까지 탐색할 수 있어요.\n\n↳ 별은 어떻게 태어날까?\n↳ 우주에는 끝이 있을까?';
 else n.answer=`“${n.text}”에서 생각을 확장해 보세요.\n\n↳ 이 주제에서 가장 궁금한 점은 무엇인가요?\n↳ 전혀 다른 관점에서는 어떻게 보일까요?\n\n이것은 미리 구성한 데모 응답입니다. 실제 대화는 데스크톱 앱 연결 모드를 사용하세요.`;
 n.art=/우주|행성/.test(n.text);save();render();toast('예시 답변입니다 · 실제 AI에 전송되지 않았습니다.');
}
function transform(){world.style.transform=`translate(${offset.x}px,${offset.y}px) scale(${scale})`;$('#zoom').textContent=Math.round(scale*100)+'%';}
function point(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left-offset.x)/scale,y:(e.clientY-r.top-offset.y)/scale};}
// 빈 곳: 그냥 드래그하면 화면 이동, Ctrl(맥 Cmd)을 누르거나 '질문 그리기' 도구일 때 드래그하면 카드 생성.
let tool='select';
canvas.onpointerdown=e=>{if(e.button!==0)return;const p=point(e);const draw=(e.ctrlKey||e.metaKey)||(tool==='draw'&&!e.shiftKey);gesture=draw?{type:'draw',p,x:e.clientX,y:e.clientY,parent:selected}:{type:'pan',x:e.clientX,y:e.clientY,ox:offset.x,oy:offset.y};if(!draw)document.body.classList.add('panning');e.preventDefault();};
// 휠: 화면 이동, Ctrl+휠: 커서 기준 확대·축소
canvas.onwheel=e=>{e.preventDefault();if(e.ctrlKey||e.metaKey){zoomAt(e.deltaY<0?.1:-.1,e.clientX,e.clientY);return;}const k=e.deltaMode===1?16:1;offset={x:offset.x-e.deltaX*k,y:offset.y-e.deltaY*k};transform();};
window.addEventListener('keydown',e=>{if(e.key==='Control'||e.key==='Meta')document.body.classList.add('ctrl');});window.addEventListener('keyup',e=>{if(e.key==='Control'||e.key==='Meta')document.body.classList.remove('ctrl');});window.addEventListener('blur',()=>document.body.classList.remove('ctrl'));
let moveFrame=0;
function paintMove(){
 moveFrame=0;const g=gesture;if(!g)return;
 if(g.type==='node'&&g.moved){g.el.style.left=g.n.x+'px';g.el.style.top=g.n.y+'px';lines();}
 else if(g.type==='resize')lines();
 else if(g.type==='pan')transform();
}
window.onpointermove=e=>{
 if(!gesture)return;const g=gesture;
 if(g.type==='resize'){
  if(e.pointerId!==g.pointer)return; // 다른 포인터의 이벤트는 무시
  const dx=Math.max(-600,Math.min(600,(e.clientX-g.x)/scale)),dy=Math.max(-600,Math.min(600,(e.clientY-g.y)/scale)); // 한 번의 드래그 범위 상한
  g.n.w=Math.round(Math.max(SIZE.minW,Math.min(SIZE.maxW,g.ow+dx)));g.n.h=Math.round(Math.max(SIZE.minH,Math.min(SIZE.maxH,g.oh+dy)));g.moved=true;
  applySize(g.el,g.n);autosize(g.el.querySelector('textarea'));if(!moveFrame)moveFrame=requestAnimationFrame(paintMove);return;
 }
 if(g.type==='node'){
  const dx=e.clientX-g.x,dy=e.clientY-g.y;
  if(!g.moved&&Math.hypot(dx,dy)<5)return;
  if(!g.moved){g.moved=true;document.activeElement?.blur();g.el.classList.add('dragging');document.body.classList.add('card-dragging');}
  g.n.x=g.ox+dx/scale;g.n.y=g.oy+dy/scale;
  if(!moveFrame)moveFrame=requestAnimationFrame(paintMove);
 }else if(g.type==='pan'){
  offset={x:g.ox+e.clientX-g.x,y:g.oy+e.clientY-g.y};if(!moveFrame)moveFrame=requestAnimationFrame(paintMove);
 }else{
  const r=canvas.getBoundingClientRect();Object.assign($('#selection').style,{display:'block',left:Math.min(g.x,e.clientX)-r.left+'px',top:Math.min(g.y,e.clientY)-r.top+'px',width:Math.abs(e.clientX-g.x)+'px',height:Math.abs(e.clientY-g.y)+'px'});
 }
};
function finishGesture(cancelled=false){
 if(!gesture)return;const g=gesture;
 cancelAnimationFrame(moveFrame);paintMove();gesture=null;
 $('#selection').style.display='none';document.body.classList.remove('card-dragging');document.body.classList.remove('panning');
 if(g.type==='node'){
  g.el.classList.remove('dragging');if(g.el.hasPointerCapture(g.pointer))g.el.releasePointerCapture(g.pointer);
  if(g.moved)save();else if(g.editor&&!cancelled)g.editor.focus();
 }
 else if(g.type==='resize'){g.el.classList.remove('resizing');if(g.grip.hasPointerCapture(g.pointer))g.grip.releasePointerCapture(g.pointer);if(g.moved)save();}
}
window.onpointerup=e=>{
 if(!gesture)return;const g=gesture;
 if(g.type==='draw'&&Math.abs(e.clientX-g.x)>35&&Math.abs(e.clientY-g.y)>20){const p=point(e);finishGesture();add(Math.min(p.x,g.p.x),Math.min(p.y,g.p.y),g.parent,Math.abs(p.x-g.p.x),Math.abs(p.y-g.p.y));}
 else finishGesture();
};
window.onpointercancel=()=>finishGesture(true);
window.onblur=()=>{finishGesture(true);save();};
// 백엔드 선택기: 탐지 결과로 다시 채운다. 사용 불가 항목은 사유와 함께 비활성.
function renderBackendOptions(){
 const select=$('#mode'),current=mode;select.replaceChildren();
 const groups=[['AI (CLI)',backends.filter(b=>b.group==='AI (CLI)')],['실험',backends.filter(b=>b.group==='실험')],['기타',[{id:'demo',label:'데모 답변',available:true},{id:'manual',label:'수동 연결 · 복사·붙이기',available:true}]]];
 for(const [name,items] of groups){if(!items.length)continue;const g=document.createElement('optgroup');g.label=name;
  for(const b of items){const o=document.createElement('option');o.value=b.id;
   const suffix=b.available?(b.version?` · ${b.version}`:''):b.reason==='ERR_BACKEND_LOGIN_REQUIRED'?' · 로그인 필요':b.id==='claude-desktop'?' · Claude 앱 실행 필요':' · 설치 필요';
   o.textContent=(name==='AI (CLI)'?'✦ ':name==='실험'?'⚗ ':b.id==='demo'?'✧ ':'↗ ')+b.label+suffix;o.disabled=!b.available;g.append(o);}
  select.append(g);}
 select.value=current;if(select.value!==current)select.value='demo';
}
function chooseDefaultBackend(){
 const saved=localStorage.getItem('orbit-backend'),usable=id=>id==='demo'||id==='manual'||backends.some(b=>b.id===id&&b.available);
 return usable(saved)?saved:(backends.find(b=>b.group==='AI (CLI)'&&b.available)||{}).id||'demo';
}
async function refreshBackends(refresh=false){
 try{const info=window.desktop?.detectBackends?await window.desktop.detectBackends(refresh):{backends:[]};backends=info.backends||[];}catch{backends=[];}
 const next=chooseDefaultBackend(),changed=next!==mode;mode=next;renderBackendOptions();$('#connect').hidden=mode!=='claude-desktop';if(changed)render();
}
$('#mode').onchange=e=>{mode=e.target.value;localStorage.setItem('orbit-backend',mode);$('#connect').hidden=mode!=='claude-desktop';render();
 toast(mode==='demo'?'미리 구성한 예시 답변 모드':mode==='manual'?'수동 연결 · 질문 복사 → 기존 앱에 붙여 넣기 → 답변 복사 → 답변 붙이기':mode==='claude-desktop'?'Claude 데스크톱 화면 자동화(실험) · 연결 확인을 눌러 주세요.':`${backendLabel(mode)} · 이 지도의 질문을 하나의 대화로 이어서 보냅니다.`);};
$('#mode').onmouseenter=()=>{refreshBackends(false);};
$('#hide').onclick=()=>window.desktop?.hide();
window.onkeydown=e=>{
 if(e.key==='Escape')window.desktop?.hide();
 if(!(e.ctrlKey||e.metaKey)||e.altKey||e.shiftKey||e.isComposing)return;
 const key=/^[a-z]$/i.test(e.key)?e.key.toLowerCase():e.code==='KeyW'?'w':e.code==='KeyC'?'c':''; // 한글 IME에서도 물리 키로 판별
 if(key==='w'){e.preventDefault();if(!e.repeat)deleteCard();}
 if(key==='c'){
  const input=document.activeElement;
  const textSelected=input?.matches('textarea,input')&&input.selectionStart!==input.selectionEnd;
  if(textSelected||window.getSelection()?.toString())return;
  if(selected){e.preventDefault();if(!e.repeat)copyCard();}
 }
};
window.desktop?.onCardShortcut(action=>{if(action==='delete')deleteCard();});
$('#add').onclick=()=>{selected=null;add((canvas.clientWidth/2-offset.x)/scale-145,(canvas.clientHeight/2-offset.y)/scale);};
$('#draw').onclick=()=>{tool='draw';$('#draw').classList.add('active');$('#select').classList.remove('active');document.body.classList.add('tool-draw');toast('빈 곳을 드래그해 질문 상자를 그리세요. 선택 도구에서는 Ctrl을 누른 채 드래그합니다.');};
$('#select').onclick=()=>{tool='select';$('#select').classList.add('active');$('#draw').classList.remove('active');document.body.classList.remove('tool-draw');toast('빈 곳 드래그·휠: 화면 이동 · Ctrl+드래그: 카드 생성 · Ctrl+휠: 확대/축소');};
function zoomAt(delta,cx,cy){const old=scale;scale=Math.max(.4,Math.min(1.6,Math.round((scale+delta)*100)/100));const r=canvas.getBoundingClientRect();const x=cx-r.left,y=cy-r.top;offset={x:x-(x-offset.x)*scale/old,y:y-(y-offset.y)*scale/old};transform();}
function zoom(delta){const r=canvas.getBoundingClientRect();zoomAt(delta,r.left+canvas.clientWidth/2,r.top+canvas.clientHeight/2);}
$('#in').onclick=()=>zoom(.1);$('#out').onclick=()=>zoom(-.1);
$('#home').onclick=()=>{if(!nodes.length){scale=1;offset={x:0,y:0};}else{const minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y));const maxX=Math.max(...nodes.map(n=>n.x+n.w)),maxY=Math.max(...nodes.map(n=>n.y+(document.querySelector(`[data-id="${n.id}"]`)?.offsetHeight||200)));scale=Math.min(1,(canvas.clientWidth-100)/(maxX-minX),(canvas.clientHeight-80)/(maxY-minY));offset={x:(canvas.clientWidth-(maxX-minX)*scale)/2-minX*scale,y:(canvas.clientHeight-(maxY-minY)*scale)/2-minY*scale};}transform();};
render();
if(canvas.clientWidth<1150)$('#home').click();
renderBackendOptions();refreshBackends(false).then(()=>refreshLimits('codex-cli'));renderUsageTotal();

let capeTimer;
window.desktop?.onCape(state => {
 clearTimeout(capeTimer);
 if (state.open) {
  document.body.style.setProperty('--cape-x', state.x + 'px');
  document.body.style.setProperty('--cape-y', state.y + 'px');
  document.body.classList.remove('cape-idle', 'cape-closing', 'cape-opening');
  void document.body.offsetWidth;
  document.body.classList.add('cape-opening');
  capeTimer=setTimeout(()=>document.body.classList.remove('cape-opening'),1150);
 } else {
  document.body.classList.remove('cape-opening');
  document.body.classList.add('cape-closing');
 }
});

$('#connect').onclick = async () => { $('#connect').disabled=true;try{const status=await window.desktop.bridgeStatus();toast(status.draft?`Claude 입력창 연결 확인 · 보내지 않은 초안 “${status.draft}”이(가) 있습니다. 전송 전에 Claude에서 보내거나 지워 주세요.`:'Claude 입력창 연결 확인 · 질문 버튼으로 전송하세요.');}catch(error){toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}finally{$('#connect').disabled=false;} };
$('#cancel').onclick=()=>{window.desktop.backendCancel();toast('답변 수신을 취소했습니다. 이미 전송된 질문은 AI 쪽에서 계속 처리될 수 있습니다.');};
window.desktop?.onBackendEvent(event=>{
 if(event.type==='sent')toast('Claude에 전송 완료 · 답변을 기다리고 있습니다.');
 if(event.type==='delta'&&typeof event.text==='string'){const answer=document.querySelector('.node.busy .answer');if(answer)answer.textContent=event.text+' ▍';} // 부분 답변을 카드에 실시간 표시
});
