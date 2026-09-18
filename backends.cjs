// AI 백엔드 어댑터 레지스트리. 렌더러는 id와 응답 텍스트만 다루고, 명령 구성·오류 분류는 여기서만 한다.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { ErrorCode, BackendError, fail, toResult } = require('./errors.cjs');
const cli = require('./cli.cjs');
const detect = require('./detect.cjs');
const bridge = require('./bridge.cjs');

const THREAD_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
let active = null; // { backend, cancel }

async function resolveTarget(name, label, hints) {
  const target = await detect.target(name);
  if (!target) throw new BackendError(ErrorCode.BACKEND_NOT_INSTALLED, { label, hint: hints.install });
  if (target.loggedIn === false) throw new BackendError(ErrorCode.BACKEND_LOGIN_REQUIRED, { label, hint: hints.login });
  return target;
}

function looksLikeMissingSession(result, detail) {
  return /not found|no such|no conversation|unknown (session|thread)|could not (find|resume)|does not exist|invalid session|invalid thread/i.test(`${detail || ''}\n${result.stderr || ''}`);
}

const codexAdapter = {
  id: 'codex-cli', label: 'Codex', hints: { install: 'npm i -g @openai/codex', login: 'codex login' },
  async send(prompt, thread, ctx) {
    const target = await resolveTarget('codex', this.label, this.hints);
    const onWindows = target.via === 'windows' || (target.via === 'direct' && process.platform === 'win32');
    const workdir = onWindows ? path.join(os.tmpdir(), 'orbit-codex') : '/tmp/orbit-codex';
    // 브레인스토밍용 안전장치: 읽기 전용 샌드박스, 전용 임시 폴더. 재개 시에는 원래 세션의 설정이 유지된다.
    const args = thread ? ['exec', 'resume', thread, '--json', '--skip-git-repo-check', '-'] : ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-C', workdir, '-'];
    let threadId = thread || null, text = null, failure = null, usage = null;
    const started = Date.now();
    const result = await cli.run(target, args, { input: prompt, register: ctx.register, onLine: line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'thread.started' && event.thread_id) threadId = String(event.thread_id);
      else if (event.type === 'item.completed' && event.item && event.item.type === 'agent_message' && typeof event.item.text === 'string') text = event.item.text;
      else if (event.type === 'turn.completed' && event.usage) usage = { input: event.usage.input_tokens || 0, cached: event.usage.cached_input_tokens || 0, output: event.usage.output_tokens || 0 };
      else if (event.type === 'turn.failed' || event.type === 'error') failure = (event.error && event.error.message) || event.message || JSON.stringify(event);
    } });
    if (text && text.trim()) return { text: text.trim(), thread: threadId, usage, model: null, ms: Date.now() - started };
    const error = cli.classify(result, this.label, this.hints, failure);
    error.missingSession = Boolean(thread) && (looksLikeMissingSession(result, failure) || (result.code !== 0 && error.code === ErrorCode.BACKEND_FAILED));
    throw error;
  },
};

// 마지막으로 읽은 플랜 한도(백엔드별). Claude Code는 stream-json의 rate_limit_event, Codex는 세션 기록에서 온다.
const lastLimits = {};
function claudeLimits(info) {
  const w = info && info.unifiedWindows; if (!w) return null;
  const win = (x, minutes) => x ? { usedPercent: Math.round((Number(x.utilization) || 0) * 1000) / 10, windowMinutes: minutes, resetsAt: x.resetsAt ? Number(x.resetsAt) * 1000 : null } : null;
  return { primary: win(w.five_hour, 300), secondary: win(w.seven_day, 10080), credits: null, at: Date.now() };
}

