// CLI 실행기. 명령에는 사용자 입력을 넣지 않고 프롬프트는 항상 stdin으로 전달한다.
const { spawn } = require('node:child_process');
const { ErrorCode, BackendError } = require('./errors.cjs');
const STDOUT_LIMIT = 2 * 1024 * 1024, STDERR_KEEP = 4096;

// target: { via: 'windows'|'wsl'|'linux'|'direct', file, distro }
function spawnTarget(target, args) {
  const options = { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
  // npm 셰임(#!/usr/bin/env node)은 같은 폴더의 node가 필요하다. 로그인 셸 없이 실행하므로 CLI 폴더를 PATH 앞에 붙인다.
  const dir = target.file.replace(/[\\/][^\\/]*$/, '');
  if (target.via === 'wsl') return spawn('wsl.exe', ['-d', target.distro, '-e', '/usr/bin/env', `PATH=${dir}:/usr/local/bin:/usr/bin:/bin`, target.file, ...args], options);
  if (process.platform !== 'win32') options.env = { ...process.env, PATH: `${dir}:${process.env.PATH || ''}` };
  if (/\.(cmd|bat)$/i.test(target.file)) {
    // npm 전역 CLI는 .cmd 셰임이라 cmd.exe가 필요하다. 인자는 고정 문자열이므로 따옴표 처리만 한다.
    const line = [target.file, ...args].map(a => (a === '' ? '""' : /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
    return spawn('cmd.exe', ['/d', '/s', '/c', line], options);
  }
  return spawn(target.file, args, options);
}

// 반환: { code, stdout, stderr, timedOut, cancelled, spawnError }
function run(target, args, { input = '', timeoutMs = 180000, onLine, register } = {}) {
  return new Promise(resolve => {
    let child;
    try { child = spawnTarget(target, args); } catch (error) { return resolve({ code: null, stdout: '', stderr: '', spawnError: error }); }
    let stdout = '', stderr = '', pending = '', timedOut = false, cancelled = false, spawnError = null, settled = false;
    const finish = code => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, stdout, stderr, timedOut, cancelled, spawnError }); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    if (register) register(() => { cancelled = true; child.kill(); });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (stdout.length < STDOUT_LIMIT) stdout += chunk;
      if (!onLine) return;
      pending += chunk; let end;
      while ((end = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1); if (line.trim()) onLine(line); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
    child.on('error', error => { spawnError = error; finish(null); });
    child.on('close', code => { if (onLine && pending.trim()) onLine(pending.replace(/\r$/, '')); finish(code); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// 실패 분류: 답변이 없을 때 결과와 메시지로 에러 코드를 정한다.
function classify(result, label, hints, detailText) {
  if (result.cancelled) return new BackendError(ErrorCode.BACKEND_CANCELLED);
  if (result.timedOut) return new BackendError(ErrorCode.BACKEND_TIMEOUT, { seconds: 180 });
  if (result.spawnError && result.spawnError.code === 'ENOENT') return new BackendError(ErrorCode.BACKEND_NOT_INSTALLED, { label, hint: hints.install });
  const text = `${detailText || ''}\n${result.stderr || ''}`;
  if (/usage limit|rate limit|hit your limit|limit reached|too many requests|\b429\b/i.test(text)) return new BackendError(ErrorCode.BACKEND_RATE_LIMIT, { label });
  if (/not logged in|please log ?in|run \/login|codex login|unauthorized|invalid api key|authentication/i.test(text)) return new BackendError(ErrorCode.BACKEND_LOGIN_REQUIRED, { label, hint: hints.login });
  const detail = (detailText || result.stderr || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return new BackendError(ErrorCode.BACKEND_FAILED, { label, detail: detail ? `(${detail})` : `(종료 코드 ${result.code})` });
}

module.exports = { run, classify };
