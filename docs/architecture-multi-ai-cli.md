# 아키텍처 설명서 · 멀티 AI 백엔드(CLI)와 설치 AI 자동 탐지

작성일: 2026.09.18. 기능명세서 `docs/spec-multi-ai-cli.md`의 구현 구조다.

## 1. 전체 흐름 (Big Picture)

```
┌──────────────── 렌더러 (index.html / app.js, sandbox) ────────────────┐
│  백엔드 선택기(select#mode)  ──▶  카드 "질문" 클릭  ──▶  send(n)        │
│         ▲ detectBackends()               │ backendSend({backend,prompt,thread,fallbackPrompt})
└─────────┼────────────────────────────────┼──────────────────────────────┘
          │ preload.cjs (contextBridge)    │
┌─────────┼────────────────────────────────▼──────────────────────────────┐
│ main.cjs│  ipcMain.handle('backends-detect') ──▶ detect.cjs             │
│         │  ipcMain.handle('backend-send')    ──▶ backends.cjs registry  │
│         │  ipcMain.on('backend-cancel')      ──▶ backends.cancel()      │
│         │                                                                │
│  backends.cjs                                                            │
│   ├─ codex-cli     : cli.run(['exec','--json',…] | ['exec','resume',id,…])│
│   ├─ claude-code   : cli.run(['-p','--output-format','json','--tools',''])│
│   └─ claude-desktop: bridge.cjs → bridge.ps1 (UIA, 실험)                 │
│                                                                          │
│  cli.cjs  : 실행 경로 결정(네이티브 / wsl.exe -e env PATH=… / linux),         │
│             stdin으로 프롬프트, 타임아웃·취소·출력 제한                      │
│  detect.cjs: where.exe + tasklist + wsl.exe -l -v + bash -lic 1회 → 캐시    │
│  errors.cjs: ErrorCode, 한국어 메시지, fail(code)                          │
└──────────────────────────────────────────────────────────────────────────┘
          │ child_process.spawn
          ▼
   codex / claude (사용자 본인 로그인, 수정 없는 공식 바이너리)
```

원칙: 렌더러는 백엔드 id·상태·응답 텍스트만 다룬다. 프로세스 실행, 명령 구성, 오류 분류는 main에만 있다. Orbit은 토큰·자격 증명 파일을 읽지 않는다.

## 2. 시퀀스 다이어그램

### 2.1 앱 시작과 탐지

```
main            detect.cjs          OS
 │ whenReady      │                  │
 │ ─2초 후────────▶│ detectAll()      │
 │                │──where.exe──────▶│ (Windows)
 │                │──tasklist───────▶│
 │                │──wsl.exe -l -v──▶│
 │                │──wsl.exe -e bash -lic '<고정 스크립트>'──▶│  command -v / --version / login status
 │                │◀──────────── 결과 파싱, 캐시(60초) ─────│
 │◀ statuses ─────│
 │ (렌더러가 detectBackends() 호출 시 캐시 반환, refresh면 재실행)
```

### 2.2 질문 전송 (새 대화 → 이어가기 → 재개 실패 복구)

```
renderer                 main/backends.cjs                cli.cjs                 codex
 │ backendSend           │                                │                       │
 │ {thread:null}────────▶│ 검증(prompt, backend, busy)     │                       │
 │                       │ adapter.send(prompt, null)─────▶│ spawn exec --json … - │
 │                       │                                │ stdin ◀ prompt        │
 │                       │                                │◀ JSONL: thread.started, item.completed, turn.completed
 │◀ {ok,text,thread:T}───│◀ {text, thread:T} ─────────────│                       │
 │ orbit-threads[codex]=T│                                │                       │
 │                       │                                │                       │
 │ backendSend           │                                │                       │
 │ {thread:T}───────────▶│ adapter.send(brief, T)─────────▶│ spawn exec resume T --json -
 │                       │                                │◀ 실패(세션 없음) 또는 성공
 │                       │ 실패면 send(fallbackPrompt,null)▶│ spawn exec --json … -  (1회)
 │◀ {ok,text,thread:T'}──│                                │                       │
```

### 2.3 실패 분류