const claudeCodeAdapter = {
  id: 'claude-code', label: 'Claude Code', hints: { install: 'https://claude.com/claude-code', login: 'claude' },
  async send(prompt, thread, ctx) {
    const target = await resolveTarget('claude', this.label, this.hints);
    // stream-json: 부분 답변(content_block_delta)을 카드에 실시간으로 흘리고, rate_limit_event로 플랜 한도를 받는다.
    // --tools "" 도구 없이 텍스트만, --safe-mode 플러그인·훅·스킬 로딩 생략(기동 2~3초 단축, 이어가기 유지). 재개는 --resume <session_id>.
    const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--tools', '', '--safe-mode', ...(thread ? ['--resume', thread] : [])];
    const started = Date.now();
    let partial = '', final = null, limits = null, lastEmit = 0;
    const result = await cli.run(target, args, { input: prompt, register: ctx.register, onLine: line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'rate_limit_event') { limits = claudeLimits(event.rate_limit_info) || limits; }
      else if (event.type === 'stream_event' && event.event && event.event.type === 'content_block_delta' && event.event.delta && typeof event.event.delta.text === 'string') {
        partial += event.event.delta.text;
        if (Date.now() - lastEmit > 80) { lastEmit = Date.now(); ctx.onEvent({ type: 'delta', text: partial }); }
      }
      else if (event.type === 'result') final = event;
    } });
    if (limits) lastLimits['claude-code'] = limits;
    if (final && !final.is_error && typeof final.result === 'string' && final.result.trim()) {
      const u = final.usage || {};
      const usage = final.usage ? { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 } : null;
      const model = final.modelUsage ? Object.keys(final.modelUsage).filter(m => !/haiku/.test(m))[0] || Object.keys(final.modelUsage)[0] || null : null;
      return { text: final.result.trim(), thread: final.session_id ? String(final.session_id) : thread || null, usage, model, ms: Date.now() - started, limits };
    }
    const detail = final && typeof final.result === 'string' ? final.result : (!final && result.stdout.trim() ? result.stdout.trim().slice(-200) : '');
    const error = cli.classify(result, this.label, this.hints, detail);
    error.missingSession = Boolean(thread) && (looksLikeMissingSession(result, detail) || (result.code !== 0 && error.code === ErrorCode.BACKEND_FAILED));
    throw error;
  },
};

const claudeDesktopAdapter = {
  id: 'claude-desktop', label: 'Claude 데스크톱', hints: { install: 'Claude 데스크톱 앱 실행', login: null },
  async send(prompt, thread, ctx) {
    let cancelled = false;
    ctx.register(() => { cancelled = true; bridge.cancel(); });
    try {
      const started = Date.now();
      const result = await bridge.request('send', { prompt, newChat: false }, ctx.onEvent);
      return { text: result.text, thread: 'desktop', usage: null, model: null, ms: Date.now() - started };
    } catch (error) {
      if (cancelled) throw new BackendError(ErrorCode.BACKEND_CANCELLED);
      const message = String((error && error.message) || error);
      throw new BackendError(/초안/.test(message) ? ErrorCode.BRIDGE_DRAFT : ErrorCode.BRIDGE_FAILED, { detail: message });
    }
  },
};

const adapters = new Map([codexAdapter, claudeCodeAdapter, claudeDesktopAdapter].map(a => [a.id, a]));

