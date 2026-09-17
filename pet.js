const pet = document.querySelector('.pet');
let pointer = null, casting = false, flying = false;
pet.onpointerdown = event => {
  if (event.button !== 0 || casting || flying) return;
  pointer = { x: event.screenX, y: event.screenY, moved: false };
  pet.setPointerCapture(event.pointerId);
  window.desktop.petDrag('begin');
};
pet.onpointermove = event => {
  if (!pointer) return;
  if (Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) > 5) pointer.moved = true;
  if (pointer.moved) window.desktop.petDrag('move');
};
pet.onpointerup = event => {
  if (!pointer) return;
  const moved = pointer.moved; pointer = null;
  window.desktop.petDrag('end');
  pet.releasePointerCapture(event.pointerId);
  if (!moved) cast();
};
pet.onpointercancel = () => { pointer = null; window.desktop.petDrag('end'); };
pet.onclick = event => { if (event.detail === 0) cast(); };
function cast() {
  if (casting || flying) return;
  casting = true; pet.classList.add('casting');
  setTimeout(() => window.desktop.toggle(), 600);
  setTimeout(() => { pet.classList.remove('casting'); casting = false; }, 1050);
}
document.querySelector('#smaller').onclick = () => window.desktop.petResize(-0.1);
document.querySelector('#larger').onclick = () => window.desktop.petResize(0.1);
pet.onwheel = event => { event.preventDefault(); window.desktop.petResize(event.deltaY < 0 ? 0.1 : -0.1); };
window.desktop.onPetScale(scale => { document.body.style.transform = `scale(${scale})`; document.querySelector('#pet-size').textContent = Math.round(scale * 100) + '%'; });
document.querySelector('.quit').onclick = () => window.desktop.quit();

// ── 시계: 매 분 경계마다 시스템 시간을 다시 그리고, 알람 시각이 지났는지도 함께 확인한다.
const clockEl = document.querySelector('#time');
const pad = n => String(n).padStart(2, '0');
const hhmm = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
let clockTimer;
function renderClock(now = new Date()) { clockEl.textContent = hhmm(now); clockEl.dateTime = now.toISOString(); }
function tick() {
  clearTimeout(clockTimer);
  const now = new Date();
  renderClock(now); checkAlarm(now.getTime()); renderAlarm();
  clockTimer = setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}