```
프로세스 종료 ─▶ 답변 텍스트 있음? ─예─▶ 성공
                     │ 아니오
                     ▼
   취소됨? ─예─▶ ERR_BACKEND_CANCELLED
   타임아웃? ─예─▶ ERR_BACKEND_TIMEOUT
   메시지에 usage/rate limit ─▶ ERR_BACKEND_RATE_LIMIT
   메시지에 login/auth/not logged ─▶ ERR_BACKEND_LOGIN_REQUIRED
   spawn ENOENT ─▶ ERR_BACKEND_NOT_INSTALLED
   그 외 ─▶ ERR_BACKEND_FAILED (stderr 요약 포함)
```

## 3. Entity 관계

```
Map (localStorage 'orbit-map')            Threads (localStorage 'orbit-threads')
  nodes: Card[]  ──────1 지도 : 1 대화/백엔드──▶  { 'codex-cli': thread_id, 'claude-code': session_id }
  Card { id, text, answer, parent, x, y, w, art }

Selection (localStorage 'orbit-backend')  = 마지막으로 고른 백엔드 id

BackendStatus (메모리 캐시, detect.cjs)   = { id, installed, loggedIn, version, via, available, reason }

Adapter (backends.cjs)                    = { id, label, group, caps, send(prompt, thread, opts), cancel() }
```

- 카드 삭제·이동은 대화에 영향을 주지 않는다. 카드가 0장이 되면 `orbit-threads`를 비운다.
- 백엔드를 바꾸면 그 백엔드의 thread를 쓴다(백엔드별로 대화가 따로 있다). 처음 쓰는 백엔드는 새 대화를 만들며 `fallbackPrompt`(전체 문맥)로 시작한다.

## 4. 명령 구성 규칙 (보안)

| 규칙 | 이유 |
| --- | --- |
| 프롬프트는 stdin으로만 전달, argv·셸 문자열에 넣지 않음 | 따옴표·백틱·개행에 의한 명령 주입 차단, Windows 32K 명령줄 한도 회피 |
| WSL 호출은 `wsl.exe -d <distro> -e /usr/bin/env PATH=<CLI 폴더>:… <절대경로> <인자 배열>` (셸 없음, 탐지 단계만 `bash -lic` 고정 스크립트) | 사용자 입력이 셸을 거치지 않음, npm 셰임의 `node` 해석 보장 |
| Codex `-s read-only -C <전용 임시 폴더> --skip-git-repo-check` | 코딩 에이전트의 파일 쓰기·명령 실행 차단 |
| Claude Code `--tools ""` | 도구 호출 없이 텍스트 답변만 |
| 출력 상한(stdout 2MB, stderr 4KB), 타임아웃 180초 | 폭주 방지 |
| 로그인 판정은 종료 코드만, 자격 증명 파일 미접근 | 약관·프라이버시 |

## 5. 테스트 시나리오

| 시나리오 | 환경 | 방법 |
| --- | --- | --- |
| 가짜 CLI로 전송 흐름 전체 | Linux `npm test` | `ORBIT_CLI_CODEX`/`ORBIT_CLI_CLAUDE`에 `test/fake-cli.cjs`를 지정, `ORBIT_CLI_DIRECT=1`. 가짜 CLI는 받은 argv·stdin을 파일로 기록하고 실제 형식의 JSONL/JSON을 출력. 새 대화 → 이어가기(resume id 확인) → 재개 실패(가짜가 종료 코드 1) → 복구(새 thread) → 한도 오류(가짜가 usage limit 메시지) |
| 탐지 | Linux `npm test` | 실제 CLI가 PATH에 있으면 선택기에 Codex·Claude Code가 활성 옵션으로 나타남. 없으면 `disabled · 설치 필요` |
| 실제 Codex 왕복 | Windows `test-windows.ps1`(`ORBIT_LIVE_CODEX=1`) | 앱에서 Codex 선택 → 질문 1건 → 답변 카드 채움 → 두 번째 질문이 같은 thread로 감(첫 응답 thread == 두 번째 요청 thread). 사용자 사용량을 쓰므로 수동 실행 |
| 프롬프트 원문 보존 | Linux | 따옴표·백틱·개행·이모지 포함 질문을 보내 가짜 CLI가 기록한 stdin과 원문 비교 |
| 자격 증명 미접근 | 코드 리뷰 | `auth.json`, `.credentials.json`, `.claude.json` 문자열이 코드에 없음 |

## 6. 권한 구분

단일 사용자 데스크톱 앱이라 권한 계층은 없다. 대신 프로세스 경계로 나눈다. 렌더러(sandbox)는 IPC로만 요청하고, main은 허용된 백엔드 id와 고정 명령만 실행한다.
