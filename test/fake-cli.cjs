#!/usr/bin/env node
// 테스트용 가짜 CLI. argv로 Codex(`exec`)인지 Claude Code(`-p`)인지 판단하고, 받은 argv·stdin을 FAKE_CLI_LOG에 기록한 뒤 실제 형식으로 응답한다.
// 프롬프트 안의 마커로 실패를 흉내 낸다: [FAKE:RESUME_FAIL] 재개 실패, [FAKE:RATE_LIMIT] 사용량 한도, [FAKE:LOGIN] 미로그인, [FAKE:SLOW] 첫 조각 뒤 3초 지연.
// Codex는 ORBIT_CODEX_HOME/sessions/… 에 rate_limits가 담긴 세션 기록도 남긴다(플랜 한도 표시 검증용).
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const kind = args[0] === 'exec' ? 'codex' : 'claude';
  const resumeIndex = kind === 'codex' ? args.indexOf('resume') : args.indexOf('--resume');
  const resumed = resumeIndex >= 0 ? args[resumeIndex + 1] : null;
  const log = process.env.FAKE_CLI_LOG;
  if (log) fs.appendFileSync(log, JSON.stringify({ kind, args, input, at: Date.now() }) + '\n');
  let n = 1;
  if (log) { try { n = Number(fs.readFileSync(log + '.count', 'utf8')) + 1; } catch {} fs.writeFileSync(log + '.count', String(n)); }
  const rateLimited = /\[FAKE:RATE_LIMIT\]/.test(input), slow = /\[FAKE:SLOW\]/.test(input);
  const head = input.replace(/\s+/g, ' ').trim().slice(-60);
  const write = o => process.stdout.write(JSON.stringify(o) + '\n');
  if (/\[FAKE:LOGIN\]/.test(input)) { process.stderr.write(kind === 'codex' ? 'Not logged in. Run `codex login`.\n' : 'Not logged in · Please run /login\n'); process.exit(1); }
  if (resumed && /\[FAKE:RESUME_FAIL\]/.test(input)) { process.stderr.write(kind === 'codex' ? `error: session ${resumed} not found\n` : `No conversation found with session ID: ${resumed}\n`); process.exit(1); }
  if (kind === 'codex') {
    const thread = resumed || `fake-thread-${n}`;
    if (!resumed) write({ type: 'thread.started', thread_id: thread });
    write({ type: 'turn.started' });
    const finish = () => {
      if (rateLimited) { write({ type: 'error', message: "You've hit your usage limit. Try again at 8:40 PM." }); write({ type: 'turn.failed', error: { message: 'usage limit' } }); }
      else write({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: `가짜 Codex 답변${resumed ? '(이어짐)' : ''}: ${head}` } });
      write({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
      // 세션 기록(플랜 한도): 실제 codex처럼 token_count 이벤트에 rate_limits를 남긴다.
      if (process.env.ORBIT_CODEX_HOME) {
        const dir = path.join(process.env.ORBIT_CODEX_HOME, 'sessions', '2026', '09', '18'); fs.mkdirSync(dir, { recursive: true });
        const now = Math.floor(Date.now() / 1000);
        fs.appendFileSync(path.join(dir, `rollout-2026-09-18T00-00-0${n}-${thread}.jsonl`), JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { limit_id: 'codex', primary: { used_percent: 12.0, window_minutes: 300, resets_at: now + 3600 }, secondary: { used_percent: 34.0, window_minutes: 10080, resets_at: now + 86400 }, credits: { has_credits: false } } } }) + '\n');
      }
      process.exit(rateLimited ? 1 : 0);
    };
    setTimeout(finish, slow ? 3000 : 50);
    return;
  }
  // Claude Code: stream-json 형식. 한도 이벤트 → 부분 텍스트 조각 → 최종 result.
  const session = resumed || `fake-session-${n}`;
  const text = `가짜 Claude 답변${resumed ? '(이어짐)' : ''}: ${head}`;
  const now = Math.floor(Date.now() / 1000);
  write({ type: 'system', subtype: 'init', session_id: session });
  write({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.41, resetsAt: now + 5400 }, seven_day: { utilization: 0.12, resetsAt: now + 3 * 86400 } } } });
  if (rateLimited) { write({ type: 'result', subtype: 'error', is_error: true, result: "You've hit your limit · rate limit reached", session_id: session }); process.exit(1); }
  const half = Math.ceil(text.length / 2);
  write({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, half) } } });
  setTimeout(() => {
    write({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(half) } } });
    write({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, session_id: session });
    write({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: session, total_cost_usd: 0, duration_ms: 1200, usage: { input_tokens: 3, cache_read_input_tokens: 20, output_tokens: 7 }, modelUsage: { 'claude-haiku-4-5-20251001': {}, 'claude-fable-5-1': {} } });
    process.exit(0);
  }, slow ? 3000 : 30);
});
