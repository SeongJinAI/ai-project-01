# 기능명세서 · 멀티 AI 백엔드(CLI)와 설치 AI 자동 탐지

작성일: 2026.09.18. 요구사항 문서 "Orbit 멀티 AI 연결·자동 탐지·UI 개선 요구사항"의 1단계 범위다. 지도 하나 = 대화 하나, 사용자가 고르는 것은 "어떤 AI"인지 하나뿐이다. 세션·채팅 관리 UI는 만들지 않는다.

## 1. 범위

| 포함 | 제외 |
| --- | --- |
| 어댑터 인터페이스와 레지스트리(main 프로세스) | Codex `app-server` JSON-RPC, 토큰 스트리밍 |
| Codex CLI 어댑터(`codex exec --json`, `resume`) | ChatGPT 데스크톱 앱 화면 자동화 |
| Claude Code CLI 어댑터(`claude -p --output-format json`, `--resume`) | Gemini·Copilot CLI, Ollama·LM Studio |
| 지도별 세션 저장과 자동 복구(재개 실패 시 새 대화 + 문맥 재전송) | 여러 지도, 채팅 목록, 세션 선택 UI |
| 설치 AI 자동 탐지(Windows 네이티브 / WSL / Linux)와 백엔드 선택기 | 레지스트리·Appx 전체 스캔(데스크톱 앱 목록) |
| 기존 Claude 데스크톱 화면 자동화를 "실험" 그룹으로 편입 | 마크다운 답변 렌더링 등 UI P0(다음 단계) |
| 에러 코드 중앙 관리와 한국어 메시지 | |

## 2. 백엔드 식별자와 능력

| id | 표시 이름 | 그룹 | 통합 경로 | sameChat | cancel | 비고 |
| --- | --- | --- | --- | --- | --- | --- |
| `codex-cli` | Codex | AI (CLI) | `codex exec` | 예(`thread_id`) | 프로세스 종료 | `-s read-only`, 전용 작업 폴더 |
| `claude-code` | Claude Code | AI (CLI) | `claude -p` | 예(`session_id`) | 프로세스 종료 | `--tools ""` |
| `claude-desktop` | Claude 데스크톱 · 화면 자동화 | 실험 | `bridge.ps1`(UIA) | 예(현재 열린 대화) | 프로세스 종료 | Windows + Claude 앱 필요 |
| `demo` | 데모 답변 | 기타 | 렌더러 내장 | - | - | 항상 사용 가능 |
| `manual` | 수동 연결(복사·붙이기) | 기타 | 클립보드 | - | - | 항상 사용 가능 |

## 3. IPC API 명세 (preload `window.desktop`)

| 메서드 | 방향 | 요청 | 응답 |
| --- | --- | --- | --- |
| `detectBackends(refresh?)` | invoke | `refresh: boolean` (true면 캐시 무시) | `{ generatedAt, backends: BackendStatus[] }` |
| `backendSend(payload)` | invoke | `{ backend, prompt, thread, fallbackPrompt }` | `{ ok: true, text, thread, usage: {input, cached, output} \| null, model \| null, ms, recovered? }` 또는 `{ ok: false, code, message }` |
| `backendCancel()` | send | - | - |
| `onBackendEvent(cb)` | on | - | `{ type: 'sent', backend }` (화면 자동화 전송 완료) 또는 `{ type: 'delta', text, backend }` (스트리밍 부분 답변, 누적 텍스트) |
| `backendUsage(payload)` | invoke | `{ backend, thread }` | `{ ok, backend, available, limits: { primary: {usedPercent, windowMinutes, resetsAt}, secondary: {…}, credits, at } \| null }`. Codex는 세션 기록(`~/.codex/sessions/…/rollout-*-<thread>.jsonl`의 마지막 `token_count.rate_limits`), Claude Code는 마지막 전송의 `rate_limit_event` |

### BackendStatus

```
{
  id: 'codex-cli' | 'claude-code' | 'claude-desktop',
  label: '표시 이름',
  group: 'AI (CLI)' | '실험',
  installed: boolean,
  loggedIn: true | false | null,      // null = 확인 불가/미확인
  version: '0.154.0' | null,
  via: 'windows' | 'wsl' | 'linux' | null,
  available: boolean,                 // installed && loggedIn !== false
  reason: 'ERR_BACKEND_NOT_INSTALLED' | 'ERR_BACKEND_LOGIN_REQUIRED' | null
}
```

### backendSend 요청 규칙

