const { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const bridge = require('./bridge.cjs');
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
let pet, canvas, closing = false, flight = null;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
// 알람 비행: 모든 모니터를 합친 사각형의 가장자리를 창 크기만큼 안쪽으로 들인 경로를 따라 한 바퀴 돌고 제자리로 돌아온다.
function flyAround() {
  if (flight || !pet || pet.isDestroyed()) return false;
  const home = pet.getBounds(), { width: w, height: h } = home;
  const areas = screen.getAllDisplays().map(display => display.workArea);
  const left = Math.min(...areas.map(a => a.x)), top = Math.min(...areas.map(a => a.y));
  const right = Math.max(...areas.map(a => a.x + a.width)) - w, bottom = Math.max(...areas.map(a => a.y + a.height)) - h;
  const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  let entry = null; // 현재 위치에서 가장 가까운 가장자리 지점에서 출발한다.
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 4], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    const f = clamp(((home.x - a.x) * dx + (home.y - a.y) * dy) / len2, 0, 1);
    const q = { x: a.x + dx * f, y: a.y + dy * f }, dist = Math.hypot(home.x - q.x, home.y - q.y);
    if (!entry || dist < entry.dist) entry = { q, edge: i, dist };
  });
  const path = [home, entry.q, ...[1, 2, 3, 4].map(k => corners[(entry.edge + k) % 4]), entry.q, home];
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = lengths[lengths.length - 1];
  if (total < 1) return false;
  flight = { startedAt: Date.now(), duration: clamp(total / 1200, 3500, 10000), heading: null, timer: null };
  pet.setAlwaysOnTop(true, 'pop-up-menu'); pet.moveTop(); // 캔버스가 열려 있어도 고양이가 위로 보이게
  pet.webContents.send('pet-fly', { state: 'start' });
  const step = () => {
    if (pet.isDestroyed()) { flight = null; return; }
    const t = Math.min(1, (Date.now() - flight.startedAt) / flight.duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const s = eased * total;
    let i = 1; while (i < lengths.length - 1 && lengths[i] <= s) i++;
    const a = path[i - 1], b = path[i], f = clamp((s - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1), 0, 1);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bob = Math.sin(s / 170) * 12 * Math.sin(Math.PI * t); // 슈퍼맨처럼 위아래로 살짝 물결치며 난다.
    let x = a.x + dx * f - dy / len * bob, y = a.y + dy * f + dx / len * bob;
    const area = screen.getDisplayNearestPoint({ x: Math.round(x + w / 2), y: Math.round(y + h / 2) }).workArea; // 모니터 사이 빈 공간으로 벗어나지 않게 가장 가까운 모니터 안으로 붙인다.
    x = clamp(x, area.x, area.x + area.width - w); y = clamp(y, area.y, area.y + area.height - h);
    pet.setPosition(Math.round(x), Math.round(y));
    let angle = Math.atan2(dy, dx) * 180 / Math.PI + 90; // 고양이 머리가 진행 방향을 향한다.
    if (flight.heading !== null) { while (angle - flight.heading > 180) angle -= 360; while (angle - flight.heading < -180) angle += 360; }
    if (flight.heading === null || Math.abs(angle - flight.heading) > 0.5) { flight.heading = angle; pet.webContents.send('pet-fly', { state: 'move', angle: Math.round(angle * 10) / 10 }); }
    if (t < 1) { flight.timer = setTimeout(step, 16); return; }
    pet.webContents.send('pet-fly', { state: 'move', angle: Math.round(flight.heading / 360) * 360 }); // 바로 선 자세로 착지
    flight.timer = setTimeout(() => { if (!pet.isDestroyed()) { pet.setBounds(home); pet.setAlwaysOnTop(true); pet.webContents.send('pet-fly', { state: 'end' }); } flight = null; }, 400);
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
  setTimeout(() => { canvas.hide(); pet.show(); pet.focus(); closing = false; }, 650);
}
function toggle() { if (canvas.isVisible()) closeCanvas(); else openCanvas(); }
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
app.on('second-instance', () => { if (pet) { canvas.hide(); pet.center(); pet.show(); pet.focus(); } });
app.whenReady().then(() => {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const common = { frame: false, transparent: true, alwaysOnTop: true, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } };
  canvas = new BrowserWindow({ ...common, x, y, width, height, show: false, skipTaskbar: true });
  // 시계·알람 타이머가 가려진 상태에서도 제때 돌도록 백그라운드 스로틀링을 끈다.
  pet = new BrowserWindow({ ...common, webPreferences: { ...common.webPreferences, backgroundThrottling: false }, title: 'Orbit · 망토 고양이', x: x + Math.round(width / 2) - Math.round(PET.width / 2), y: y + Math.round(height / 2) - Math.round(PET.height / 2), width: PET.width, height: PET.height, resizable: false, skipTaskbar: false, show: false });
  pet.once('ready-to-show', () => {
    try { const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'pet-settings.json'), 'utf8')); if (Number.isFinite(saved.scale)) petScale = saved.scale; } catch {}
    resizePet(petScale); pet.show(); pet.focus();
  });
  canvas.loadFile('index.html'); pet.loadFile('pet.html');
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
  ipcMain.handle('bridge-send', (event, prompt) => {
    if (event.sender !== canvas.webContents || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 30000) throw new Error('질문은 1~30,000자여야 합니다.');
    return bridge.request('send', prompt, update => { if (!canvas.isDestroyed()) canvas.webContents.send('bridge-event', update); });
  });
  ipcMain.on('bridge-cancel', () => bridge.cancel());
  ipcMain.handle('copy', (_, text) => { if (typeof text === 'string') clipboard.writeText(text); });
  ipcMain.handle('paste', () => clipboard.readText());
  globalShortcut.register('CommandOrControl+Shift+Space', toggle);
});
}
app.on('will-quit', () => { globalShortcut.unregisterAll(); bridge.cancel(); if (flight) clearTimeout(flight.timer); });
app.on('window-all-closed', () => app.quit());