// Codex 플랜 한도: codex는 세션 기록(~/.codex/sessions/…/rollout-*.jsonl)의 token_count 이벤트에 rate_limits(5시간·주간 사용률, 초기화 시각)를 남긴다.
// 자격 증명은 읽지 않고 이 기록만 읽는다. thread가 있으면 그 대화의 기록, 없으면 가장 최근 기록.
function parseRateLimits(line) {
  try {
    const o = JSON.parse(line); const rl = (o.payload && o.payload.rate_limits) || o.rate_limits; if (!rl) return null;
    const win = w => w ? { usedPercent: Number(w.used_percent) || 0, windowMinutes: w.window_minutes || null, resetsAt: w.resets_at ? Number(w.resets_at) * 1000 : null } : null;
    return { primary: win(rl.primary), secondary: win(rl.secondary), credits: rl.credits && rl.credits.has_credits ? { balance: rl.credits.balance, unlimited: Boolean(rl.credits.unlimited) } : null, at: Date.now() };
  } catch { return null; }
}
function execText(file, args) { return new Promise(resolve => execFile(file, args, { windowsHide: true, timeout: 6000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : String(stdout || '')))); }
async function readCodexLimits(target, thread) {
  const id = typeof thread === 'string' && THREAD_ID.test(thread) ? thread : null;
  const pattern = id ? `rollout-*-${id}.jsonl` : 'rollout-*.jsonl';
  if (target.via === 'wsl' || target.via === 'linux' || (target.via === 'direct' && process.platform !== 'win32')) {
    const script = `home="${'${ORBIT_CODEX_HOME:-$HOME/.codex}'}"; f=$(ls -t "$home"/sessions/*/*/*/${pattern} 2>/dev/null | head -1); [ -n "$f" ] && grep '"rate_limits"' "$f" | tail -1`;
    const out = target.via === 'wsl' ? await execText('wsl.exe', ['-d', target.distro, '-e', 'bash', '-lc', script]) : await execText('bash', ['-lc', script]);
    return parseRateLimits(out.trim().split('\n').pop() || '');
  }
  // Windows 네이티브 codex: %USERPROFILE%\.codex\sessions\YYYY\MM\DD\rollout-*.jsonl
  const base = path.join(process.env.ORBIT_CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  let files = [];
  try { for (const y of fs.readdirSync(base)) for (const m of fs.readdirSync(path.join(base, y))) for (const d of fs.readdirSync(path.join(base, y, m))) for (const f of fs.readdirSync(path.join(base, y, m, d))) if (f.startsWith('rollout-') && f.endsWith('.jsonl') && (!id || f.endsWith(`-${id}.jsonl`))) files.push(path.join(base, y, m, d, f)); } catch { return null; }
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const lines = fs.readFileSync(files[0], 'utf8').split('\n').filter(l => l.includes('"rate_limits"'));
  return parseRateLimits(lines.pop() || '');
}
// 플랜 한도 조회. Codex는 세션 기록에서 읽고, Claude Code는 마지막 전송의 rate_limit_event를 돌려준다.
async function usage(backend, thread) {
  if (backend === 'claude-code') return { ok: true, backend, limits: lastLimits['claude-code'] || null, available: Boolean(lastLimits['claude-code']) };
  if (backend !== 'codex-cli') return { ok: true, backend, limits: null, available: false };
  const target = await detect.target('codex');
  if (!target) return { ok: true, backend, limits: null, available: false };
  const limits = await readCodexLimits(target, thread);
  if (limits) lastLimits['codex-cli'] = limits;
  return { ok: true, backend, limits, available: Boolean(limits) };
}

// 렌더러 요청 처리. 재개 실패 시 fallbackPrompt로 새 대화를 1회 시도한다.
async function send({ backend, prompt, thread, fallbackPrompt } = {}, onEvent = () => {}) {
  const adapter = adapters.get(backend);
  if (!adapter) return fail(ErrorCode.BACKEND_UNKNOWN);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 30000) return fail(ErrorCode.PROMPT_INVALID);
  if (active) return fail(ErrorCode.BACKEND_BUSY);
  const threadId = typeof thread === 'string' && THREAD_ID.test(thread) ? thread : null;
  const ctx = { register: fn => { active = { backend, cancel: fn }; }, onEvent: event => onEvent({ ...event, backend }) };
  active = { backend, cancel: () => {} };
  try {
    try {
      const out = await adapter.send(prompt, threadId, ctx);
      return { ok: true, text: out.text, thread: out.thread || null, backend, usage: out.usage || null, model: out.model || null, ms: out.ms || null, limits: out.limits || null };
    } catch (error) {
      if (!(error instanceof BackendError) || !error.missingSession) throw error;
      // 이어 붙일 대화가 사라졌다: 전체 문맥으로 새 대화를 만든다.
      const fresh = typeof fallbackPrompt === 'string' && fallbackPrompt.trim() ? fallbackPrompt.slice(0, 30000) : prompt;
      const out = await adapter.send(fresh, null, ctx);
      return { ok: true, text: out.text, thread: out.thread || null, backend, recovered: true, usage: out.usage || null, model: out.model || null, ms: out.ms || null, limits: out.limits || null };
    }
  } catch (error) {
    if (error instanceof BackendError && [ErrorCode.BACKEND_NOT_INSTALLED, ErrorCode.BACKEND_LOGIN_REQUIRED].includes(error.code)) detect.invalidate();
    return toResult(error);
  } finally { active = null; }
}

function cancel() { if (active) active.cancel(); }

module.exports = { send, cancel, usage, adapters };