| 필드 | 규칙 |
| --- | --- |
| `backend` | 레지스트리에 있는 id. 아니면 `ERR_BACKEND_UNKNOWN` |
| `prompt` | 1~30,000자. 이어 붙일 세션이 있으면 짧은 질문(질문 제목 흐름 + 질문)이고, 없으면 `fallbackPrompt`와 같아도 된다 |
| `thread` | 이 지도에서 이 백엔드로 받은 마지막 `thread`(문자열) 또는 `null` |
| `fallbackPrompt` | 세션 재개 실패 시 새 대화에 보낼 전체 문맥(도입 문장 + 부모 카드 질문·답변) |

응답의 `thread`는 렌더러가 `localStorage['orbit-threads'][backend]`에 저장한다. `ok:false`의 `code`는 `errors.cjs`의 `ErrorCode` 값이다.

## 4. CLI 호출 명세

### 4.1 실행 경로 결정

```
Windows                                  Linux/macOS
  PATH에 codex.exe / claude.exe 있음?        PATH(bash -lic)에 있음?
   ├─ 예 → 네이티브 spawn                     └─ 예 → 직접 spawn
   └─ 아니오 → 실행 중인 WSL 배포판?
        ├─ 예 → wsl.exe -d <distro> -e bash -lic '<고정 명령>'   (프롬프트는 stdin)
        └─ 아니오 → ERR_BACKEND_NOT_INSTALLED
```

- 명령 문자열에는 사용자 입력을 넣지 않는다. 프롬프트는 항상 stdin으로 전달한다.
- npm 셰임(`#!/usr/bin/env node`)은 같은 폴더의 `node`가 필요하므로, 로그인 셸 없이 실행할 때 CLI 폴더를 PATH 앞에 붙인다. WSL은 `wsl.exe -d <distro> -e /usr/bin/env PATH=<CLI 폴더>:/usr/local/bin:/usr/bin:/bin <절대경로> <인자…>`, Linux는 spawn `env.PATH`에 접두. (이 PC 실측: 접두 없이 실행하면 `codex`가 `env: 'node': No such file or directory`로 실패)
- WSL 배포판 목록은 `wsl.exe -l -v`(UTF-16LE)에서 `Running` 상태만 쓴다. 정지된 배포판은 부팅하지 않는다.
- 테스트용 재정의: 환경변수 `ORBIT_CLI_CODEX`, `ORBIT_CLI_CLAUDE`(실행 파일 경로), `ORBIT_CLI_DIRECT=1`(WSL 우회).

### 4.2 Codex

| 상황 | 명령 |
| --- | --- |
| 새 대화 | `codex exec --json --skip-git-repo-check -s read-only -C <작업폴더> -` |
| 이어가기 | `codex exec resume <thread_id> --json -` |
| 작업 폴더 | Windows 네이티브: `%TEMP%\orbit-codex`, WSL/Linux: `/tmp/orbit-codex` (없으면 생성) |

이벤트(JSONL) 매핑:

| 이벤트 | 처리 |
| --- | --- |
| `thread.started` | `thread_id` 저장 |
| `item.completed` + `item.type == 'agent_message'` | 마지막 것을 답변 텍스트로 |
| `turn.completed` | `usage.input_tokens / cached_input_tokens / output_tokens` → 카드 메타에 표시. 실측: 한 단어 질문도 입력 15.7k(캐시 12.2k) 토큰이며 MCP·사용자 설정을 빼도 같다(Codex 자체 시스템 프롬프트) |
| `turn.failed`, `error` | 메시지에 `usage limit`/`rate limit` 포함 → `ERR_BACKEND_RATE_LIMIT`, 아니면 `ERR_BACKEND_FAILED` |
| 종료 코드 ≠ 0이고 답변 없음 | stderr 요약으로 `ERR_BACKEND_FAILED`. 로그인 관련 문구(`login`, `not logged in`, `auth`) → `ERR_BACKEND_LOGIN_REQUIRED` |
| 재개 실패(`not found`, `No such`, `resume` 실패 종료) | `fallbackPrompt`로 새 대화 1회 재시도 |

### 4.3 Claude Code

| 상황 | 명령 |
| --- | --- |
| 새 대화 | `claude -p --output-format stream-json --include-partial-messages --verbose --tools "" --safe-mode` (stdin에 프롬프트) |
| 이어가기 | 위 + `--resume <session_id>` |

`--safe-mode`는 CLAUDE.md·스킬·플러그인·훅·MCP 로딩을 건너뛴다. 실측(WSL, 한 단어 질문): 기본 6.4초 → safe-mode 3.6~4.2초, 이어가기 2.0초. 이어가기와 세션 저장은 유지된다.

