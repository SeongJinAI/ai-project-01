// 설치된 AI CLI·앱 탐지. 자격 증명 파일은 읽지 않고 실행 파일 존재와 종료 코드만 본다. 결과는 메모리 캐시(60초).
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TTL = 60000;
const NAMES = ['codex', 'claude'];
// 고정 스크립트: 사용자 입력이 들어가지 않는다. 로그인 판정은 종료 코드로만 한다.
const PROBE = 'mkdir -p /tmp/orbit-codex 2>/dev/null; for n in codex claude; do p=$(command -v $n 2>/dev/null); echo "$n=${p:--}"; done; '
  + 'echo "codex_version=$(codex --version 2>/dev/null | head -1)"; echo "claude_version=$(claude --version 2>/dev/null | head -1)"; '
  + 'codex login status >/dev/null 2>&1 && echo codex_login=1 || echo codex_login=0; claude auth status >/dev/null 2>&1 && echo claude_login=1 || echo claude_login=0';

let cache = { at: 0, promise: null, result: null };

function exec(file, args, opts = {}) {
  return new Promise(resolve => {
    execFile(file, args, { windowsHide: true, timeout: opts.timeout || 4000, encoding: opts.encoding || 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => resolve({ error, stdout: stdout || '', stderr: stderr || '' }));
  });
}

function parseProbe(text) {
  const out = {};
  for (const line of String(text).replace(/\r/g, '').split('\n')) { const i = line.indexOf('='); if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim(); }
  for (const name of NAMES) if (out[name] === '-') delete out[name];
  return out;
}

async function runningWslDistro() {
  const r = await exec('wsl.exe', ['-l', '-v'], { encoding: 'buffer' });
  if (r.error || !r.stdout || !r.stdout.length) return null;
  const text = Buffer.from(r.stdout).toString('utf16le').split('').filter(c => c.charCodeAt(0) !== 0).join('');
  const rows = text.split(/\r?\n/).slice(1).map(l => l.replace(/^\*/, '').trim().split(/\s+/)).filter(c => c.length >= 2);
  const running = rows.find(c => /running/i.test(c[1]));
  return running ? running[0] : null;
}

async function probeTargets() {
  const targets = { codex: null, claude: null };
  // 테스트 재정의: 실행 파일 경로를 직접 지정한다.
  for (const name of NAMES) {
    const override = process.env['ORBIT_CLI_' + name.toUpperCase()];
    if (override) targets[name] = { via: 'direct', file: override, version: 'test', loggedIn: true };
  }
  if (process.env.ORBIT_CLI_DIRECT === '1' || (targets.codex && targets.claude)) return { targets, wslDistro: null };
  if (process.platform === 'win32') {
    const where = await exec('where.exe', NAMES);
    const found = where.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const name of NAMES) {
      const file = found.find(f => new RegExp(`[\\\\/]${name}(\\.exe|\\.cmd|\\.bat)?$`, 'i').test(f));
      if (file && !targets[name]) targets[name] = { via: 'windows', file, version: null, loggedIn: null };
    }
    if (targets.codex && targets.claude) return { targets, wslDistro: null };
    const distro = await runningWslDistro();
    if (!distro) return { targets, wslDistro: null };
    const probe = await exec('wsl.exe', ['-d', distro, '-e', 'bash', '-lic', PROBE], { timeout: 8000 });
    const info = parseProbe(probe.stdout);
    for (const name of NAMES) if (!targets[name] && info[name]) targets[name] = { via: 'wsl', distro, file: info[name], version: info[name + '_version'] || null, loggedIn: info[name + '_login'] === '1' };
    return { targets, wslDistro: distro };
  }
  const probe = await exec('bash', ['-lic', PROBE], { timeout: 8000 });
  const info = parseProbe(probe.stdout);
  for (const name of NAMES) if (!targets[name] && info[name]) targets[name] = { via: 'linux', file: info[name], version: info[name + '_version'] || null, loggedIn: info[name + '_login'] === '1' };
  return { targets, wslDistro: null };
}

async function claudeDesktopRunning() {
  if (process.platform !== 'win32') return false;
  const r = await exec('tasklist.exe', ['/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH']);
  return /claude\.exe/i.test(r.stdout);
}

function status(id, label, group, target, hints) {
  const installed = Boolean(target && target.file);
  const loggedIn = installed ? (target.loggedIn === undefined ? null : target.loggedIn) : null;
  const available = installed && loggedIn !== false;
  return { id, label, group, installed, loggedIn, version: installed ? target.version || null : null, via: installed ? target.via : null, available, reason: !installed ? 'ERR_BACKEND_NOT_INSTALLED' : loggedIn === false ? 'ERR_BACKEND_LOGIN_REQUIRED' : null, hints };
}

async function detectAll(refresh = false) {
  const now = Date.now();
  if (!refresh && cache.result && now - cache.at < TTL) return cache.result;
  if (cache.promise) return cache.promise;
  cache.promise = (async () => {
    const [{ targets, wslDistro }, desktopRunning] = await Promise.all([probeTargets(), claudeDesktopRunning()]);
    if (targets.codex && (targets.codex.via === 'windows' || (targets.codex.via === 'direct' && process.platform === 'win32'))) fs.mkdirSync(path.join(os.tmpdir(), 'orbit-codex'), { recursive: true });
    const result = {
      generatedAt: Date.now(), wslDistro, targets, desktopRunning,
      backends: [
        status('codex-cli', 'Codex', 'AI (CLI)', targets.codex, { install: 'npm i -g @openai/codex', login: 'codex login' }),
        status('claude-code', 'Claude Code', 'AI (CLI)', targets.claude, { install: 'https://claude.com/claude-code', login: 'claude' }),
        { id: 'claude-desktop', label: 'Claude 데스크톱 · 화면 자동화', group: '실험', installed: desktopRunning, loggedIn: null, version: null, via: desktopRunning ? 'windows' : null, available: desktopRunning, reason: desktopRunning ? null : 'ERR_BACKEND_NOT_INSTALLED', hints: { install: 'Claude 데스크톱 앱을 실행한 뒤 다시 시도', login: null } },
      ],
    };
    cache = { at: Date.now(), promise: null, result };
    return result;
  })().catch(error => { cache.promise = null; throw error; });
  return cache.promise;
}

async function target(name) { const all = await detectAll(false); return all.targets[name]; }
function invalidate() { cache = { at: 0, promise: null, result: null }; }

module.exports = { detectAll, target, invalidate, parseProbe };
