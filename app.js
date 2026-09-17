const $ = s => document.querySelector(s);
const canvas = $('#canvas'), world = $('#world');
let autoBusy = false;
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
function save() { try { localStorage.setItem('orbit-map',JSON.stringify(nodes)); $('#saved').textContent='로컬에 저장됨'; } catch { $('#saved').textContent='저장 공간 부족'; } }
function pick(id) { selected=id; document.querySelectorAll('.node').forEach(el=>el.classList.toggle('selected',el.dataset.id===id)); }
function lines() { $('#links').replaceChildren(); nodes.forEach(n=>{const p=nodes.find(p=>p.id===n.parent);if(!p)return;const x=p.x+p.w,y=p.y+70,tx=n.x,ty=n.y+70;const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',`M ${x} ${y} C ${x+85} ${y}, ${tx-85} ${ty}, ${tx} ${ty}`);$('#links').append(path);const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',tx);dot.setAttribute('cy',ty);dot.setAttribute('r',3);$('#links').append(dot);}); }
function deleteCard(id=selected){
 const n=nodes.find(n=>n.id===id);if(!n)return;
 finishGesture(true);
 nodes=nodes.filter(v=>v.id!==id);
 nodes.forEach(v=>{if(v.parent===id)v.parent=n.parent;});
 if(selected===id)selected=null;
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
 el.innerHTML='<div class="top"><span></span><button title="카드 삭제 · Ctrl+W">×</button></div><textarea rows="1" placeholder="어떤 생각이 떠올랐나요?" aria-label="질문"></textarea><div class="visual"></div><div class="answer"></div><div class="bottom"><button class="branch">＋ 가지 잇기</button><button class="paste">답변 붙이기</button><button class="send"></button></div>';
 $('#nodes').append(el);
 }
 el.classList.toggle('root',!n.parent);el.style.cssText=`left:${n.x}px;top:${n.y}px;width:${n.w}px`;
 el.querySelector('.top span').textContent=n.parent?'↳ CONNECTED THOUGHT':'✳ CENTRAL IDEA';
 const input=el.querySelector('textarea');if(input.value!==n.text)input.value=n.text;input.oninput=()=>{n.text=input.value;save();};input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(n);}};
 const answer=el.querySelector('.answer'),reply=n.answer || '질문을 적고 ↗ 버튼을 눌러 탐색하세요.';if(answer.textContent!==reply)answer.textContent=reply;
 const visual=el.querySelector('.visual');if(Boolean(n.art)!==Boolean(visual.children.length))visual.innerHTML=n.art?'<div class="orbit-art"><div class="planet"></div><div class="ring"></div></div>':'';
 el.querySelector('.send').textContent=mode==='demo'?'탐색하기 ↗':mode==='auto'?'Claude에 질문 ↗':'질문 복사 ↗';
 el.querySelector('.send').onclick=()=>send(n);
 el.querySelector('.paste').hidden=mode!=='desktop';
 el.querySelector('.paste').onclick=async()=>{try{const text=await window.desktop.paste();if(!text.trim())return toast('클립보드에 답변을 먼저 복사해 주세요.');n.answer=text;n.art=false;save();render();toast('앱에서 복사한 답변을 붙였습니다.');}catch{toast('클립보드를 읽을 수 없습니다.');}};
 el.querySelector('.branch').onclick=()=>add(n.x+n.w+100,n.y+100,n.id);
 el.querySelector('.top button').onclick=()=>deleteCard(n.id);
 el.onfocusin=()=>pick(n.id);
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
function add(x,y,parent=null,w=290){const n={id:crypto.randomUUID(),text:'',x,y,w:Math.max(260,Math.min(430,w)),parent,answer:''};nodes.push(n);selected=n.id;save();render();document.querySelector(`[data-id="${n.id}"] textarea`).focus();}
function context(n){const chain=[];let cur=n;const seen=new Set();while(cur&&!seen.has(cur.id)){seen.add(cur.id);chain.unshift(cur);cur=nodes.find(v=>v.id===cur.parent);}return '마인드맵 브레인스토밍 중입니다. 아래 흐름을 참고해 마지막 질문에 한국어로 간결하게 답하고, 이어서 탐색할 질문 2개를 제안해 주세요.\n\n'+chain.map(v=>`질문: ${v.text}${v!==n&&v.answer?'\n답변: '+v.answer:''}`).join('\n\n');}
async function send(n){if(!n.text.trim())return toast('먼저 질문을 적어 주세요.');if(mode==='auto'){
 if(autoBusy)return toast('이전 답변을 기다리고 있습니다.');
 autoBusy=true;$('#cancel').hidden=false;toast('Claude에 질문을 보내고 있습니다.');
 try{const result=await window.desktop.bridgeSend(context(n));n.answer=result.text;n.art=false;save();render();toast('Claude 데스크톱의 실제 답변을 받았습니다.');}
 catch(error){toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}
 finally{autoBusy=false;$('#cancel').hidden=true;}return;
 }if(mode==='desktop'){try{await window.desktop.copy(context(n));toast('질문을 복사했습니다. 앱에 붙여 넣은 뒤 답변을 복사해 돌아오세요.');}catch{toast('데스크톱 앱으로 실행하면 복사할 수 있습니다.');}return;}
 if(/블랙홀/.test(n.text)) n.answer='블랙홀은 중력이 매우 강해 빛도 빠져나올 수 없는 영역입니다. 사건의 지평선은 돌아올 수 없는 경계예요.\n\n↳ 블랙홀은 어떻게 만들어질까?\n↳ 블랙홀 근처에서 시간은 어떻게 흐를까?';
 else if(/시간/.test(n.text)) n.answer='강한 중력장에 있는 시계는 멀리 있는 시계와 비교하면 더 느리게 갑니다. 일반 상대성 이론이 설명하는 중력 시간 지연이에요.\n\n↳ 우주여행 후 나이가 달라질까?\n↳ GPS는 시간 차이를 어떻게 보정할까?';
 else if(/우주|별|은하/.test(n.text))n.answer='우주는 공간과 시간, 물질과 에너지를 모두 포함합니다. 작은 질문 하나로도 아주 먼 곳까지 탐색할 수 있어요.\n\n↳ 별은 어떻게 태어날까?\n↳ 우주에는 끝이 있을까?';
 else n.answer=`“${n.text}”에서 생각을 확장해 보세요.\n\n↳ 이 주제에서 가장 궁금한 점은 무엇인가요?\n↳ 전혀 다른 관점에서는 어떻게 보일까요?\n\n이것은 미리 구성한 데모 응답입니다. 실제 대화는 데스크톱 앱 연결 모드를 사용하세요.`;
 n.art=/우주|행성/.test(n.text);save();render();toast('예시 답변입니다 · 실제 AI에 전송되지 않았습니다.');
}
function transform(){world.style.transform=`translate(${offset.x}px,${offset.y}px) scale(${scale})`;$('#zoom').textContent=Math.round(scale*100)+'%';}
function point(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left-offset.x)/scale,y:(e.clientY-r.top-offset.y)/scale};}
canvas.onpointerdown=e=>{if(e.button!==0)return;const p=point(e);gesture=e.shiftKey?{type:'pan',x:e.clientX,y:e.clientY,ox:offset.x,oy:offset.y}:{type:'draw',p,x:e.clientX,y:e.clientY,parent:selected};e.preventDefault();};
let moveFrame=0;
function paintMove(){
 moveFrame=0;const g=gesture;if(!g)return;
 if(g.type==='node'&&g.moved){g.el.style.left=g.n.x+'px';g.el.style.top=g.n.y+'px';lines();}
 else if(g.type==='pan')transform();
}
window.onpointermove=e=>{
 if(!gesture)return;const g=gesture;
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
 $('#selection').style.display='none';document.body.classList.remove('card-dragging');
 if(g.type==='node'){
  g.el.classList.remove('dragging');if(g.el.hasPointerCapture(g.pointer))g.el.releasePointerCapture(g.pointer);
  if(g.moved)save();else if(g.editor&&!cancelled)g.editor.focus();
 }
}
window.onpointerup=e=>{
 if(!gesture)return;const g=gesture;
 if(g.type==='draw'&&Math.abs(e.clientX-g.x)>35&&Math.abs(e.clientY-g.y)>20){const p=point(e);finishGesture();add(Math.min(p.x,g.p.x),Math.min(p.y,g.p.y),g.parent,Math.abs(p.x-g.p.x));}
 else finishGesture();
};
window.onpointercancel=()=>finishGesture(true);
window.onblur=()=>{finishGesture(true);save();};
$('#mode').onchange=e=>{mode=e.target.value;$('#connect').hidden=mode!=='auto';render();if(mode==='auto'){toast('Claude 자동 연결 · 질문마다 새 대화를 만듭니다. 연결 확인을 눌러 주세요.');return;}toast(mode==='demo'?'미리 구성한 예시 답변 모드':'수동 연결 · 질문 복사 → 기존 앱에 붙여 넣기 → 답변 복사 → 답변 붙이기');};
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
$('#draw').onclick=()=>{ $('#draw').classList.add('active');$('#select').classList.remove('active');canvas.style.cursor='crosshair';toast('빈 곳을 드래그해 질문 상자를 그리세요.');};
$('#select').onclick=()=>{$('#select').classList.add('active');$('#draw').classList.remove('active');canvas.style.cursor='default';toast('카드 어디든 잡아 이동하세요. 제목 클릭으로 편집합니다. 화면 이동은 Shift + 드래그.');};
function zoom(delta){const old=scale;scale=Math.max(.4,Math.min(1.6,scale+delta));const x=canvas.clientWidth/2,y=canvas.clientHeight/2;offset={x:x-(x-offset.x)*scale/old,y:y-(y-offset.y)*scale/old};transform();}
$('#in').onclick=()=>zoom(.1);$('#out').onclick=()=>zoom(-.1);
$('#home').onclick=()=>{if(!nodes.length){scale=1;offset={x:0,y:0};}else{const minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y));const maxX=Math.max(...nodes.map(n=>n.x+n.w)),maxY=Math.max(...nodes.map(n=>n.y+(document.querySelector(`[data-id="${n.id}"]`)?.offsetHeight||200)));scale=Math.min(1,(canvas.clientWidth-100)/(maxX-minX),(canvas.clientHeight-80)/(maxY-minY));offset={x:(canvas.clientWidth-(maxX-minX)*scale)/2-minX*scale,y:(canvas.clientHeight-(maxY-minY)*scale)/2-minY*scale};}transform();};
render();
if(canvas.clientWidth<1150)$('#home').click();

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

$('#connect').onclick = async () => { $('#connect').disabled=true;try{await window.desktop.bridgeStatus();toast('Claude 입력창 연결 확인 · 질문 버튼으로 전송하세요.');}catch(error){toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}finally{$('#connect').disabled=false;} };
$('#cancel').onclick=()=>{window.desktop.bridgeCancel();toast('답변 수신을 취소했습니다. 이미 전송된 질문은 Claude에서 계속 처리될 수 있습니다.');};
window.desktop?.onBridgeEvent(event=>{if(event.type==='sent')toast('Claude에 전송 완료 · 답변을 기다리고 있습니다.');});