응답(JSONL 스트림) 매핑: `rate_limit_event.rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt}` → 플랜 한도(5시간·7일 사용률, 초기화 시각), `stream_event.event.type == content_block_delta`의 `delta.text` → 부분 답변(80ms 간격으로 `backend-event {type:'delta', text}` 전송, 카드에 `▍`와 함께 표시), 마지막 `result` 이벤트의 `result` → 답변, `session_id` → thread, `usage.input_tokens + cache_read_input_tokens + cache_creation_input_tokens` → 입력 토큰, `usage.cache_read_input_tokens` → 캐시, `usage.output_tokens` → 출력, `modelUsage`의 키(haiku 제외 우선) → 모델, `is_error: true` 또는 종료 코드 ≠ 0 → 오류(위와 같은 분류). 재개 실패(`No conversation found`, 종료 코드 ≠ 0 + resume) → `fallbackPrompt`로 새 대화 1회 재시도.

### 4.4 공통

| 항목 | 값 |
| --- | --- |
| 타임아웃 | 180초. 초과 시 프로세스 종료, `ERR_BACKEND_TIMEOUT` |
| 동시성 | 앱 전체 1건. 진행 중 요청이 있으면 `ERR_BACKEND_BUSY` |
| 취소 | `backendCancel` → 프로세스 종료, `ERR_BACKEND_CANCELLED` |
| 출력 크기 | stdout 2MB, stderr 마지막 4KB만 보관 |
| 인코딩 | UTF-8. WSL 출력의 `\r` 제거 |

## 5. 탐지 명세

| 단계 | 대상 | 방법 | 예산 |
| --- | --- | --- | --- |
| 1 | Windows 네이티브 CLI | `where.exe codex claude` 1회 | 150ms |
| 2 | Claude 데스크톱 실행 여부 | `tasklist /FI "IMAGENAME eq claude.exe" /FO CSV /NH` | 300ms |
| 3 | WSL CLI | `wsl.exe -l -v` → Running 배포판 1개 → `bash -lic` 1회로 `command -v`, `--version`, `codex login status`, `claude auth status` (`-l`만 쓰면 nvm의 codex를, `-i`만 쓰면 `~/.local/bin`의 claude를 못 찾는다) | 1.3초 |
| Linux | CLI | `bash -lic` 1회(3단계와 같은 스크립트) | 1초 |

- 앱 시작 2초 후 백그라운드로 1회, 캔버스의 백엔드 선택기를 열 때 재실행(캐시 TTL 60초), 전송 실패 시 즉시 재실행.
- 자격 증명 파일은 읽지 않는다. 로그인 판정은 `codex login status`·`claude auth status`의 종료 코드로만 한다.
- 결과는 메모리 캐시. 디스크에 쓰지 않는다.

## 6. 렌더러 동작

| 항목 | 동작 |
| --- | --- |
| 선택기 | `<select id="mode">`를 탐지 결과로 다시 채운다. 그룹: `AI (CLI)` → `실험` → `기타`. 사용 불가 항목은 `disabled` + 사유 접미(`· 설치 필요`, `· 로그인 필요`, `· Claude 앱 필요`) |
| 기본 선택 | 저장된 선택(`orbit-backend`)이 사용 가능하면 그것, 아니면 사용 가능한 첫 CLI, 없으면 `demo` |
| 질문 전송 | 카드에 `busy` 표시(버튼 문구 `답변 기다리는 중… n초`, 1초마다 갱신), 완료 시 답변 채움과 토스트에 소요 시간. 실패 시 카드 질문은 유지되고 토스트에 한국어 메시지 |
| 플랜 한도 | 헤더 `사용량` 버튼에 선택한 AI의 5시간 창 사용률(`사용량 · Codex 5h 7% · 주 16%`), 70% 이상 노랑·90% 이상 빨강. 클릭하면 패널: Codex·Claude Code 각각 5시간 창/주간(7일) 사용률 막대와 초기화 시각, 이 지도 누적 토큰, 마지막 답변 메타, `⟳ 다시 읽기`. 값은 `orbit-limits`에 저장해 재실행 시 바로 표시 |
| 사용량 | 카드 아래 메타 줄: `Codex · 6.1초 · 토큰 입력 15.7k(캐시 12.2k) · 출력 6` / `Claude Code · fable-5-1 · 3.9초 · 토큰 …`. 누적은 `orbit-usage`에 저장하고 카드를 모두 지우면 초기화. 플랜 한도는 위 `사용량` 패널에 표시 |
| 세션 | `orbit-threads` = `{ 'codex-cli': id, 'claude-code': id }`. 응답의 `thread`를 저장. 지도를 비우면(카드 0장) 함께 비운다 |
| 프롬프트 | thread 있음: `질문 제목 흐름 + 질문`(brief). thread 없음: 도입 문장 + 부모 카드 질문·답변 전체(full). `fallbackPrompt`는 항상 full |
| 제거 | 헤더의 `같은 대화 이어가기` 토글과 `연결 확인` 버튼(Claude 데스크톱 선택 시에만 `연결 확인` 표시) |