// ── 알람: 한 개만 두고, 설정한 시각이 다음에 오는 때(오늘 또는 내일)에 울린다. 로컬에 저장해 재실행 후에도 유지한다.
const alarmForm = document.querySelector('#alarm'), alarmInput = document.querySelector('#alarm-time'), alarmLabel = document.querySelector('#alarm-label');
const alarmRepeat = document.querySelector('#alarm-repeat'), alarmSound = document.querySelector('#alarm-sound');
const alarmStatus = document.querySelector('#alarm-status'), alarmBadge = document.querySelector('.alarm-badge');
let alarm = { at: 0, time: '', label: '', repeat: false, sound: true }, alarmTimer, ringTimer;
try {
  const saved = JSON.parse(localStorage.getItem('orbit-alarm'));
  if (saved && typeof saved === 'object') alarm = { ...alarm, ...saved, at: Number(saved.at) || 0, label: String(saved.label || '').slice(0, 20), repeat: Boolean(saved.repeat), sound: saved.sound !== false };
  if (alarm.at && alarm.at <= Date.now()) alarm.at = alarm.repeat ? nextOccurrence(alarm.time) : 0; // 꺼진 동안 지난 알람은 반복이면 다음 날로, 아니면 해제
} catch {}
function persistAlarm() { try { alarm.at ? localStorage.setItem('orbit-alarm', JSON.stringify(alarm)) : localStorage.removeItem('orbit-alarm'); } catch {} }
function nextOccurrence(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time || ''); if (!match) return 0;
  const target = new Date(); target.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
  return target.getTime();
}
function setAlarmAt(at, extra = {}) {
  alarm = { ...alarm, ...extra, at: at > Date.now() ? at : 0 };
  if (alarm.at && !alarm.time) alarm.time = hhmm(new Date(alarm.at));
  persistAlarm(); scheduleAlarm(); renderAlarm();
  return alarm.at;
}
function setAlarm(time, extra = {}) { return setAlarmAt(nextOccurrence(time), { ...extra, time }); }
function clearAlarm() { return setAlarmAt(0, { repeat: false }); }
function snooze(minutes = 5) { stopRinging(); return setAlarmAt(Date.now() + minutes * 60000); } // 반복 알람의 기준 시각(time)은 그대로 둔다.
function scheduleAlarm() {
  clearTimeout(alarmTimer);
  if (alarm.at) alarmTimer = setTimeout(() => checkAlarm(Date.now()), Math.max(0, alarm.at - Date.now()) + 20);
}
function checkAlarm(now) {
  if (!alarm.at || now < alarm.at) return;
  const fired = alarm.at;
  setAlarmAt(alarm.repeat ? nextOccurrence(alarm.time) : 0); // 반복이면 다음 날 같은 시각으로 미리 예약
  if (now - fired < 10 * 60000) ring(fired); // 잠자기 등으로 10분 넘게 지나 깨어났으면 울리지 않는다.
  else alarmStatus.textContent = `${hhmm(new Date(fired))} 알람을 놓쳤습니다`;
}
function remaining(ms) { const minutes = Math.round(ms / 60000); return minutes < 1 ? '1분 이내' : minutes < 60 ? `${minutes}분 후` : `${Math.floor(minutes / 60)}시간 ${minutes % 60 ? minutes % 60 + '분 ' : ''}후`; }
function renderAlarm() {
  document.body.classList.toggle('has-alarm', alarm.at > 0);
  if (alarm.at) {
    const at = new Date(alarm.at), today = at.toDateString() === new Date().toDateString();
    alarmBadge.textContent = `⏰ ${hhmm(at)}`;
    alarmStatus.textContent = `${today ? '오늘' : '내일'} ${hhmm(at)} (${remaining(alarm.at - Date.now())})${alarm.label ? ' · ' + alarm.label : ''}${alarm.repeat ? ' · 매일' : ''}`;
  } else if (!document.body.classList.contains('ringing')) { alarmBadge.textContent = ''; alarmStatus.textContent = '설정된 알람이 없습니다'; }
}
function syncInputs() {
  alarmInput.value = alarm.at ? hhmm(new Date(alarm.at)) : alarm.time || hhmm(new Date(Date.now() + 60 * 60000));
  alarmLabel.value = alarm.label; alarmRepeat.checked = alarm.repeat; alarmSound.checked = alarm.sound;
}
function playChime() { // 파일 없이 합성한 상승 3음. 소리 장치가 없으면 조용히 넘어간다.
  try {
    const ctx = new AudioContext(), start = ctx.currentTime;
    [[0, 880], [0.18, 1108.73], [0.36, 1318.5]].forEach(([delay, freq]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + delay); gain.gain.exponentialRampToValueAtTime(0.22, start + delay + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.9);
      osc.connect(gain).connect(ctx.destination); osc.start(start + delay); osc.stop(start + delay + 1);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch {}
}
function ring(fired) {
  clearTimeout(ringTimer);
  document.body.classList.add('ringing'); alarmForm.hidden = true;
  alarmBadge.textContent = `⏰ ${hhmm(new Date(fired))}${alarm.label ? ' ' + alarm.label : ''}`;
  if (alarm.sound) { playChime(); setTimeout(() => document.body.classList.contains('ringing') && playChime(), 2200); }
  window.desktop.fly();
  ringTimer = setTimeout(stopRinging, 120000); // 확인을 누르지 않아도 2분 뒤에는 조용해진다.
}
function stopRinging() { clearTimeout(ringTimer); document.body.classList.remove('ringing'); alarmForm.hidden = true; renderAlarm(); }
document.querySelector('.clock').onclick = () => {
  if (document.body.classList.contains('ringing')) { stopRinging(); return; } // 울리는 중이면 첫 클릭은 알람 확인만 한다.
  alarmForm.hidden = !alarmForm.hidden;
  if (!alarmForm.hidden) { syncInputs(); alarmInput.focus(); }
};
alarmForm.onsubmit = event => {
  event.preventDefault();
  if (setAlarm(alarmInput.value, { label: alarmLabel.value.trim().slice(0, 20), repeat: alarmRepeat.checked, sound: alarmSound.checked })) alarmForm.hidden = true;
};
document.querySelectorAll('.alarm-presets button').forEach(button => { button.onclick = () => {
  const at = Date.now() + Number(button.dataset.minutes) * 60000;
  setAlarmAt(at, { time: hhmm(new Date(at)), label: alarmLabel.value.trim().slice(0, 20), repeat: false, sound: alarmSound.checked }); alarmForm.hidden = true;
}; });
document.querySelector('#alarm-clear').onclick = () => { clearAlarm(); alarmForm.hidden = true; };
document.querySelector('#alarm-snooze').onclick = () => snooze();
document.querySelector('#alarm-stop').onclick = () => stopRinging();
window.addEventListener('keydown', event => { if (event.key === 'Escape') alarmForm.hidden = true; });

// ── 비행 자세: main 프로세스가 창을 화면 가장자리를 따라 움직이고, 여기서는 진행 방향으로 고양이를 눕혀 슈퍼맨 자세를 만든다.
window.desktop.onFly(state => {
  if (state.state === 'start') { flying = true; pointer = null; pet.classList.add('flying'); document.body.classList.add('flying'); }
  else if (state.state === 'move') pet.style.setProperty('--fly-angle', `${state.angle}deg`);
  else if (state.state === 'end') {
    flying = false; pet.classList.remove('flying'); document.body.classList.remove('flying'); pet.style.removeProperty('--fly-angle');
    if (document.body.classList.contains('ringing')) alarmForm.hidden = false; // 착지 후 확인 · 5분 뒤 다시 버튼
  }
});

tick(); scheduleAlarm(); renderAlarm();
window.addEventListener('focus', () => renderClock());
// 테스트·디버그용 훅: 알람을 즉시 설정/해제하거나 비행을 바로 재생한다.
window.orbitPet = { setAlarm, setAlarmAt, clearAlarm, snooze, fly: () => window.desktop.fly(), get alarm() { return { ...alarm }; }, get alarmAt() { return alarm.at; }, get flying() { return flying; } };
