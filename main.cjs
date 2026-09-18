const { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const bridge = require('./bridge.cjs');
const backends = require('./backends.cjs');
const detect = require('./detect.cjs');
let petScale = 1, drag = null;
// 고양이 창 기본 크기(시계 행 20px 포함)와 망토가 펼쳐지기 시작하는 세로 위치.
const PET = { width: 180, height: 250, capeY: 117 };
function resizePet(value) {
  petScale = Math.max(0.6, Math.min(2.2, value));
  const old = pet.getBounds();
  const width = Math.round(PET.width * petScale), height = Math.round(PET.height * petScale);
  const area = screen.getDisplayMatching(old).workArea;
  pet.setBounds({ x: Math.max(area.x, Math.min(area.x + area.width - width, old.x + Math.round((old.width - width) / 2))), y: Math.max(area.y, Math.min(area.y + area.height - height, old.y + Math.round((old.height - height) / 2))), width, height });
  pet.webContents.send('pet-scale', petScale);
  fs.writeFileSync(path.join(app.getPath('userData'), 'pet-settings.json'), JSON.stringify({ scale: petScale }));
}
let pet, canvas, overlays = [], closing = false, flight = null;
const common = { frame: false, transparent: true, alwaysOnTop: true, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } };
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const FLIGHT = { speed: 950, minMs: 5000, maxMs: 16000 }; // px/s, 총 비행 시간 범위
function displayUnion(workArea) {
  const areas = screen.getAllDisplays().map(display => workArea ? display.workArea : display.bounds);
  const x = Math.min(...areas.map(a => a.x)), y = Math.min(...areas.map(a => a.y));
  return { x, y, width: Math.max(...areas.map(a => a.x + a.width)) - x, height: Math.max(...areas.map(a => a.y + a.height)) - y };
}
// 비행 오버레이: 모니터마다 하나씩, 그 모니터 크기의 투명·클릭 통과 창. 시작 시 숨겨 두고 알람 비행 때만 보인다.
// (모니터 여러 대를 한 장의 투명 창으로 덮으면 Windows에서 두 번째 모니터 영역이 검게 칠해진다.)
function ensureOverlays() {
  const displays = screen.getAllDisplays();
  if (overlays.length !== displays.length || overlays.some(o => o.isDestroyed())) {
    overlays.forEach(o => { if (!o.isDestroyed()) o.destroy(); });
    overlays = displays.map(() => {
      const o = new BrowserWindow({ ...common, webPreferences: { ...common.webPreferences, backgroundThrottling: false, paintWhenInitiallyHidden: true }, show: false, skipTaskbar: true, focusable: false, resizable: false, hasShadow: false });
      o.setIgnoreMouseEvents(true);
      o.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      o.webContents.on('will-navigate', event => event.preventDefault());
      o.loadFile('pet.html', { query: { mode: 'flight' } });
      return o;
    });
  }
  // 모니터와 정확히 같은 크기의 투명 창은 Windows가 전체화면으로 취급해 합성을 끄고 검게 칠하므로 1px 작게 둔다.
  displays.forEach((display, i) => overlays[i].setBounds({ x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height - 1 }));
  return overlays;
}
// 알람 비행: 고양이 창을 옮기면 Windows 합성이 따라오지 못해 검은 사각형이 비치므로, 오버레이 창 안에서 고양이만 움직인다.
// 경로는 가장 가까운 모서리 → 대각선 → 옆 모서리 → 다시 대각선 → 제자리(X자)로, 모니터가 여러 대면 그 사이를 가로지른다.
function flyAround() {
  if (flight || !pet || pet.isDestroyed()) return false;
  const ovs = ensureOverlays(), loading = ovs.filter(o => o.webContents.isLoading());
  if (loading.length) { Promise.all(loading.map(o => new Promise(r => o.webContents.once('did-finish-load', r)))).then(() => flyAround()); return true; }
  const home = pet.getBounds(), { width: w, height: h } = home;
  const area = displayUnion(true);
  const left = area.x, top = area.y, right = area.x + area.width - w, bottom = area.y + area.height - h;
  const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  let c = 0; corners.forEach((p, i) => { if (Math.hypot(p.x - home.x, p.y - home.y) < Math.hypot(corners[c].x - home.x, corners[c].y - home.y)) c = i; });
  const path = [home, corners[c], corners[(c + 2) % 4], corners[(c + 3) % 4], corners[(c + 1) % 4], home];
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = lengths[lengths.length - 1];
  if (total < 1) return false;
  // 좌표는 화면 전체 기준으로 계산하고, 각 오버레이에는 그 창 기준으로 바꿔 보낸다. 모니터 경계에 걸친 고양이는 두 창에 나뉘어 그려진다.
  const toOverlay = state => ovs.forEach(o => { if (o.isDestroyed()) return; const b = o.getBounds(); o.webContents.send('pet-fly', Number.isFinite(state.x) ? { ...state, x: state.x - b.x, y: state.y - b.y } : state); });
  flight = { startedAt: Date.now(), duration: clamp(total / FLIGHT.speed * 1000, FLIGHT.minMs, FLIGHT.maxMs), heading: null, timer: null };
  toOverlay({ state: 'start', scale: petScale, x: home.x, y: home.y });
  pet.webContents.send('pet-fly', { state: 'start' });
  ovs.forEach(o => { o.showInactive(); o.moveTop(); });
  pet.setIgnoreMouseEvents(true); // 고양이 창은 숨기지 않고(다시 보일 때 창 관리자가 위치를 바꿀 수 있음) 내용만 투명하게 두고 클릭을 통과시킨다.
  const step = () => {
    if (pet.isDestroyed()) { flight = null; return; }
    const t = Math.min(1, (Date.now() - flight.startedAt) / flight.duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const s = eased * total;
    let i = 1; while (i < lengths.length - 1 && lengths[i] <= s) i++;
    const a = path[i - 1], b = path[i], f = clamp((s - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1), 0, 1);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bob = Math.sin(s / 260) * 14 * Math.sin(Math.PI * t); // 진행 방향에 수직으로 천천히 물결치며 난다.
    let x = a.x + dx * f - dy / len * bob, y = a.y + dy * f + dx / len * bob;
    const near = screen.getDisplayNearestPoint({ x: Math.round(x + w / 2), y: Math.round(y + h / 2) }).workArea; // 모니터 사이 빈 공간으로 벗어나지 않게
    x = clamp(x, near.x, near.x + near.width - w); y = clamp(y, near.y, near.y + near.height - h);
    let angle = Math.atan2(dy, dx) * 180 / Math.PI + 90; // 고양이 머리가 진행 방향을 향한다.
    if (flight.heading !== null) { while (angle - flight.heading > 180) angle -= 360; while (angle - flight.heading < -180) angle += 360; }
    flight.heading = angle;
    toOverlay({ state: 'move', x: Math.round(x), y: Math.round(y), angle: Math.round(angle * 10) / 10 });
    if (t < 1) { flight.timer = setTimeout(step, 16); return; }
    toOverlay({ state: 'move', x: home.x, y: home.y, angle: Math.round(flight.heading / 360) * 360 }); // 바로 선 자세로 착지
    flight.timer = setTimeout(() => {
      if (!pet.isDestroyed()) { pet.setIgnoreMouseEvents(false); pet.webContents.send('pet-fly', { state: 'end' }); }
      ovs.forEach(o => { if (!o.isDestroyed()) o.hide(); }); toOverlay({ state: 'end' });
      flight = null;
    }, 400);
  };
  step();
  return true;
}
function openCanvas() {
  if (!canvas || closing) return;
  const cat = pet.getBounds();
  canvas.setBounds(screen.getDisplayMatching(cat).workArea);
  const bounds = canvas.getBounds();
  canvas.webContents.send('cape', { open: true, x: cat.x + cat.width / 2 - bounds.x, y: cat.y + PET.capeY * petScale - bounds.y });
  canvas.show(); canvas.focus();
}
function closeCanvas() {
  if (!canvas.isVisible() || closing) return;
  closing = true;
  canvas.webContents.send('cape', { open: false });
  setTimeout(() => { canvas.hide(); pet.show(); if (!flight) pet.focus(); closing = false; }, 650);
}
function toggle() { if (canvas.isVisible()) closeCanvas(); else openCanvas(); }
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
app.on('second-instance', () => { if (pet) { canvas.hide(); pet.center(); pet.show(); pet.focus(); } });
app.whenReady().then(() => {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  canvas = new BrowserWindow({ ...common, x, y, width, height, show: false, skipTaskbar: true });
  // 시계·알람 타이머가 가려진 상태에서도 제때 돌도록 백그라운드 스로틀링을 끈다.
  pet = new BrowserWindow({ ...common, webPreferences: { ...common.webPreferences, backgroundThrottling: false }, title: 'Orbit · 망토 고양이', x: x + Math.round(width / 2) - Math.round(PET.width / 2), y: y + Math.round(height / 2) - Math.round(PET.height / 2), width: PET.width, height: PET.height, resizable: false, skipTaskbar: false, show: false });
  pet.once('ready-to-show', () => {
    try { const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'pet-settings.json'), 'utf8')); if (Number.isFinite(saved.scale)) petScale = saved.scale; } catch {}
    resizePet(petScale); pet.show(); pet.focus();
  });
  canvas.loadFile('index.html'); pet.loadFile('pet.html');
  ensureOverlays(); // 비행 오버레이를 미리 만들어 두어 알람 시각에 바로 뜨게 한다.
  screen.on('display-added', ensureOverlays); screen.on('display-removed', ensureOverlays);
  for (const win of [pet, canvas]) {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
  }
  // Reserve Ctrl/Cmd+W for card deletion, including when no card is selected.
  canvas.webContents.on('before-input-event', (event, input) => {
    // 한글 IME 상태에서는 key가 'ㅈ'로 오므로 물리 키(code)로도 판별한다.
    const key = /^[a-z]$/i.test(input.key) ? input.key.toLowerCase() : input.code === 'KeyW' ? 'w' : '';
    if ((input.control || input.meta) && !input.alt && !input.shift && key === 'w') {
      event.preventDefault();
      if (input.type === 'keyDown' && !input.isAutoRepeat) canvas.webContents.send('card-shortcut', 'delete');
    }
  });
  ipcMain.on('pet-drag', (event, action) => {
    if (event.sender !== pet.webContents || flight) return;
    const cursor = screen.getCursorScreenPoint();
    if (action === 'begin') drag = { cursor, bounds: pet.getBounds() };
    else if (action === 'move' && drag) pet.setPosition(drag.bounds.x + cursor.x - drag.cursor.x, drag.bounds.y + cursor.y - drag.cursor.y);
    else if (action === 'end') drag = null;
  });
  ipcMain.on('pet-resize', (event, delta) => { if (event.sender === pet.webContents && !flight && Number.isFinite(delta) && Math.abs(delta) <= 0.2) resizePet(petScale + delta); });
  ipcMain.on('pet-fly', event => { if (event.sender === pet.webContents) flyAround(); });
  ipcMain.on('toggle', toggle);
  ipcMain.on('hide', closeCanvas);
  ipcMain.on('quit', () => app.quit());
  ipcMain.handle('bridge-status', () => bridge.request('status'));
  // AI 백엔드: 렌더러는 백엔드 id·프롬프트·thread만 보내고, 명령 구성과 오류 분류는 backends.cjs가 맡는다.
  ipcMain.handle('backends-detect', (event, options) => detect.detectAll(Boolean(options && options.refresh)).then(info => ({ generatedAt: info.generatedAt, backends: info.backends })));
  ipcMain.handle('backend-send', (event, payload) => {
    if (event.sender !== canvas.webContents) return { ok: false, code: 'ERR_BACKEND_UNKNOWN', message: '허용되지 않은 요청입니다.' };
    return backends.send(payload || {}, update => { if (!canvas.isDestroyed()) canvas.webContents.send('backend-event', update); });
  });
  ipcMain.on('backend-cancel', () => backends.cancel());
  ipcMain.handle('backend-usage', (event, payload) => backends.usage(payload && payload.backend, payload && payload.thread));
  setTimeout(() => detect.detectAll(false).catch(() => {}), 2000); // 시작 직후 백그라운드로 설치된 AI를 탐지해 둔다.
  ipcMain.handle('copy', (_, text) => { if (typeof text === 'string') clipboard.writeText(text); });
  ipcMain.handle('paste', () => clipboard.readText());
  globalShortcut.register('CommandOrControl+Shift+Space', toggle);
});
}
app.on('will-quit', () => { globalShortcut.unregisterAll(); backends.cancel(); bridge.cancel(); if (flight) clearTimeout(flight.timer); });
app.on('window-all-closed', () => app.quit());