## 7. 검증 흐름도

```
[카드 "질문" 클릭]
   │
   ▼
mode == demo / manual ? ──예──▶ 기존 동작
   │ 아니오
   ▼
프롬프트 1~30,000자? ──아니오──▶ 토스트 "먼저 질문을 적어 주세요" / ERR_PROMPT_INVALID
   │ 예
   ▼
진행 중 요청 있음? ──예──▶ ERR_BACKEND_BUSY
   │ 아니오
   ▼
backendSend({backend, prompt, thread, fallbackPrompt})
   │
   ▼ (main) 레지스트리에 backend 있음? ──아니오──▶ ERR_BACKEND_UNKNOWN
   │ 예
   ▼ 실행 경로 결정(네이티브/WSL/Linux) ──없음──▶ ERR_BACKEND_NOT_INSTALLED
   │
   ▼ thread 있음 ? ── 예 ──▶ resume 명령 ──실패(세션 없음)──▶ 새 대화 명령 + fallbackPrompt (1회)
   │ 아니오                      │ 성공
   ▼                             ▼
새 대화 명령 ──────────────▶ JSON/JSONL 파싱
                                 │
        ┌──────── 답변 있음 ──────┴──── 답변 없음 ────────┐
        ▼                                                 ▼
{ok:true, text, thread}                    분류: 로그인/한도/타임아웃/취소/실패
        │                                                 │
        ▼                                                 ▼
카드 답변 채움, thread 저장                  카드 질문 유지, 한국어 토스트, 탐지 재실행
```

## 8. 검증 체크리스트

실측(2026-09-18, 이 PC의 Windows 앱 → WSL CLI): Codex 새 대화 6.1초, 같은 thread 이어가기 6.4초(첫 질문에서 정한 별칭을 두 번째 질문이 기억함), Claude Code 5.8~6.4초.

| # | 항목 | 조건 | 기대 결과 / 에러 코드 |
| --- | --- | --- | --- |
| 1 | 알 수 없는 백엔드 | `backend: 'x'` | `ERR_BACKEND_UNKNOWN` |
| 2 | 미설치 | CLI 없음, WSL 없음 | `ERR_BACKEND_NOT_INSTALLED`, 선택기에서 `disabled · 설치 필요` |
| 3 | 미로그인 | `login status` 종료 코드 ≠ 0 | 선택기 `disabled · 로그인 필요`; 전송 시 `ERR_BACKEND_LOGIN_REQUIRED` |
| 4 | 새 대화 | thread 없음 | 새 대화 명령, 응답에 thread 포함, 카드 답변 채움 |
| 5 | 이어가기 | thread 있음 | resume 명령에 같은 id, 이전 답변을 다시 가져오지 않음 |
| 6 | 재개 실패 복구 | resume 실패 | `fallbackPrompt`로 새 대화 1회, 새 thread 저장 |
| 7 | 사용량 한도 | 오류 메시지에 `usage limit` | `ERR_BACKEND_RATE_LIMIT` + 한국어 안내 |
| 8 | 타임아웃 | 180초 초과 | 프로세스 종료, `ERR_BACKEND_TIMEOUT` |
| 9 | 취소 | `backendCancel` | `ERR_BACKEND_CANCELLED`, 카드 질문 유지 |
| 10 | 동시 요청 | 진행 중 재전송 | `ERR_BACKEND_BUSY` |
| 11 | 프롬프트 검증 | 빈 문자열 / 30,001자 | `ERR_PROMPT_INVALID` |
| 12 | stdin 전달 | 따옴표·줄바꿈·백틱 포함 질문 | 명령 문자열 변화 없음, CLI가 받은 프롬프트가 원문과 일치 |
| 13 | 탐지 | 이 PC | Codex·Claude Code 사용 가능(WSL), 네이티브 없음, 데모·수동 항상 존재 |
| 14 | 자격 증명 | 탐지·전송 전 과정 | `auth.json`·`.credentials.json` 접근 0건 |
| 15 | 기본 선택 | 첫 실행 | 사용 가능한 첫 CLI 선택, 없으면 데모 |
| 16 | 기존 기능 | Claude 데스크톱 화면 자동화 | `실험` 그룹에서 선택 시 기존 동작 유지 |
